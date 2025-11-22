/**
 * Local Mode Store
 *
 * Handles storage for local mode settings, including secure API key storage
 * using Electron's safeStorage for OS-level encryption.
 */

import crypto from 'crypto'
import { safeStorage } from 'electron'
import { machineIdSync } from 'node-machine-id'
import { STORE_KEYS } from '../constants/store-keys'
import { store } from './store'
import type {
  ProviderConfig,
  LocalModeSettings,
  SanitizedLocalModeSettings,
} from '../clients/providers/types'

// ============================================================================
// Types
// ============================================================================

export type AppMode = 'local' | 'cloud'

export interface SecureKeyInfo {
  /** Whether the key is stored using OS keychain (safeStorage) */
  isSecure: boolean
  /** Timestamp when the key was last updated */
  updatedAt: string
}

interface EncryptedKeyData {
  /** Encrypted API key (base64) */
  encrypted: string
  /** Storage method used */
  method: 'safeStorage' | 'fallback'
  /** When it was stored */
  storedAt: string
}

// Key storage keys (internal)
const KEY_STORAGE_PREFIX = 'localMode:apiKey:'
const KEY_INFO_PREFIX = 'localMode:keyInfo:'

// ============================================================================
// App Mode Functions
// ============================================================================

/**
 * Get the current app mode.
 */
export function getAppMode(): AppMode | null {
  const mode = store.get(STORE_KEYS.APP_MODE)
  if (mode === 'local' || mode === 'cloud') {
    return mode
  }
  return null
}

/**
 * Set the app mode.
 */
export function setAppMode(mode: AppMode): void {
  store.set(STORE_KEYS.APP_MODE, mode)
}

/**
 * Check if app is running in local mode.
 */
export function isLocalMode(): boolean {
  return getAppMode() === 'local'
}

/**
 * Check if app mode has been selected.
 */
export function hasSelectedMode(): boolean {
  return getAppMode() !== null
}

// ============================================================================
// Local User ID
// ============================================================================

/**
 * Get or create a local user ID.
 * This is used as a pseudo-user-id for SQLite foreign keys in local mode.
 */
export function getLocalUserId(): string {
  let userId = store.get(STORE_KEYS.LOCAL_USER_ID) as string | undefined
  if (!userId) {
    userId = `local-${crypto.randomUUID()}`
    store.set(STORE_KEYS.LOCAL_USER_ID, userId)
  }
  return userId
}

// ============================================================================
// Secure API Key Storage
// ============================================================================

/**
 * Check if safeStorage is available for encryption.
 */
export function isSafeStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * Derive a fallback encryption key from machine ID.
 * This is less secure than safeStorage but better than plaintext.
 */
function deriveFallbackKey(): Buffer {
  try {
    const machineId = machineIdSync()
    const salt = 'ito-local-mode-v1'
    return crypto.scryptSync(machineId, salt, 32)
  } catch {
    // If machine ID fails, use a static key (least secure)
    console.warn('[localModeStore] Could not get machine ID, using static fallback')
    return crypto.scryptSync('ito-fallback', 'ito-local-mode-v1', 32)
  }
}

/**
 * Encrypt a string using fallback method (AES-256-GCM).
 */
function encryptFallback(plaintext: string): string {
  const key = deriveFallbackKey()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  const authTag = cipher.getAuthTag()

  // Combine iv + authTag + encrypted
  const combined = Buffer.concat([
    iv,
    authTag,
    Buffer.from(encrypted, 'base64'),
  ])

  return combined.toString('base64')
}

/**
 * Decrypt a string using fallback method (AES-256-GCM).
 */
function decryptFallback(encryptedData: string): string {
  const key = deriveFallbackKey()
  const combined = Buffer.from(encryptedData, 'base64')

  const iv = combined.subarray(0, 16)
  const authTag = combined.subarray(16, 32)
  const encrypted = combined.subarray(32)

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted)
  decrypted = Buffer.concat([decrypted, decipher.final()])

  return decrypted.toString('utf8')
}

/**
 * Store an API key securely.
 *
 * @param providerId - Identifier for the provider (e.g., 'transcription', 'llm')
 * @param apiKey - The API key to store
 */
