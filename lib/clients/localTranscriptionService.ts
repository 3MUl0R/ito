/**
 * Local Transcription Service
 *
 * Orchestrates local mode transcription by:
 * 1. Loading provider configuration from store
 * 2. Creating the appropriate provider instance
 * 3. Preparing audio for transcription
 * 4. Returning results in the same format as the gRPC service
 */

import {
  createTranscriptionProvider,
  prepareAudioForTranscription,
  concatenateAudioChunks,
  isAudioTooShort,
  TranscriptionProvider,
  TranscriptionResult,
  ProviderError,
} from './providers/index.js'
import {
  isLocalMode,
  getTranscriptionConfig,
  getLocalModeSettings,
  getLocalUserId,
  getApiKeyInfo,
} from '../main/localModeStore.js'
import { DictionaryTable } from '../main/sqlite/repo.js'

// ============================================================================
// Types
// ============================================================================

export interface LocalTranscriptionRequest {
  /** Raw PCM audio chunks (16-bit mono @ 16kHz) */
  audioChunks: Uint8Array[]
  /** Transcription mode */
  mode: 'transcribe' | 'edit'
  /** Context from active window */
  context?: {
    windowTitle?: string
    appName?: string
    selectedText?: string
  }
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

export interface LocalTranscriptionResponse {
  /** The transcribed text */
  transcript: string
  /** Error information (if any) */
  error?: {
    code: string
    message: string
    provider?: string
  }
}

// ============================================================================
// Service State
// ============================================================================

let cachedProvider: TranscriptionProvider | null = null
let cachedProviderConfig: string | null = null

/**
 * Get or create a transcription provider.
 * Caches the provider instance for performance.
 */
function getProvider(): TranscriptionProvider {
  const config = getTranscriptionConfig()

  if (!config) {
    throw new ProviderError(
      'Transcription provider not configured. Please set up local mode first.',
      'localTranscriptionService',
      'CONFIGURATION_ERROR',
    )
  }

  if (!config.apiKey && config.provider !== 'local-whisper') {
    throw new ProviderError(
      'API key not configured for transcription provider.',
      config.provider,
      'INVALID_API_KEY',
    )
  }

  // Check if we need to create a new provider (config or API key changed)
  // Include API key updatedAt to invalidate cache when key changes
  const keyInfo = getApiKeyInfo('transcription')
  const configKey = JSON.stringify({
    provider: config.provider,
    endpoint: config.endpoint,
    model: config.model,
    keyUpdatedAt: keyInfo?.updatedAt ?? null,
  })

  if (cachedProvider && cachedProviderConfig === configKey) {
    return cachedProvider
  }

  // Create new provider
  cachedProvider = createTranscriptionProvider(config)
  cachedProviderConfig = configKey

  console.log(`[localTranscriptionService] Created ${config.provider} provider`)

  return cachedProvider
}

/**
 * Clear the cached provider (e.g., when config changes).
 */
export function clearProviderCache(): void {
  cachedProvider = null
  cachedProviderConfig = null
}

// ============================================================================
// Main Service Functions
// ============================================================================

/**
 * Check if local transcription is available.
 */
export function isLocalTranscriptionAvailable(): boolean {
  if (!isLocalMode()) {
    return false
  }

  const config = getTranscriptionConfig()
  if (!config) {
    return false
  }

  // Local whisper doesn't need API key
  if (config.provider === 'local-whisper') {
    return !!config.endpoint
  }

  return !!config.apiKey && !!config.endpoint
}

/**
 * Transcribe audio using the local provider.
 */
export async function transcribeLocal(
  request: LocalTranscriptionRequest,
): Promise<LocalTranscriptionResponse> {
  try {
    // Validate we're in local mode
    if (!isLocalMode()) {
      return {
        transcript: '',
        error: {
          code: 'NOT_LOCAL_MODE',
          message: 'Local transcription is only available in local mode.',
        },
      }
    }

    // Concatenate audio chunks
    const rawAudio = concatenateAudioChunks(request.audioChunks)

    // Check if audio is too short
    if (isAudioTooShort(rawAudio.length)) {
      return {
        transcript: '',
        error: {
          code: 'AUDIO_TOO_SHORT',
          message: 'Audio is too short for transcription. Please record for at least 0.1 seconds.',
        },
      }
    }

    // Prepare audio (enhance and add WAV header)
    const wavBuffer = prepareAudioForTranscription(rawAudio)

    // Get vocabulary from dictionary
    const vocabulary = await getVocabulary()

    // Get provider
    const provider = getProvider()

    // Get settings for threshold
    const settings = getLocalModeSettings()
    const noSpeechThreshold = settings?.transcription.model?.includes('whisper')
      ? 0.6 // Default threshold for Whisper models
      : undefined

    // Transcribe
    console.log(`[localTranscriptionService] Transcribing ${wavBuffer.length} bytes...`)

    const result: TranscriptionResult = await provider.transcribe(
      wavBuffer,
      {
        vocabulary,
        noSpeechThreshold,
      },
      request.signal,
    )

    console.log(`[localTranscriptionService] Transcription complete: "${result.text.substring(0, 50)}..."`)

    return {
      transcript: result.text,
    }
  } catch (error: unknown) {
    console.error('[localTranscriptionService] Transcription error:', error)

    if (error instanceof ProviderError) {
      return {
        transcript: '',
        error: {
          code: error.code,
          message: error.message,
          provider: error.provider,
        },
      }
    }

    const err = error as Error
    return {
      transcript: '',
      error: {
        code: 'UNKNOWN',
        message: err.message || 'An unknown error occurred during transcription.',
      },
    }
  }
}

/**
 * Validate the provider configuration by testing the connection.
 * Uses stored settings.
 */
export async function validateProviderConfig(): Promise<{
  valid: boolean
  error?: string
}> {
  try {
    const provider = getProvider()
    const isValid = await provider.validateConfig()

    if (!isValid) {
      return {
        valid: false,
        error: 'Provider configuration is invalid. Please check your API key and endpoint.',
      }
    }

    return { valid: true }
  } catch (error: unknown) {
    if (error instanceof ProviderError) {
      return {
        valid: false,
        error: error.message,
      }
    }

    const err = error as Error
    return {
      valid: false,
      error: err.message || 'Failed to validate provider configuration.',
    }
  }
}

/**
 * Validate provider configuration with provided config (doesn't require saving first).
 * Used for pre-validation before persisting settings.
 */
export async function validateProviderWithConfig(config: {
  provider: string
  endpoint: string
  apiKey: string
  model: string
}): Promise<{
  valid: boolean
  error?: string
}> {
  try {
    // Create a temporary provider instance with the provided config
    const tempConfig = {
      provider: config.provider as any,
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model,
      authHeader: 'bearer' as const,
    }

    const provider = createTranscriptionProvider(tempConfig)
    const isValid = await provider.validateConfig()

    if (!isValid) {
      return {
        valid: false,
        error: 'Provider configuration is invalid. Please check your API key and endpoint.',
      }
    }

    return { valid: true }
  } catch (error: unknown) {
    if (error instanceof ProviderError) {
      return {
        valid: false,
        error: error.message,
      }
    }

    const err = error as Error
    return {
      valid: false,
      error: err.message || 'Failed to validate provider configuration.',
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get vocabulary words from the local dictionary.
 */
async function getVocabulary(): Promise<string[]> {
  try {
    const userId = getLocalUserId()
    const items = await DictionaryTable.findAll(userId)
    return items
      .filter((item) => item.deleted_at === null)
      .map((item) => item.word)
  } catch (error) {
    console.warn('[localTranscriptionService] Failed to get dictionary items:', error)
    return []
  }
}
