/**
 * screenshot-result-ui.test.ts — PHASE 4C-2C-3
 * Pure helpers tests only — no React, no snapshots.
 */

import {
  translateIntegrationFailure,
  formatStats,
} from '../screenshot/ui-helpers';

describe('translateIntegrationFailure', () => {
  test('NO_CONSENT → Arabic with موافقة', () => {
    expect(translateIntegrationFailure('NO_CONSENT')).toMatch(/موافقة/);
  });
  test('NO_EVIDENCE → Arabic with أدلة', () => {
    expect(translateIntegrationFailure('NO_EVIDENCE')).toMatch(/أدلة/);
  });
  test('does not leak raw codes', () => {
    expect(translateIntegrationFailure('NO_CONSENT')).not.toBe('NO_CONSENT');
    expect(translateIntegrationFailure('NO_EVIDENCE')).not.toBe('NO_EVIDENCE');
  });
  test('returns non-empty strings', () => {
    expect(translateIntegrationFailure('NO_CONSENT').length).toBeGreaterThan(0);
    expect(translateIntegrationFailure('NO_EVIDENCE').length).toBeGreaterThan(0);
  });
  test('pure — same input → same output', () => {
    expect(translateIntegrationFailure('NO_CONSENT')).toBe(
      translateIntegrationFailure('NO_CONSENT'),
    );
  });
});

describe('formatStats', () => {
  const stats = { filled: 5, overridden: 2, sanitized: 1, hintsIgnored: 3 };

  test('returns 4 rows in order', () => {
    const rows = formatStats(stats);
    expect(rows.length).toBe(4);
    expect(rows[0].value).toBe(5);
    expect(rows[1].value).toBe(2);
    expect(rows[2].value).toBe(1);
    expect(rows[3].value).toBe(3);
  });

  test('all labels are Arabic', () => {
    for (const row of formatStats(stats)) {
      expect(/[\u0600-\u06FF]/.test(row.label)).toBe(true);
    }
  });

  test('handles zeros without dropping them', () => {
    const rows = formatStats({ filled: 0, overridden: 0, sanitized: 0, hintsIgnored: 0 });
    expect(rows.length).toBe(4);
    for (const row of rows) expect(row.value).toBe(0);
  });

  test('preserves large values', () => {
    const rows = formatStats({ filled: 999999, overridden: 0, sanitized: 0, hintsIgnored: 0 });
    expect(rows[0].value).toBe(999999);
  });

  test('does not mutate input object', () => {
    const input = { filled: 5, overridden: 2, sanitized: 1, hintsIgnored: 3 };
    const snap = JSON.stringify(input);
    formatStats(input);
    expect(JSON.stringify(input)).toBe(snap);
  });
});