export function setApiKey(providerId: string, apiKey: string): void {
  const keyPath = `${KEY_STORAGE_PREFIX}${providerId}`
  const infoPath = `${KEY_INFO_PREFIX}${providerId}`

  let method: 'safeStorage' | 'fallback'
  let encrypted: string

  if (isSafeStorageAvailable()) {
    // Use OS keychain encryption
    const encryptedBuffer = safeStorage.encryptString(apiKey)
    encrypted = encryptedBuffer.toString('base64')
    method = 'safeStorage'
  } else {
    // Use fallback encryption
    console.warn(
      '[localModeStore] safeStorage not available, using fallback encryption (less secure)',
    )
    encrypted = encryptFallback(apiKey)
    method = 'fallback'
  }

  const keyData: EncryptedKeyData = {
    encrypted,
    method,
    storedAt: new Date().toISOString(),
  }

  store.set(keyPath, keyData)
  store.set(infoPath, {
    isSecure: method === 'safeStorage',
    updatedAt: keyData.storedAt,
  } satisfies SecureKeyInfo)
}

/**
 * Retrieve an API key.
 *
 * @param providerId - Identifier for the provider
 * @returns The decrypted API key, or null if not found
 */
export function getApiKey(providerId: string): string | null {
  const keyPath = `${KEY_STORAGE_PREFIX}${providerId}`
  const keyData = store.get(keyPath) as EncryptedKeyData | undefined

  if (!keyData?.encrypted) {
    return null
  }

  try {
    if (keyData.method === 'safeStorage') {
      const encryptedBuffer = Buffer.from(keyData.encrypted, 'base64')
      return safeStorage.decryptString(encryptedBuffer)
    } else {
      return decryptFallback(keyData.encrypted)
    }
  } catch (error) {
    console.error('[localModeStore] Failed to decrypt API key:', error)
    return null
  }
}

/**
 * Delete an API key.
 */
export function deleteApiKey(providerId: string): void {
  const keyPath = `${KEY_STORAGE_PREFIX}${providerId}`
  const infoPath = `${KEY_INFO_PREFIX}${providerId}`
  store.delete(keyPath)
  store.delete(infoPath)
}

/**
 * Get info about how an API key is stored.
 */
export function getApiKeyInfo(providerId: string): SecureKeyInfo | null {
  const infoPath = `${KEY_INFO_PREFIX}${providerId}`
  return store.get(infoPath) as SecureKeyInfo | undefined ?? null
}

/**
 * Check if an API key exists for a provider.
 */
export function hasApiKey(providerId: string): boolean {
  return getApiKey(providerId) !== null
}

// ============================================================================
// Provider Configuration
// ============================================================================

/**
 * Get local mode settings (provider configurations) - INTERNAL USE ONLY.
 * Returns full settings including decrypted API keys.
 * DO NOT expose to renderer process.
 */
export function getLocalModeSettings(): LocalModeSettings | null {
  const settings = store.get(STORE_KEYS.LOCAL_MODE_SETTINGS) as LocalModeSettings | undefined
  if (!settings) {
    return null
  }

  // Inject API keys from secure storage
  const transcriptionKey = getApiKey('transcription')
  const llmKey = getApiKey('llm')

  return {
    transcription: {
      ...settings.transcription,
      apiKey: transcriptionKey || '',
    },
    smartGeneration: {
      enabled: settings.smartGeneration.enabled,
      config: {
        ...settings.smartGeneration.config,
        apiKey: llmKey || '',
      },
    },
  }
}

/**
 * Get sanitized local mode settings for renderer.
 * API keys are replaced with boolean hasApiKey flag.
 */
export function getLocalModeSettingsForRenderer(): SanitizedLocalModeSettings | null {
  const settings = store.get(STORE_KEYS.LOCAL_MODE_SETTINGS) as LocalModeSettings | undefined
  if (!settings) {
    return null
  }

  return {
    transcription: {
      provider: settings.transcription.provider,
      endpoint: settings.transcription.endpoint,
      model: settings.transcription.model,
      authHeader: settings.transcription.authHeader,
      hasApiKey: hasApiKey('transcription'),
    },
    smartGeneration: {
      enabled: settings.smartGeneration.enabled,
      config: {
        provider: settings.smartGeneration.config.provider,
        endpoint: settings.smartGeneration.config.endpoint,
        model: settings.smartGeneration.config.model,
        authHeader: settings.smartGeneration.config.authHeader,
        hasApiKey: hasApiKey('llm'),
      },
    },
  }
}

