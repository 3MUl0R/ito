/**
 * OpenAI-Compatible Transcription Provider for local mode.
 *
 * Works with any API that follows the OpenAI audio transcription format:
 * - OpenAI's official API
 * - Local Whisper servers (whisper.cpp, faster-whisper)
 * - Self-hosted models (vLLM, LocalAI, Ollama with Whisper)
 * - Other compatible providers
 */

import {
  TranscriptionProvider,
  TranscriptionOptions,
  TranscriptionResult,
  ProviderConfig,
  ProviderError,
  AuthHeaderType,
} from '../types.js'

// Default no-speech threshold
const DEFAULT_NO_SPEECH_THRESHOLD = 0.6

interface OpenAITranscriptionResponse {
  text: string
  duration?: number
  segments?: Array<{
    start: number
    end: number
    text: string
    no_speech_prob?: number
  }>
}

export class OpenAICompatibleProvider implements TranscriptionProvider {
  public readonly name: string
  private readonly _config: ProviderConfig

  constructor(config: ProviderConfig, name?: string) {
    this._config = config
    this.name = name || `OpenAI-Compatible (${config.endpoint})`
  }

  public get isConfigured(): boolean {
    return !!this._config.endpoint && (!!this._config.apiKey || this._config.provider === 'local-whisper')
  }

  /**
   * Validate the configuration by making a test request.
   */
  public async validateConfig(): Promise<boolean> {
    if (!this._config.endpoint) {
      return false
    }

    try {
      // Try to reach the models endpoint as a health check
      const modelsUrl = `${this._config.endpoint}/models`
      const headers = this._buildHeaders()

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers,
      })

