import { HashRouter, Routes, Route } from 'react-router-dom'
import appIcon from '@/resources/build/icon.png'
import HomeKit from '@/app/components/home/HomeKit'
import WelcomeKit from '@/app/components/welcome/WelcomeKit'
import Pill from '@/app/components/pill/Pill'
import {
  STEP_NAMES,
  STEP_NAMES_ARRAY,
  useOnboardingStore,
} from '@/app/store/useOnboardingStore'
import { useAuth } from '@/app/components/auth/useAuth'
import { WindowContextProvider } from '@/lib/window'
import { Auth0Provider } from '@/app/components/auth/Auth0Provider'
import { useDeviceChangeListener } from './hooks/useDeviceChangeListener'
import { verifyStoredMicrophone } from './media/microphone'
import { useEffect, useState } from 'react'
import { useAppModeStore, useAppMode } from '@/app/store/useAppModeStore'
import ModeSelection from '@/app/components/setup/ModeSelection'
import LocalModeSetup from '@/app/components/setup/LocalModeSetup'

/**
 * CloudApp - The original app flow for cloud mode users.
 * Handles Auth0 authentication and cloud onboarding.
 */
const CloudApp = () => {
  const { onboardingCompleted, onboardingStep } = useOnboardingStore()
  const { isAuthenticated } = useAuth()
  useDeviceChangeListener()

  useEffect(() => {
    verifyStoredMicrophone()
  }, [])

  const onboardingSetupCompleted =
    onboardingStep >= STEP_NAMES_ARRAY.indexOf(STEP_NAMES.TRY_IT_OUT)

  const shouldEnableShortcutGlobally =
    onboardingCompleted || onboardingSetupCompleted

  // If authenticated and onboarding completed, show main app
  if (isAuthenticated && onboardingCompleted) {
    window.api.send(
      'electron-store-set',
      'settings.isShortcutGloballyEnabled',
      shouldEnableShortcutGlobally,
    )
    return <HomeKit />
  }

  // If authenticated but onboarding not completed, continue onboarding
  window.api.send(
    'electron-store-set',
    'settings.isShortcutGloballyEnabled',
    shouldEnableShortcutGlobally,
  )
  return <WelcomeKit />
}

/**
 * LocalApp - App flow for local mode users.
 * Shows local onboarding then main app.
 */
const LocalApp = () => {
  const { onboardingCompleted, onboardingStep } = useOnboardingStore()
  useDeviceChangeListener()

  useEffect(() => {
    verifyStoredMicrophone()
  }, [])

  const onboardingSetupCompleted =
    onboardingStep >= STEP_NAMES_ARRAY.indexOf(STEP_NAMES.TRY_IT_OUT)

  const shouldEnableShortcutGlobally =
    onboardingCompleted || onboardingSetupCompleted

  // For local mode, if onboarding completed, show main app
  if (onboardingCompleted) {
    window.api.send(
      'electron-store-set',
      'settings.isShortcutGloballyEnabled',
      shouldEnableShortcutGlobally,
    )
    return <HomeKit />
  }

  // Show local mode onboarding (skips auth steps)
  window.api.send(
    'electron-store-set',
    'settings.isShortcutGloballyEnabled',
    shouldEnableShortcutGlobally,
  )
  return <WelcomeKit />
}

/**
 * MainApp - Routes between mode selection, setup, and the appropriate app flow.
 */
const MainApp = () => {
  const { initialize } = useAppModeStore()
  const { mode, isLoading, isConfigured } = useAppMode()
  const [setupStep, setSetupStep] = useState<'mode' | 'provider' | 'done'>('mode')

  // Initialize app mode store on mount
  useEffect(() => {
    initialize()
  }, [initialize])

  // Determine initial setup step based on stored state
  useEffect(() => {
    if (!isLoading) {
      if (mode === null) {
        setSetupStep('mode')
      } else if (mode === 'local' && !isConfigured) {
        setSetupStep('provider')
      } else {
        setSetupStep('done')
      }
    }
  }, [mode, isLoading, isConfigured])

  // Show loading while initializing
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  // Mode selection
  if (setupStep === 'mode') {
    return (
      <ModeSelection
        onModeSelected={(selectedMode) => {
          if (selectedMode === 'local') {
            setSetupStep('provider')
          } else {
            setSetupStep('done')
          }
        }}
      />
    )
  }

  // Local mode provider setup
  if (setupStep === 'provider') {
    return (
      <LocalModeSetup
        onComplete={() => setSetupStep('done')}
        onBack={() => {
          // Reset mode and go back to selection
          useAppModeStore.getState().resetConfig()
          setSetupStep('mode')
        }}
      />
    )
  }

  // Main app - route based on mode
  if (mode === 'local') {
    return <LocalApp />
  }

  return <CloudApp />
}

export default function App() {
  return (
    <Auth0Provider>
      <HashRouter>
        <Routes>
          {/* Route for the pill window */}
          <Route
            path="/pill"
            element={
              <>
                <Pill />
              </>
            }
          />

          {/* Default route for the main application window */}
          <Route
            path="/"
            element={
              <>
                <WindowContextProvider
                  titlebar={{ title: 'Ito', icon: appIcon }}
                >
                  <MainApp />
                </WindowContextProvider>
              </>
            }
          />
        </Routes>
      </HashRouter>
    </Auth0Provider>
  )
}
