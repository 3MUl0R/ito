import * as Sentry from '@sentry/electron/renderer'

// Check if app is in local mode - disable Sentry for privacy
const isLocalMode = (): boolean => {
  try {
    // Access electron store directly (synchronous)
    const appMode = (window as any).electron?.store?.get('appMode')
    return appMode === 'local'
  } catch {
    return false
  }
}

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
const environment =
  (import.meta.env.VITE_SENTRY_ENV as string | undefined) || 'local'

const tracesSampleRate = Number.parseFloat(
  (import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE as string | undefined) ||
    '0.2',
)

const profilesSampleRate = Number.parseFloat(
  (import.meta.env.VITE_SENTRY_PROFILES_SAMPLE_RATE as string | undefined) ||
    '0.2',
)

// Disable Sentry in local mode for privacy
const sentryEnabled = Boolean(dsn) && !isLocalMode()

if (isLocalMode()) {
  console.log('[Sentry] Local mode - error reporting disabled')
}

Sentry.init({
  enabled: sentryEnabled,
  dsn,
  environment,
  tracesSampleRate,
  profilesSampleRate,
  beforeBreadcrumb: breadcrumb =>
    breadcrumb?.category === 'console' ? null : breadcrumb,
  integrations: integrations =>
    integrations.filter(integration =>
      typeof (integration as any).name === 'string'
        ? !(
            (integration as any).name.toLowerCase().includes('console') ||
            (integration as any).name.toLowerCase() === 'breadcrumbs'
          )
        : true,
    ),
})
