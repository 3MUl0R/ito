import { Button } from '@/app/components/ui/button'
import ItoIcon from '../icons/ItoIcon'
import { useAppModeStore } from '@/app/store/useAppModeStore'
import { useState, useEffect } from 'react'
import type { ProviderConfig, LocalModeSettings, ProviderType } from '../../../lib/clients/providers/types'

interface LocalModeSetupProps {
  onComplete: () => void
  onBack: () => void
}

// Provider presets
const PROVIDER_PRESETS: Record<string, Partial<ProviderConfig>> = {
  groq: {
    provider: 'groq',
    endpoint: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3',
    authHeader: 'bearer',
  },
  openai: {
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    model: 'whisper-1',
    authHeader: 'bearer',
  },
  'local-whisper': {
    provider: 'local-whisper',
    endpoint: 'http://localhost:8080/v1',
    model: 'whisper-large-v3',
    authHeader: 'bearer',
  },
  custom: {
    provider: 'custom',
    endpoint: '',
    model: '',
    authHeader: 'bearer',
  },
}

const PROVIDER_INFO: Record<string, { name: string; description: string; requiresKey: boolean; consoleUrl?: string }> = {
  groq: {
    name: 'Groq',
    description: 'Fast Whisper inference. Free tier available.',
    requiresKey: true,
    consoleUrl: 'https://console.groq.com/keys',
  },
  openai: {
    name: 'OpenAI',
    description: 'Official OpenAI Whisper API.',
    requiresKey: true,
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
  'local-whisper': {
    name: 'Local Whisper',
    description: 'Self-hosted Whisper server (whisper.cpp, faster-whisper).',
    requiresKey: false,
  },
  custom: {
    name: 'Custom',
    description: 'Any OpenAI-compatible transcription endpoint.',
    requiresKey: true,
  },
}

export default function LocalModeSetup({ onComplete, onBack }: LocalModeSetupProps) {
  const { setSettings, validateProvider, isSafeStorageAvailable } = useAppModeStore()

  // Form state
  const [selectedProvider, setSelectedProvider] = useState<string>('groq')
  const [endpoint, setEndpoint] = useState(PROVIDER_PRESETS.groq.endpoint || '')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(PROVIDER_PRESETS.groq.model || '')

  // UI state
  const [isValidating, setIsValidating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null)
  const [showSecurityWarning, setShowSecurityWarning] = useState(false)

  // Check safeStorage availability on mount
  useEffect(() => {
    if (!isSafeStorageAvailable) {
      setShowSecurityWarning(true)
    }
  }, [isSafeStorageAvailable])

  // Update form when provider changes
  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider)
    const preset = PROVIDER_PRESETS[provider]
    if (preset) {
      setEndpoint(preset.endpoint || '')
      setModel(preset.model || '')
    }
    setValidationResult(null)
    setApiKey('')
  }

  const providerInfo = PROVIDER_INFO[selectedProvider]
  const requiresApiKey = providerInfo?.requiresKey ?? true

  // Get current form config for validation
  const getCurrentConfig = () => ({
    provider: selectedProvider,
    endpoint,
    apiKey: requiresApiKey ? apiKey : '',
    model,
  })

  // Validate the configuration WITHOUT saving
  const handleValidate = async () => {
    if (requiresApiKey && !apiKey) {
      setValidationResult({ valid: false, error: 'API key is required' })
      return
    }
    if (!endpoint) {
      setValidationResult({ valid: false, error: 'Endpoint is required' })
      return
    }

    setIsValidating(true)
    setValidationResult(null)

    try {
      // Validate with provided config (doesn't save)
      const result = await window.api.localMode.validateWithConfig(getCurrentConfig())
      setValidationResult(result)
    } catch (error: any) {
      setValidationResult({ valid: false, error: error?.message || 'Validation failed' })
    } finally {
      setIsValidating(false)
    }
  }

  // Validate first, then save and continue only if valid
  const handleContinue = async () => {
    if (requiresApiKey && !apiKey) {
      setValidationResult({ valid: false, error: 'API key is required' })
      return
    }

    if (!endpoint) {
      setValidationResult({ valid: false, error: 'Endpoint is required' })
      return
    }

    setIsSaving(true)
    setValidationResult(null)

    try {
      // Step 1: Validate FIRST (without saving)
      const preValidation = await window.api.localMode.validateWithConfig(getCurrentConfig())

      if (!preValidation.valid) {
        // Validation failed - don't save anything
        setValidationResult(preValidation)
        return
      }

      // Step 2: Validation passed - now save the settings
      const settings: LocalModeSettings = {
        transcription: {
          provider: selectedProvider as ProviderType,
          endpoint,
          apiKey: requiresApiKey ? apiKey : '',
          model,
          authHeader: PROVIDER_PRESETS[selectedProvider]?.authHeader || 'bearer',
        },
        smartGeneration: {
          enabled: false,
          config: {
            provider: 'openai',
            endpoint: '',
            apiKey: '',
            model: '',
          },
        },
      }

      const saveResult = await setSettings(settings)
      if (!saveResult.success) {
        setValidationResult({ valid: false, error: saveResult.error || 'Failed to save settings' })
        return
      }

      // Step 3: Mark as validated (calls setValidated in main process)
      await validateProvider()

      setValidationResult({ valid: true })
      onComplete()
    } catch (error: any) {
      setValidationResult({ valid: false, error: error?.message || 'Failed to save settings' })
    } finally {
      setIsSaving(false)
    }
  }

  const isFormValid = endpoint && (!requiresApiKey || apiKey)

  return (
    <div className="flex flex-col h-full w-full bg-background items-center justify-center overflow-auto">
      <div className="flex flex-col items-center w-full max-w-lg px-8 py-12">
        {/* Logo */}
        <div className="mb-4 bg-black rounded-md p-2 w-10 h-10">
          <ItoIcon height={24} width={24} style={{ color: '#FFFFFF' }} />
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold mb-2 text-foreground">
            Set Up Transcription
          </h1>
          <p className="text-muted-foreground text-sm">
            Choose a transcription provider and enter your API key.
          </p>
        </div>

        {/* Security warning */}
        {showSecurityWarning && (
          <div className="w-full mb-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <p className="text-sm text-amber-600 dark:text-amber-400">
              <strong>Note:</strong> OS keychain is not available. Your API key will be
              stored with fallback encryption. This is less secure than the OS keychain.
            </p>
          </div>
        )}

        {/* Provider selection */}
        <div className="w-full space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Provider
            </label>
            <select
              value={selectedProvider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-border bg-background text-foreground"
            >
              <option value="groq">Groq (Recommended)</option>
              <option value="openai">OpenAI</option>
              <option value="local-whisper">Local Whisper</option>
              <option value="custom">Custom Endpoint</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {providerInfo?.description}
            </p>
          </div>

          {/* Endpoint */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              API Endpoint
            </label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => {
                setEndpoint(e.target.value)
                setValidationResult(null)
              }}
              placeholder="https://api.example.com/v1"
              className="w-full h-10 px-3 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* API Key */}
          {requiresApiKey && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setValidationResult(null)
                }}
                placeholder="sk-..."
                className="w-full h-10 px-3 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground"
              />
              {providerInfo?.consoleUrl && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Get your API key from{' '}
                  <a
                    href={providerInfo.consoleUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                    onClick={(e) => {
                      e.preventDefault()
                      window.api['web-open-url'](providerInfo.consoleUrl!)
                    }}
                  >
                    {new URL(providerInfo.consoleUrl).hostname}
                  </a>
                </p>
              )}
            </div>
          )}

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Model
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="whisper-large-v3"
              className="w-full h-10 px-3 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* Validation result */}
          {validationResult && (
            <div
              className={`p-3 rounded-md text-sm ${
                validationResult.valid
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-destructive/10 text-destructive'
              }`}
            >
              {validationResult.valid
                ? 'Connection successful!'
                : validationResult.error || 'Connection failed'}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={handleValidate}
              disabled={!isFormValid || isValidating || isSaving}
              className="flex-1"
            >
              {isValidating ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button
              onClick={handleContinue}
              disabled={!isFormValid || isSaving || isValidating}
              className="flex-1"
            >
              {isSaving ? 'Verifying...' : 'Save & Continue'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Your settings will be validated before continuing.
          </p>

          {/* Back button */}
          <Button
            variant="ghost"
            onClick={onBack}
            className="w-full mt-2"
          >
            Back to Mode Selection
          </Button>
        </div>

        {/* Security note */}
        <p className="mt-6 text-xs text-muted-foreground text-center">
          Your API key is stored locally and encrypted. It is never sent to Ito servers.
        </p>
      </div>
    </div>
  )
}