      // Accept 200 (success) or 401 (auth required but endpoint exists)
      return response.ok || response.status === 401
    } catch (error: unknown) {
      console.error(`[${this.name}] Config validation failed:`, error)
      return false
    }
  }

  /**
   * Transcribe audio buffer to text using OpenAI-compatible API.
   */
  public async transcribe(
    audioBuffer: Buffer,
    options?: TranscriptionOptions,
    signal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    if (!this._config.endpoint) {
      throw new ProviderError(
        'API endpoint not configured.',
        this.name,
        'CONFIGURATION_ERROR',
      )
    }

    const fileType = options?.fileType || 'wav'
    const model = options?.model || this._config.model || 'whisper-1'
    const noSpeechThreshold = options?.noSpeechThreshold ?? DEFAULT_NO_SPEECH_THRESHOLD

    try {
      console.log(
        `[${this.name}] Transcribing ${audioBuffer.length} bytes using model ${model}...`,
      )

      // Build multipart form data
      const formData = new FormData()

      // Create a Blob from the buffer (convert to Uint8Array for compatibility)
      const audioData = new Uint8Array(audioBuffer)
      const audioBlob = new Blob([audioData], { type: `audio/${fileType}` })
      formData.append('file', audioBlob, `audio.${fileType}`)
      formData.append('model', model)
      formData.append('response_format', 'verbose_json')

      if (options?.language) {
        formData.append('language', options.language)
      }

      // Build combined prompt from user prompt and vocabulary
      const promptParts: string[] = []
      if (options?.prompt) {
        promptParts.push(options.prompt)
      }
      if (options?.vocabulary && options.vocabulary.length > 0) {
        promptParts.push(`Dictionary entries include: ${options.vocabulary.join(', ')}.`)
      }
      if (promptParts.length > 0) {
        formData.append('prompt', promptParts.join(' '))
      }

      // Make the request
      const transcriptionUrl = `${this._config.endpoint}/audio/transcriptions`
      const headers = this._buildHeaders()

      const response = await fetch(transcriptionUrl, {
        method: 'POST',
        headers,
        body: formData,
        signal,
      })

      if (!response.ok) {
        await this._handleErrorResponse(response)
      }

      const data = (await response.json()) as OpenAITranscriptionResponse

      // Check for no-speech probability
      if (data.segments && data.segments.length > 0) {
        const first = data.segments[0]
        if (first?.no_speech_prob !== undefined && first.no_speech_prob > noSpeechThreshold) {
          console.log(
            `[${this.name}] No speech detected (prob: ${first.no_speech_prob})`,
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
        text: data.text.trim(),
        duration: data.duration,
        segments: data.segments?.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
          noSpeechProb: s.no_speech_prob,
        })),
      }

      console.log(
        `[${this.name}] Transcription complete: "${result.text.substring(0, 50)}..."`,
      )

      return result
    } catch (error: unknown) {
      // Re-throw ProviderError as-is
      if (error instanceof ProviderError) {
        throw error
      }

      const err = error as Error
      console.error(`[${this.name}] Transcription error:`, err.message)

      // Check for abort
      if (err.name === 'AbortError') {
        throw new ProviderError(
          'Transcription was cancelled.',
          this.name,
          'UNKNOWN',
        )
      }

      // Check for network errors
      if (err.message?.includes('fetch') || err.message?.includes('network')) {
        throw new ProviderError(
          `Cannot reach ${this._config.endpoint}. Please check the URL and your network connection.`,
          this.name,
          'NETWORK_ERROR',
        )
      }

      throw new ProviderError(
        err.message || 'An unknown error occurred',
        this.name,
        'UNKNOWN',
        { originalError: String(error) },
      )
    }
  }

  /**
   * Build headers for the request.
   */
  private _buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}

    if (this._config.apiKey) {
      const authHeader: AuthHeaderType = this._config.authHeader || 'bearer'

      if (authHeader === 'bearer') {
        headers['Authorization'] = `Bearer ${this._config.apiKey}`
      } else if (authHeader === 'x-api-key') {
        headers['x-api-key'] = this._config.apiKey
      }
    }

    return headers
  }

  /**
   * Handle error responses from the API.
   */
  private async _handleErrorResponse(response: Response): Promise<never> {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`

    try {
      const errorData = await response.json()
      errorMessage = errorData.error?.message || errorData.message || errorMessage
    } catch {
      // Ignore JSON parse errors
    }

    if (response.status === 401) {
      throw new ProviderError(
        'Invalid API key. Please check your configuration.',
        this.name,
        'INVALID_API_KEY',
      )
    }

    if (response.status === 429) {
      throw new ProviderError(
        'Rate limit exceeded. Please wait a moment and try again.',
        this.name,
        'RATE_LIMITED',
      )
    }

    if (response.status === 404) {
      throw new ProviderError(
        `Model not found or endpoint not available: ${this._config.endpoint}`,
        this.name,
        'MODEL_NOT_FOUND',
      )
    }

    throw new ProviderError(
      errorMessage,
      this.name,
      'UNKNOWN',
      { status: response.status },
    )
  }
}

/**
 * Create an OpenAI transcription provider.
 */
export function createOpenAIProvider(apiKey: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    apiKey,
    model: model || 'whisper-1',
    authHeader: 'bearer',
  }, 'OpenAI')
}

/**
 * Create a local Whisper provider (e.g., whisper.cpp server).
 */
export function createLocalWhisperProvider(
  endpoint: string = 'http://localhost:8080/v1',
  model?: string,
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    provider: 'local-whisper',
    endpoint,
    apiKey: '', // Local typically doesn't need auth
    model: model || 'whisper-large-v3',
    authHeader: 'bearer',
  }, 'Local Whisper')
}

/**
 * Create a custom OpenAI-compatible provider.
 */
export function createCustomProvider(
  endpoint: string,
  apiKey: string,
  model: string,
  authHeader: AuthHeaderType = 'bearer',
  name?: string,
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    provider: 'custom',
    endpoint,
    apiKey,
    model,
    authHeader,
  }, name || `Custom (${endpoint})`)
}
