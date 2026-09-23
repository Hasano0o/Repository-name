/**
 * Screenshot Consent State — PHASE 4C-1
 *
 * In-memory فقط — لا تخزين دائم، لا SecureStore، لا AsyncStorage.
 * كل دالة نقية: تُعيد حالة جديدة، لا تُعدّل الأصل.
 */

export type ConsentDecision = 'PENDING' | 'GRANTED' | 'REVOKED';

export interface ScreenshotConsentState {
  decision: ConsentDecision;
  /** متى مُنحت الموافقة (ms since epoch) — فقط عند GRANTED */
  grantedAt?: number;
}

export function createConsentState(): ScreenshotConsentState {
  return { decision: 'PENDING' };
}

export function grantConsent(
  _state: ScreenshotConsentState,
  now: number,
): ScreenshotConsentState {
  return { decision: 'GRANTED', grantedAt: now };
}

export function revokeConsent(
  _state: ScreenshotConsentState,
): ScreenshotConsentState {
  return { decision: 'REVOKED' };
}

export function isConsentGranted(state: ScreenshotConsentState): boolean {
  return state.decision === 'GRANTED';
}
