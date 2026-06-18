import * as Sentry from '@sentry/react-native'

/**
 * Track a business event as a Sentry breadcrumb + message.
 * Low-noise: breadcrumb is always added; captureMessage fires at 'info' level
 * so it appears in Sentry without inflating error counts.
 */
export function track(event: string, extras?: Record<string, unknown>): void {
  Sentry.addBreadcrumb({
    category: 'business',
    message: event,
    data: extras,
    level: 'info',
  })
  Sentry.captureMessage(event, {
    level: 'info',
    extra: extras,
  })
}
