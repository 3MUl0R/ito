/**
 * Provider types for local mode transcription and LLM services.
 *
 * These interfaces define the contract for transcription (ASR) and
 * smart generation (LLM) providers that can be used in local mode.
 */

// ============================================================================
// Provider Configuration
// ============================================================================

export type ProviderType =
  | 'groq'
  | 'openai'
  | 'anthropic'
  | 'local-whisper'
  | 'custom'

export type AuthHeaderType = 'bearer' | 'x-api-key'

export interface ProviderConfig {
  /** Provider identifier */
  provider: ProviderType
  /** API endpoint URL */
  endpoint: string
  /** API key (stored encrypted) */
  apiKey: string
  /** Model to use */
  model: string
  /** Auth header style (default: bearer) */
  authHeader?: AuthHeaderType
}

export interface LocalModeSettings {
  /** Transcription (ASR) provider - required */
  transcription: ProviderConfig
  /** Smart generation (LLM) provider - optional */
  smartGeneration: {
    enabled: boolean
    config: ProviderConfig
  }
}

// ============================================================================
// Transcription Types
// ============================================================================

export interface TranscriptionOptions {
  /** Audio file type (default: 'wav') */
  fileType?: string
  /** ASR model override */
  model?: string
  /** User vocabulary for improved accuracy */
  vocabulary?: string[]
  /** Threshold for no-speech detection (0-1) */
  noSpeechThreshold?: number
  /** Custom prompt for transcription */
  prompt?: string
  /** Language code (e.g., 'en') */
  language?: string
}

export interface TranscriptionResult {
  /** The transcribed text */
  text: string
  /** Confidence segments (if available) */
  segments?: TranscriptionSegment[]
  /** Duration of audio in seconds */
  duration?: number
}

export interface TranscriptionSegment {
  /** Start time in seconds */
  start: number
  /** End time in seconds */
  end: number
  /** Transcribed text for this segment */
  text: string
  /** Probability that this segment contains no speech */
  noSpeechProb?: number
}

// ============================================================================
// LLM Types
// ============================================================================

export interface LLMOptions {
  /** Model override */
  model?: string
  /** Temperature for generation (0-2) */
  temperature?: number
  /** System prompt */
  systemPrompt?: string
  /** Maximum tokens to generate */
  maxTokens?: number
}

export interface LLMResult {
  /** Generated text */
  text: string
  /** Token usage (if available) */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// ============================================================================
// Provider Interfaces
// ============================================================================

/**
 * Interface for transcription (ASR) providers.
 * Implementations convert audio to text.
 */
export interface TranscriptionProvider {
  /** Provider name for logging/debugging */
  readonly name: string

  /** Check if the provider is properly configured */
  readonly isConfigured: boolean

  /**
   * Transcribe audio buffer to text.
   * @param audioBuffer - WAV audio buffer (16kHz, 16-bit, mono)
   * @param options - Transcription options
   * @param signal - Abort signal for cancellation
   * @returns Transcription result
   */
  transcribe(
    audioBuffer: Buffer,
    options?: TranscriptionOptions,
    signal?: AbortSignal,
  ): Promise<TranscriptionResult>

  /**
   * Validate the provider configuration (e.g., test API key).
   * @returns True if configuration is valid
   */
  validateConfig(): Promise<boolean>
}

/**
 * Interface for LLM providers used for smart generation.
 * Implementations enhance/transform transcripts.
 */
export interface LLMProvider {
  /** Provider name for logging/debugging */
  readonly name: string

  /** Check if the provider is properly configured */
  readonly isConfigured: boolean

  /**
   * Generate text completion.
   * @param prompt - User prompt
   * @param options - Generation options
   * @param signal - Abort signal for cancellation
   * @returns Generated result
   */
  complete(
    prompt: string,
    options?: LLMOptions,
    signal?: AbortSignal,
  ): Promise<LLMResult>

  /**
   * Adjust/enhance a transcript based on context.
   * @param transcript - Original transcript
   * @param context - Additional context (selected text, app name, etc.)
   * @param options - Generation options
   * @param signal - Abort signal for cancellation
   * @returns Enhanced transcript
   */
  adjustTranscript(
    transcript: string,
    context: TranscriptContext,
    options?: LLMOptions,
    signal?: AbortSignal,
  ): Promise<string>

  /**
   * Validate the provider configuration (e.g., test API key).
   * @returns True if configuration is valid
   */
  validateConfig(): Promise<boolean>
}

export interface TranscriptContext {
  /** Mode: transcribe (verbatim) or edit (smart generation) */
  mode: 'transcribe' | 'edit'
  /** Title of the active window */
  windowTitle?: string
  /** Name of the active application */
  appName?: string
  /** Selected text in the active app (for replacement) */
  selectedText?: string
  /** Custom system prompt */
  customPrompt?: string
}

// ============================================================================
// Error Types
// ============================================================================

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code: ProviderErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export type ProviderErrorCode =
  | 'INVALID_API_KEY'
  | 'RATE_LIMITED'
  | 'NO_SPEECH'
  | 'AUDIO_TOO_SHORT'
  | 'MODEL_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'PROVIDER_UNAVAILABLE'
  | 'CONFIGURATION_ERROR'
  | 'UNKNOWN'

// ============================================================================
// Provider Presets
// ============================================================================

export const PROVIDER_PRESETS: Record<
  ProviderType,
  {
    name: string
    endpoint: string
    authHeader: AuthHeaderType
    defaultModel: string
    type: 'asr' | 'llm' | 'both'
  }
> = {
  groq: {
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1',
    authHeader: 'bearer',
    defaultModel: 'whisper-large-v3',
    type: 'both',
  },
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    authHeader: 'bearer',
    defaultModel: 'whisper-1',
    type: 'both',
  },
  anthropic: {
    name: 'Claude',
    endpoint: 'https://api.anthropic.com/v1',
    authHeader: 'x-api-key',
    defaultModel: 'claude-sonnet-4-20250514',
    type: 'llm',
  },
  'local-whisper': {
    name: 'Local Whisper',
    endpoint: 'http://localhost:8080/v1',
    authHeader: 'bearer',
    defaultModel: 'whisper-large-v3',
    type: 'asr',
  },
  custom: {
    name: 'Custom',
    endpoint: '',
    authHeader: 'bearer',
    defaultModel: '',
    type: 'both',
  },
}
