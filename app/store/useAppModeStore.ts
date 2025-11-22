import { create } from 'zustand'
import type { LocalModeSettings, SanitizedLocalModeSettings } from '../../lib/clients/providers/types'

export type AppMode = 'local' | 'cloud' | null

interface AppModeState {
  // State
  mode: AppMode
  isLoading: boolean
  isConfigured: boolean
  /** Sanitized settings - contains hasApiKey, not actual keys */
  settings: SanitizedLocalModeSettings | null
  isSafeStorageAvailable: boolean

  // Actions
  initialize: () => Promise<void>
  setMode: (mode: 'local' | 'cloud') => Promise<void>
  setSettings: (settings: LocalModeSettings) => Promise<{ success: boolean; error?: string }>
  validateProvider: () => Promise<{ valid: boolean; error?: string }>
  resetConfig: () => Promise<{ success: boolean; error?: string }>
  refreshSettings: () => Promise<void>
}

export const useAppModeStore = create<AppModeState>((set) => ({
  mode: null,
  isLoading: true,
  isConfigured: false,
  settings: null,
  isSafeStorageAvailable: true,

  initialize: async () => {
    try {
      set({ isLoading: true })

      const [mode, isConfigured, settings, isSafeStorageAvailable] = await Promise.all([
        window.api.localMode.getAppMode(),
        window.api.localMode.isConfigured(),
        window.api.localMode.getSettings(),
        window.api.localMode.isSafeStorageAvailable(),
      ])

      set({
        mode,
        isConfigured,
        settings,
        isSafeStorageAvailable,
        isLoading: false,
      })
    } catch (error) {
      console.error('[useAppModeStore] Failed to initialize:', error)
      set({ isLoading: false })
    }
  },

  setMode: async (mode: 'local' | 'cloud') => {
    try {
      await window.api.localMode.setAppMode(mode)
      set({ mode })
    } catch (error) {
      console.error('[useAppModeStore] Failed to set mode:', error)
      throw error
    }
  },

  setSettings: async (settings: LocalModeSettings) => {
    try {
      const result = await window.api.localMode.setSettings(settings)
      if (result.success) {
        // Refresh settings and configured state
        const [newSettings, isConfigured] = await Promise.all([
          window.api.localMode.getSettings(),
          window.api.localMode.isConfigured(),
        ])
        set({ settings: newSettings, isConfigured })
      }
      return result
    } catch (error: any) {
      console.error('[useAppModeStore] Failed to save settings:', error)
      return { success: false, error: error?.message || 'Failed to save settings' }
    }
  },

  validateProvider: async () => {
    try {
      const result = await window.api.localMode.validateProvider()

      if (result.valid) {
        // Refresh isConfigured state after successful validation
        const isConfigured = await window.api.localMode.isConfigured()
        set({ isConfigured })
      }

      return result
    } catch (error: any) {
      console.error('[useAppModeStore] Failed to validate provider:', error)
      return { valid: false, error: error?.message || 'Validation failed' }
    }
  },

  resetConfig: async () => {
    try {
      const result = await window.api.localMode.resetConfig()
      if (result.success) {
        set({
          mode: null,
          isConfigured: false,
          settings: null,
        })
      }
      return result
    } catch (error: any) {
      console.error('[useAppModeStore] Failed to reset config:', error)
      return { success: false, error: error?.message || 'Failed to reset config' }
    }
  },

  refreshSettings: async () => {
    try {
      const [settings, isConfigured] = await Promise.all([
        window.api.localMode.getSettings(),
        window.api.localMode.isConfigured(),
      ])
      set({ settings, isConfigured })
    } catch (error) {
      console.error('[useAppModeStore] Failed to refresh settings:', error)
    }
  },
}))

/**
 * Simple hook for components to check app mode.
 */
export function useAppMode() {
  const { mode, isLoading, isConfigured } = useAppModeStore()

  return {
    mode,
    isLoading,
    isConfigured,
    isLocal: mode === 'local',
    isCloud: mode === 'cloud',
    hasSelectedMode: mode !== null,
  }
}
