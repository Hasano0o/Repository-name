/**
 * screenshot-consent.test.ts — PHASE 4C-1
 */

import {
  createConsentState,
  grantConsent,
  revokeConsent,
  isConsentGranted,
} from '../screenshot/consent';

describe('consent — initial state', () => {
  test('new state is PENDING', () => {
    const s = createConsentState();
    expect(s.decision).toBe('PENDING');
    expect(s.grantedAt).toBeUndefined();
  });

  test('isConsentGranted false for PENDING', () => {
    expect(isConsentGranted(createConsentState())).toBe(false);
  });
});

describe('consent — grant', () => {
  test('grant → GRANTED with grantedAt', () => {
    const s = grantConsent(createConsentState(), 1234567890);
    expect(s.decision).toBe('GRANTED');
    expect(s.grantedAt).toBe(1234567890);
  });

  test('isConsentGranted true for GRANTED', () => {
    const s = grantConsent(createConsentState(), 1);
    expect(isConsentGranted(s)).toBe(true);
  });

  test('grant does not mutate input state', () => {
    const before = createConsentState();
    const snapshot = JSON.stringify(before);
    grantConsent(before, 100);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  test('grant is idempotent', () => {
    const a = grantConsent(createConsentState(), 100);
    const b = grantConsent(a, 200);
    expect(b.decision).toBe('GRANTED');
    expect(b.grantedAt).toBe(200);
  });
});

describe('consent — revoke', () => {
  test('revoke from PENDING → REVOKED', () => {
    const s = revokeConsent(createConsentState());
    expect(s.decision).toBe('REVOKED');
    expect(s.grantedAt).toBeUndefined();
  });

  test('revoke from GRANTED → REVOKED', () => {
    const g = grantConsent(createConsentState(), 100);
    const r = revokeConsent(g);
    expect(r.decision).toBe('REVOKED');
    expect(isConsentGranted(r)).toBe(false);
  });

  test('revoke does not mutate input', () => {
    const g = grantConsent(createConsentState(), 100);
    const snap = JSON.stringify(g);
    revokeConsent(g);
    expect(JSON.stringify(g)).toBe(snap);
  });

  test('isConsentGranted false for REVOKED', () => {
    expect(isConsentGranted(revokeConsent(createConsentState()))).toBe(false);
  });
});
