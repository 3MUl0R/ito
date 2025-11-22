import {
  ItoMode,
  TranscribeStreamRequest,
  TranscribeStreamRequestSchema,
  StreamConfigSchema,
  ContextInfoSchema,
  LlmSettingsSchema,
} from '@/app/generated/ito_pb'
import { create } from '@bufbuild/protobuf'
import { grpcClient } from '../clients/grpcClient'
import { AudioStreamManager } from './audio/AudioStreamManager'
import { ContextData } from './context/ContextGrabber'
import log from 'electron-log'
import { timingCollector, TimingEventName } from './timing/TimingCollector'
import { interactionManager } from './interactions/InteractionManager'
import { isLocalMode } from './localModeStore'
import {
  transcribeLocal,
  isLocalTranscriptionAvailable,
} from '../clients/localTranscriptionService'

/**
 * ItoStreamController manages the lifecycle of a transcription stream using TranscribeStreamV2.
 * It allows sending metadata/config, streaming audio, and updating settings during the stream.
 */
export class ItoStreamController {
  private audioStreamManager = new AudioStreamManager()

  private hasStartedGrpc = false
  private currentMode: ItoMode = ItoMode.TRANSCRIBE
  private isCancelled = false
  private configQueue: TranscribeStreamRequest[] = []
  private abortController: AbortController | null = null

  public async initialize(mode: ItoMode): Promise<boolean> {
    // Guard against multiple concurrent transcriptions
    if (this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] Stream already in progress.')
      return false
    }

    this.audioStreamManager.initialize()
    this.hasStartedGrpc = false
    this.currentMode = mode
    this.isCancelled = false
    this.configQueue = []
    this.abortController = null
    console.log('[ItoStreamController] Starting new interaction stream.')

