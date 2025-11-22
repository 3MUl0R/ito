import { useState, useEffect } from 'react'
import { Button } from '@/app/components/ui/button'
import { useAppModeStore } from '@/app/store/useAppModeStore'
import type { LocalModeSettings, ProviderType } from '@/lib/clients/providers/types'

const PROVIDER_NAMES: Record<string, string> = {
  groq: 'Groq',
  openai: 'OpenAI',
  'local-whisper': 'Local Whisper',
  custom: 'Custom',
}

const PROVIDER_CONSOLE_URLS: Record<string, string> = {
  groq: 'https://console.groq.com/keys',
  openai: 'https://platform.openai.com/api-keys',
}

/** Providers that don't require an API key */
const KEYLESS_PROVIDERS = ['local-whisper'] as const

function isKeylessProvider(provider: string): boolean {
  return KEYLESS_PROVIDERS.includes(provider as any)
}

export default function TranscriptionSettingsContent() {
  const { settings, validateProvider, refreshSettings, isSafeStorageAvailable } = useAppModeStore()
  const [isEditing, setIsEditing] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ valid: boolean; error?: string } | null>(null)

  // Form state
  const [apiKey, setApiKey] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [model, setModel] = useState('')

  // Initialize form with current settings
  useEffect(() => {
    if (settings?.transcription) {
      setEndpoint(settings.transcription.endpoint)
      setModel(settings.transcription.model)
    }
  }, [settings])

  const provider = settings?.transcription?.provider || 'groq'
  const providerName = PROVIDER_NAMES[provider] || provider
  const consoleUrl = PROVIDER_CONSOLE_URLS[provider]
  const hasApiKey = settings?.transcription?.hasApiKey ?? false
  const providerIsKeyless = isKeylessProvider(provider)

  const handleTestConnection = async () => {
    setIsTesting(true)
    setTestResult(null)

    try {
      const result = await validateProvider()
      setTestResult(result)
    } catch (error: any) {
      setTestResult({ valid: false, error: error?.message || 'Test failed' })
    } finally {
      setIsTesting(false)
    }
  }

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      setTestResult({ valid: false, error: 'API key is required' })
      return
    }

    setIsSaving(true)
    setTestResult(null)

    try {
      // Validate with new key first
      const validationResult = await window.api.localMode.validateWithConfig({
        provider,
        endpoint,
        apiKey: apiKey.trim(),
        model,
      })

      if (!validationResult.valid) {
        setTestResult(validationResult)
        return
      }

      // Save the new settings
      // Note: We construct smartGeneration with empty apiKey. The backend
      // preserves existing API keys stored in secure storage.
      const newSettings: LocalModeSettings = {
        transcription: {
          provider: provider as ProviderType,
          endpoint,
          apiKey: apiKey.trim(),
          model,
        },
        smartGeneration: {
          enabled: settings?.smartGeneration?.enabled ?? false,
          config: {
            provider: (settings?.smartGeneration?.config?.provider as ProviderType) || 'openai',
            endpoint: settings?.smartGeneration?.config?.endpoint || '',
            apiKey: '', // Backend preserves existing secure storage
            model: settings?.smartGeneration?.config?.model || '',
          },
        },
      }

      const saveResult = await window.api.localMode.setSettings(newSettings)

      if (saveResult.success) {
        // Mark as validated
        await validateProvider()
        await refreshSettings()
        setIsEditing(false)
        setApiKey('')
        setTestResult({ valid: true })
      } else {
        setTestResult({ valid: false, error: saveResult.error || 'Failed to save' })
      }
    } catch (error: any) {
      setTestResult({ valid: false, error: error?.message || 'Failed to save' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Provider Info */}
      <div>
        <div className="text-lg font-medium mb-4">Transcription Service</div>
        <div className="space-y-4">
          <div className="p-4 bg-slate-50 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Provider</div>
                <div className="text-sm text-gray-600">{providerName}</div>
              </div>
              <div className="text-xs text-gray-500 bg-white px-2 py-1 rounded">
                Local Mode
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Endpoint</div>
              <div className="text-xs text-gray-600 mt-1 font-mono">
                {settings?.transcription?.endpoint || 'Not configured'}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Model</div>
              <div className="text-xs text-gray-600 mt-1">
                {settings?.transcription?.model || 'Default'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* API Key Section - only shown for providers that require keys */}
      {!providerIsKeyless && (
        <div>
          <div className="text-lg font-medium mb-4">API Key</div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">
                  {hasApiKey ? 'API Key Configured' : 'No API Key'}
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  {hasApiKey
                    ? 'Your API key is securely stored on this device.'
                    : 'Add your API key to enable transcription.'}
                </div>
                {!isSafeStorageAvailable && (
                  <div className="text-xs text-amber-600 mt-1">
                    Note: OS keychain unavailable. Using fallback encryption.
                  </div>
                )}
              </div>
              {!isEditing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                >
                  {hasApiKey ? 'Change Key' : 'Add Key'}
                </Button>
              )}
            </div>

            {isEditing && (
              <div className="space-y-3 p-4 bg-slate-50 rounded-lg">
                <div>
                  <label className="text-sm font-medium">New API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value)
                      setTestResult(null)
                    }}
                    placeholder="sk-..."
                    className="w-full mt-1 h-10 px-3 rounded-md border border-gray-300 bg-white text-sm"
                  />
                  {consoleUrl && (
                    <p className="mt-1 text-xs text-gray-500">
                      Get your API key from{' '}
                      <a
                        href={consoleUrl}
                        className="text-blue-600 hover:underline"
                        onClick={(e) => {
                          e.preventDefault()
                          window.api['web-open-url'](consoleUrl)
                        }}
                      >
                        {providerName} Console
                      </a>
                    </p>
                  )}
                </div>

                {testResult && (
                  <div
                    className={`p-2 rounded text-sm ${
                      testResult.valid
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {testResult.valid ? 'API key is valid!' : testResult.error}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsEditing(false)
                      setApiKey('')
                      setTestResult(null)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveApiKey}
                    disabled={!apiKey.trim() || isSaving}
                  >
                    {isSaving ? 'Saving...' : 'Save & Validate'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Test Connection */}
      <div>
        <div className="text-lg font-medium mb-4">Connection Status</div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Test Connection</div>
            <div className="text-xs text-gray-600 mt-1">
              Verify your transcription service is working correctly.
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={isTesting || (!hasApiKey && !providerIsKeyless)}
          >
            {isTesting ? 'Testing...' : 'Test'}
          </Button>
        </div>
        {testResult && !isEditing && (
          <div
            className={`mt-2 p-2 rounded text-sm ${
              testResult.valid
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {testResult.valid ? 'Connection successful!' : testResult.error}
          </div>
        )}
      </div>

      {/* Info Note */}
      <div className="text-xs text-gray-500 border-t pt-4">
        <p>
          {providerIsKeyless
            ? 'This provider runs locally and does not require an API key. To change your transcription provider, use the setup wizard in Advanced settings.'
            : 'Your API key is stored locally and encrypted. It is never sent to Ito servers. To change your transcription provider, use the setup wizard in Advanced settings.'}
        </p>
      </div>
    </div>
  )
}
