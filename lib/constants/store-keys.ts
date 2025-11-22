// Store key constants to avoid magic strings
// This file can be imported by both main and renderer processes
export const STORE_KEYS = {
  AUTH: 'auth',
  USER_PROFILE: 'userProfile',
  ID_TOKEN: 'idToken',
  ACCESS_TOKEN: 'accessToken',
  MAIN: 'main',
  ONBOARDING: 'onboarding',
  SETTINGS: 'settings',
  ADVANCED_SETTINGS: 'advancedSettings',
  OPEN_MIC: 'openMic',
  SELECTED_AUDIO_INPUT: 'selectedAudioInput',
  INTERACTION_SOUNDS: 'interactionSounds',

  // Local mode keys
  APP_MODE: 'appMode', // 'local' | 'cloud'
  LOCAL_USER_ID: 'localUserId',
  LOCAL_MODE_SETTINGS: 'localModeSettings',
  LOCAL_MODE_VALIDATED: 'localModeValidated', // Timestamp of last successful validation
  // Note: API keys stored separately with encryption via localModeStore
} as const

export type StoreKey = (typeof STORE_KEYS)[keyof typeof STORE_KEYS]
