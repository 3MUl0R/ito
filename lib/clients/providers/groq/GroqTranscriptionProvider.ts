/**
 * Groq Transcription Provider for local mode.
 *
 * Uses the Groq API directly from the Electron main process
 * for speech-to-text transcription via Whisper models.
 */

import Groq from 'groq-sdk'
import { toFile } from 'groq-sdk/uploads'
import {
  TranscriptionProvider,
  TranscriptionOptions,
  TranscriptionResult,
  ProviderConfig,
  ProviderError,
} from '../types.js'

// Default vocabulary to help with app-specific terms
const ITO_VOCABULARY = ['Ito', 'Hey Ito']

// Default no-speech threshold
const DEFAULT_NO_SPEECH_THRESHOLD = 0.6

/**
 * Estimates token count using rough approximation (1 token ≈ 4 characters)
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Creates a transcription prompt that stays within the 224 token limit.
 * Includes vocabulary words to improve recognition accuracy.
 */
function createTranscriptionPrompt(vocabulary: string[]): string {
  const maxTokens = 224

  if (vocabulary.length === 0) {
    return ''
  }

  const basePrompt = 'Dictionary entries include: '
  const baseTokens = estimateTokenCount(basePrompt + '. ')
  const availableTokensForVocab = maxTokens - baseTokens

  let vocabString = vocabulary.join(', ')

  // Truncate vocabulary if it exceeds available tokens
  if (estimateTokenCount(vocabString) > availableTokensForVocab) {
    const maxVocabLength = availableTokensForVocab * 4 - 10
    vocabString = vocabString
      .substring(0, maxVocabLength)
      .replace(/,\s*[^,]*$/, '') // Remove incomplete last term
  }

  if (vocabString.trim() === '') {
    return ''
  }

  return `${basePrompt}${vocabString}.`
}

export class GroqTranscriptionProvider implements TranscriptionProvider {
  public readonly name = 'Groq'
  private _client: Groq | null = null
  private readonly _config: ProviderConfig

  constructor(config: ProviderConfig) {
    this._config = config
    if (config.apiKey) {
      this._client = new Groq({ apiKey: config.apiKey })
    }
  }

  public get isConfigured(): boolean {
    return this._client !== null && !!this._config.apiKey
  }

  /**
   * Validate the API key by making a simple request.
   */
  public async validateConfig(): Promise<boolean> {
    if (!this._client) {
      return false
    }

    try {
      // Try to list models as a lightweight validation
      await this._client.models.list()
      return true
    } catch (error: unknown) {
      console.error('[GroqTranscriptionProvider] Config validation failed:', error)
      return false
    }
  }

  /**
   * Transcribe audio buffer to text using Groq's Whisper API.
   */
  public async transcribe(
    audioBuffer: Buffer,
    options?: TranscriptionOptions,
    signal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    if (!this._client) {
      throw new ProviderError(
        'Groq client not initialized. Please provide an API key.',
        this.name,
        'INVALID_API_KEY',
      )
    }

    const fileType = options?.fileType || 'wav'
    const model = options?.model || this._config.model || 'whisper-large-v3'
    const vocabulary = options?.vocabulary || []
    const noSpeechThreshold = options?.noSpeechThreshold ?? DEFAULT_NO_SPEECH_THRESHOLD

    // Combine ITO vocabulary with user vocabulary
    const fullVocabulary = [...ITO_VOCABULARY, ...vocabulary]
    const transcriptionPrompt = createTranscriptionPrompt(fullVocabulary)

    try {
      console.log(
        `[GroqTranscriptionProvider] Transcribing ${audioBuffer.length} bytes using model ${model}...`,
      )

      // Convert buffer to file for multipart upload
      const file = await toFile(audioBuffer, `audio.${fileType}`)

      // Create transcription request
      const transcription = await this._client.audio.transcriptions.create(
        {
          file,
          model,
          prompt: transcriptionPrompt || undefined,
          response_format: 'verbose_json',
          language: options?.language,
        },
        {
          signal,
        },
      )

      // Check for no-speech probability
      const segments = (transcription as any).segments as Array<{
        start: number
        end: number
        text: string
        no_speech_prob?: number
      }> | undefined

      if (segments && segments.length > 0) {
        const first = segments[0]
        if (first?.no_speech_prob !== undefined && first.no_speech_prob > noSpeechThreshold) {
          console.log(
            `[GroqTranscriptionProvider] No speech detected (prob: ${first.no_speech_prob})`,
          )
          throw new ProviderError(
            `No speech detected in audio (probability: ${first.no_speech_prob.toFixed(2)})`,
            this.name,
            'NO_SPEECH',
            { noSpeechProbability: first.no_speech_prob },
          )
        }
      }

      // Build result
      const result: TranscriptionResult = {
        text: transcription.text.trim(),
        duration: (transcription as any).duration,
        segments: segments?.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
          noSpeechProb: s.no_speech_prob,
        })),
      }

      console.log(
        `[GroqTranscriptionProvider] Transcription complete: "${result.text.substring(0, 50)}..."`,
      )

      return result
    } catch (error: unknown) {
      // Re-throw ProviderError as-is
      if (error instanceof ProviderError) {
        throw error
      }

      const err = error as Error & { status?: number; statusCode?: number; message?: string }
      const errorMessage = err.message || 'An unknown error occurred'

      console.error('[GroqTranscriptionProvider] Transcription error:', errorMessage)

      // Check for specific error types
      if (errorMessage.includes('Audio file is too short')) {
        throw new ProviderError(
          'Audio is too short for transcription. Please record for at least 0.1 seconds.',
          this.name,
          'AUDIO_TOO_SHORT',
        )
      }

      if (err.status === 401 || err.statusCode === 401) {
        throw new ProviderError(
          'Invalid Groq API key. Please check your configuration.',
          this.name,
          'INVALID_API_KEY',
        )
      }

      if (err.status === 429 || err.statusCode === 429) {
        throw new ProviderError(
          'Groq rate limit exceeded. Please wait a moment and try again.',
          this.name,
          'RATE_LIMITED',
        )
      }

      throw new ProviderError(
        errorMessage,
        this.name,
        'UNKNOWN',
        { originalError: String(error) },
      )
    }
  }
}

/**
 * Create a new Groq transcription provider from config.
 */
export function createGroqTranscriptionProvider(
  config: ProviderConfig,
): GroqTranscriptionProvider {
  return new GroqTranscriptionProvider(config)
}
