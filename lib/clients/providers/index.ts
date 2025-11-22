/**
 * Provider exports for local mode transcription.
 */

// Types
export * from './types.js'

// Audio utilities
export * from './audioUtils.js'

// Providers
export { GroqTranscriptionProvider, createGroqTranscriptionProvider } from './groq/GroqTranscriptionProvider.js'
export {
  OpenAICompatibleProvider,
  createOpenAIProvider,
  createLocalWhisperProvider,
  createCustomProvider,
} from './openai/OpenAICompatibleProvider.js'

// Provider factory
import {
  TranscriptionProvider,
  ProviderConfig,
  ProviderType,
  ProviderError,
  PROVIDER_PRESETS,
} from './types.js'
import { GroqTranscriptionProvider } from './groq/GroqTranscriptionProvider.js'
import { OpenAICompatibleProvider } from './openai/OpenAICompatibleProvider.js'

/**
 * Create a transcription provider from configuration.
 */
export function createTranscriptionProvider(config: ProviderConfig): TranscriptionProvider {
  switch (config.provider) {
    case 'groq':
      return new GroqTranscriptionProvider(config)

    case 'openai':
      return new OpenAICompatibleProvider(config, 'OpenAI')

    case 'local-whisper':
      return new OpenAICompatibleProvider(config, 'Local Whisper')

    case 'custom':
      return new OpenAICompatibleProvider(config)

    default:
      throw new ProviderError(
        `Unknown provider type: ${config.provider}`,
        String(config.provider),
        'CONFIGURATION_ERROR',
      )
  }
}

/**
 * Get the default configuration for a provider type.
 */
export function getProviderDefaults(providerType: ProviderType): Partial<ProviderConfig> {
  const preset = PROVIDER_PRESETS[providerType]
  if (!preset) {
    return {}
  }

  return {
    provider: providerType,
    endpoint: preset.endpoint,
    model: preset.defaultModel,
    authHeader: preset.authHeader,
  }
}

/**
 * Check if a provider type supports transcription (ASR).
 */
export function supportsTranscription(providerType: ProviderType): boolean {
  const preset = PROVIDER_PRESETS[providerType]
  return preset?.type === 'asr' || preset?.type === 'both'
}

/**
 * Check if a provider type supports LLM (smart generation).
 */
export function supportsLLM(providerType: ProviderType): boolean {
  const preset = PROVIDER_PRESETS[providerType]
  return preset?.type === 'llm' || preset?.type === 'both'
}