/**
 * Save local mode settings (provider configurations).
 * API keys are stored separately with encryption.
 * Note: This clears the validation flag - settings must be re-validated.
 */
export function setLocalModeSettings(settings: LocalModeSettings): void {
  // Extract and store API keys separately
  if (settings.transcription.apiKey) {
    setApiKey('transcription', settings.transcription.apiKey)
  }
  if (settings.smartGeneration.config.apiKey) {
    setApiKey('llm', settings.smartGeneration.config.apiKey)
  }

  // Store config without API keys
  const settingsWithoutKeys: LocalModeSettings = {
    transcription: {
      ...settings.transcription,
      apiKey: '', // Don't store in main config
    },
    smartGeneration: {
      enabled: settings.smartGeneration.enabled,
      config: {
        ...settings.smartGeneration.config,
        apiKey: '', // Don't store in main config
      },
    },
  }

  store.set(STORE_KEYS.LOCAL_MODE_SETTINGS, settingsWithoutKeys)

  // Clear validation - settings have changed, must re-validate
  clearValidation()
}

/**
 * Get transcription provider config (with API key).
 */
export function getTranscriptionConfig(): ProviderConfig | null {
  const settings = getLocalModeSettings()
  return settings?.transcription ?? null
}

/**
 * Get LLM provider config (with API key).
 */
export function getLLMConfig(): ProviderConfig | null {
  const settings = getLocalModeSettings()
  if (!settings?.smartGeneration.enabled) {
    return null
  }
  return settings.smartGeneration.config
}

// ============================================================================
// Validation
// ============================================================================

/** Providers that don't require an API key */
const KEYLESS_PROVIDERS: readonly string[] = ['local-whisper']

/**
 * Check if a provider requires an API key.
 */
function isKeylessProvider(provider: string): boolean {
  return KEYLESS_PROVIDERS.includes(provider)
}

/**
 * Mark the current configuration as validated.
 * Called after successful connection test.
 */
export function setValidated(): void {
  store.set(STORE_KEYS.LOCAL_MODE_VALIDATED, new Date().toISOString())
  console.log('[localModeStore] Configuration marked as validated')
}

/**
 * Clear the validation flag.
 * Called when settings change.
 */
export function clearValidation(): void {
  store.delete(STORE_KEYS.LOCAL_MODE_VALIDATED)
}

/**
 * Check if configuration has been validated.
 */
export function isValidated(): boolean {
  const validatedAt = store.get(STORE_KEYS.LOCAL_MODE_VALIDATED)
  return !!validatedAt
}

/**
 * Get the timestamp of last successful validation.
 */
export function getValidatedAt(): string | null {
  return (store.get(STORE_KEYS.LOCAL_MODE_VALIDATED) as string) ?? null
}

/**
 * Check if local mode is properly configured AND validated.
 * Returns true only if:
 * 1. App is in local mode
 * 2. Settings exist with required fields
 * 3. Configuration has been successfully validated (connection test passed)
 */
export function isLocalModeConfigured(): boolean {
  if (!isLocalMode()) {
    return false
  }

  const settings = getLocalModeSettings()
  if (!settings) {
    return false
  }

  // Must have transcription provider configured
  const { provider, endpoint, apiKey } = settings.transcription

  // Provider is always required
  if (!provider) {
    return false
  }

  // Endpoint is always required
  if (!endpoint) {
    return false
  }

  // API key required unless using a keyless provider (e.g., local-whisper)
  if (isKeylessProvider(provider)) {
    // Keyless providers just need endpoint + validation
    return isValidated()
  }

  // Other providers need an API key + validation
  if (!apiKey) {
    return false
  }

  // Must have passed validation (connection test)
  return isValidated()
}

/**
 * Reset local mode configuration (for testing/support).
 */
export function resetLocalModeConfig(): void {
  store.delete(STORE_KEYS.APP_MODE)
  store.delete(STORE_KEYS.LOCAL_MODE_SETTINGS)
  store.delete(STORE_KEYS.LOCAL_MODE_VALIDATED)
  deleteApiKey('transcription')
  deleteApiKey('llm')
  // Note: Don't delete LOCAL_USER_ID to preserve data association
}