    return true
  }

  /**
   * Starts the transcription stream.
   * In local mode, collects audio and transcribes locally.
   * In cloud mode, streams to gRPC server.
   * Returns a promise that resolves with the transcription response and audio data.
   */
  public async startGrpcStream(): Promise<{
    response: any
    audioBuffer: Buffer
    sampleRate: number
  }> {
    if (this.hasStartedGrpc) {
      log.warn('[ItoStreamController] Stream already started')
      throw new Error('Stream already started')
    }

    this.hasStartedGrpc = true
    this.abortController = new AbortController()
    const abortSignal = this.abortController.signal

    // Check if we should use local mode
    if (isLocalMode() && isLocalTranscriptionAvailable()) {
      return this.startLocalTranscription(abortSignal)
    }

    // Cloud mode: use gRPC stream
    return this.startCloudTranscription(abortSignal)
  }

  /**
   * Local mode transcription - collects all audio then transcribes locally.
   */
  private async startLocalTranscription(abortSignal: AbortSignal): Promise<{
    response: any
    audioBuffer: Buffer
    sampleRate: number
  }> {
    console.log('[ItoStreamController] Starting LOCAL transcription')

    const timingEventName =
      this.currentMode === ItoMode.EDIT
        ? TimingEventName.SERVER_EDITING
        : TimingEventName.SERVER_DICTATION

    // Collect all audio chunks
    const audioChunks: Uint8Array[] = []
    for await (const chunk of this.audioStreamManager.streamAudioChunks()) {
      if (this.isCancelled) {
        console.log('[ItoStreamController] Local transcription cancelled')
        break
      }
      audioChunks.push(chunk.audioData)
    }

    // Transcribe locally
    const response = await timingCollector.timeAsync(
      timingEventName,
      async () => {
        const result = await transcribeLocal({
          audioChunks,
          mode: this.currentMode === ItoMode.EDIT ? 'edit' : 'transcribe',
          signal: abortSignal,
        })

        // Convert to gRPC-like response format for compatibility
        if (result.error) {
          return {
            transcript: '',
            error: {
              code: result.error.code,
              message: result.error.message,
              type: 0, // API error type
              provider: 0, // Groq provider (for now)
            },
          }
        }

        return {
          transcript: result.transcript,
        }
      },
    )

    return {
      response,
      audioBuffer: this.audioStreamManager.getInteractionAudioBuffer(),
      sampleRate: this.audioStreamManager.getCurrentSampleRate(),
    }
  }

  /**
   * Cloud mode transcription - streams to gRPC server.
   */
  private async startCloudTranscription(abortSignal: AbortSignal): Promise<{
    response: any
    audioBuffer: Buffer
    sampleRate: number
  }> {
    console.log('[ItoStreamController] Starting CLOUD transcription (gRPC)')

    const timingEventName =
      this.currentMode === ItoMode.EDIT
        ? TimingEventName.SERVER_EDITING
        : TimingEventName.SERVER_DICTATION

    const response = await timingCollector.timeAsync(
      timingEventName,
      async () =>
        await grpcClient.transcribeStreamV2(
          this.createStreamGenerator(),
          abortSignal,
        ),
    )

    return {
      response,
      audioBuffer: this.audioStreamManager.getInteractionAudioBuffer(),
      sampleRate: this.audioStreamManager.getCurrentSampleRate(),
    }
  }

  public getCurrentMode(): ItoMode {
    return this.currentMode
  }

  public setMode(mode: ItoMode) {
    if (!this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] Cannot change mode - no active stream')
      return
    }

    this.currentMode = mode
    console.log(`[ItoStreamController] Mode changed to ${mode}`)

    // Send mode update to stream
    this.sendModeUpdate(mode)
  }

  public scheduleConfigUpdate(context: ContextData) {
    if (!this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] Cannot send config - no active stream')
      return
    }

    console.log('[ItoStreamController] Queueing config update')
    const config = this.buildStreamConfig(context)
    this.configQueue.push(config)
  }

  private sendModeUpdate(mode: ItoMode) {
    console.log(`[ItoStreamController] Sending mode update: ${mode}`)

    // Create a minimal config with just the mode
    // IMPORTANT: Only set the mode field, leave others undefined so server merge works correctly
    const contextInfo = create(ContextInfoSchema, {})
    contextInfo.mode = mode
    // Don't set windowTitle, appName, or contextText - let server keep existing values

    const modeUpdate = create(TranscribeStreamRequestSchema, {
      payload: {
        case: 'config',
        value: create(StreamConfigSchema, {
          context: contextInfo,
        }),
      },
    })

    this.configQueue.push(modeUpdate)
  }

  public endInteraction() {
    if (!this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] No active stream to end')
      return
    }

    console.log('[ItoStreamController] Ending interaction stream')
    this.stopStreaming()
  }

  public cancelTranscription() {
    if (!this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] No active stream to cancel')
      return
    }

    console.log('[ItoStreamController] Cancelling transcription')
    this.isCancelled = true
    this.abortController?.abort()

    this.stopStreaming()
  }

  public getAudioDurationMs(): number {
    return this.audioStreamManager.getAudioDurationMs()
  }

  private stopStreaming() {
    this.audioStreamManager.stopStreaming()
  }

  public clearInteractionAudio() {
    this.audioStreamManager.clearInteractionAudio()
  }

  private async *createStreamGenerator(): AsyncGenerator<TranscribeStreamRequest> {
    console.log(
      '[ItoStreamController] Starting stream generator (audio-first mode)',
    )

    // Stream audio chunks and interleave config updates
    for await (const audioChunk of this.audioStreamManager.streamAudioChunks()) {
      if (this.isCancelled) {
        console.log(
          '[ItoStreamController] Stream cancelled, stopping generator',
        )
        break
      }

      // Send any pending config updates before this audio chunk
      while (this.configQueue.length > 0) {
        const configMessage = this.configQueue.shift()!
        console.log('[ItoStreamController] Sending config update from queue')
        yield configMessage
      }

      // Send audio chunk
      yield create(TranscribeStreamRequestSchema, {
        payload: {
          case: 'audioData',
          value: audioChunk.audioData,
        },
      })
    }

    // Send any remaining config messages at the end
    while (this.configQueue.length > 0) {
      const configMessage = this.configQueue.shift()!
      console.log(
        '[ItoStreamController] Sending final config update from queue',
      )
      yield configMessage
    }
  }

  private buildStreamConfig(context: ContextData): TranscribeStreamRequest {
    const interactionId = interactionManager.getCurrentInteractionId()
    // Build gRPC config message from the provided context data
    return create(TranscribeStreamRequestSchema, {
      payload: {
        case: 'config',
        value: create(StreamConfigSchema, {
          context: create(ContextInfoSchema, {
            windowTitle: context.windowTitle,
            appName: context.appName,
            contextText: context.contextText,
            mode: this.currentMode,
          }),
          llmSettings: create(LlmSettingsSchema, {
            asrModel: context.advancedSettings.llm.asrModel ?? undefined,
            asrProvider: context.advancedSettings.llm.asrProvider ?? undefined,
            asrPrompt: context.advancedSettings.llm.asrPrompt ?? undefined,
            noSpeechThreshold:
              context.advancedSettings.llm.noSpeechThreshold ?? undefined,
            llmProvider: context.advancedSettings.llm.llmProvider ?? undefined,
            llmModel: context.advancedSettings.llm.llmModel ?? undefined,
            llmTemperature:
              context.advancedSettings.llm.llmTemperature ?? undefined,

            transcriptionPrompt:
              context.advancedSettings.llm.transcriptionPrompt ?? undefined,
            editingPrompt:
              context.advancedSettings.llm.editingPrompt ?? undefined,
          }),
          vocabulary: context.vocabularyWords,
          interactionId: interactionId || undefined,
        }),
      },
    })
  }
}

export const itoStreamController = new ItoStreamController()
