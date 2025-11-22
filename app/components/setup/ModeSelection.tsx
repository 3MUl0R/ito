import ItoIcon from '../icons/ItoIcon'
import { useAppModeStore } from '@/app/store/useAppModeStore'
import { useState } from 'react'

interface ModeSelectionProps {
  onModeSelected: (mode: 'local' | 'cloud') => void
}

export default function ModeSelection({ onModeSelected }: ModeSelectionProps) {
  const { setMode } = useAppModeStore()
  const [isSelecting, setIsSelecting] = useState(false)

  const handleSelectMode = async (mode: 'local' | 'cloud') => {
    setIsSelecting(true)
    try {
      await setMode(mode)
      onModeSelected(mode)
    } catch (error) {
      console.error('Failed to set mode:', error)
    } finally {
      setIsSelecting(false)
    }
  }

  return (
    <div className="flex flex-col h-full w-full bg-background items-center justify-center">
      <div className="flex flex-col items-center w-full max-w-lg px-8 py-16">
        {/* Logo */}
        <div className="mb-4 bg-black rounded-md p-2 w-10 h-10">
          <ItoIcon height={24} width={24} style={{ color: '#FFFFFF' }} />
        </div>

        {/* Title and subtitle */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-semibold mb-3 text-foreground">
            Welcome to Ito
          </h1>
          <p className="text-muted-foreground text-base">
            How would you like to use Ito?
          </p>
        </div>

        {/* Mode options */}
        <div className="w-full space-y-4">
          {/* Local Mode */}
          <button
            onClick={() => handleSelectMode('local')}
            disabled={isSelecting}
            className="w-full p-6 rounded-lg border border-border bg-card hover:bg-accent hover:border-accent-foreground/20 transition-colors text-left group disabled:opacity-50"
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-md bg-emerald-500/10 flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-emerald-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  Local Mode
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Everything stays on your computer. You provide your own API key.
                  No account required.
                </p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2">
                    <svg className="w-3 h-3 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Full privacy - data never leaves your device
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-3 h-3 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Use Groq, OpenAI, or self-hosted Whisper
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-3 h-3 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Free forever - bring your own API key
                  </li>
                </ul>
              </div>
            </div>
          </button>

          {/* Cloud Mode */}
          <button
            onClick={() => handleSelectMode('cloud')}
            disabled={isSelecting}
            className="w-full p-6 rounded-lg border border-border bg-card hover:bg-accent hover:border-accent-foreground/20 transition-colors text-left group disabled:opacity-50"
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-md bg-blue-500/10 flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  Cloud Mode
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Sync across devices. Cloud backup. Requires an Ito account.
                </p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2">
                    <svg className="w-3 h-3 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Sync across all your devices
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-3 h-3 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Automatic cloud backup
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="w-3 h-3 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    No API key needed - we handle it
                  </li>
                </ul>
              </div>
            </div>
          </button>
        </div>

        {/* Footer note */}
        <p className="mt-8 text-xs text-muted-foreground text-center">
          You can change this later in Settings.
        </p>
      </div>
    </div>
  )
}
