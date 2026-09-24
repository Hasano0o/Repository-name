/**
 * Router Lab — Mock Router — PHASE 5A
 *
 * Deterministic lookup — نفس path → نفس response.
 * لا Date.now، لا Math.random، لا network، لا storage.
 */

import {
  MockHttpResponse,
  MockLookupResult,
  MockRouterProfile,
} from './types';

// ────────────── Path normalization ──────────────

/**
 * يوحّد المسار للمقارنة:
 *   - يحذف query string
 *   - يحذف trailing slash (إلا للـ root)
 *   - يضمن بداية بـ /
 */
export function normalizePath(input: string): string {
  if (typeof input !== 'string') return '/';
  let p = input.split('?')[0];
  if (!p) return '/';
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

// ────────────── Index building ──────────────

function buildIndex(
  profile: MockRouterProfile,
): Map<string, Readonly<MockHttpResponse>> {
  const prefix = profile.basePath ?? '';
  const map = new Map<string, Readonly<MockHttpResponse>>();
  const all = [...profile.pages, ...profile.endpoints];
  for (const r of all) {
    const key = normalizePath(prefix + r.path);
    if (map.has(key)) {
      throw new Error(
        'MockRouterProfile "' + profile.id + '" has duplicate path: ' + key,
      );
    }
    map.set(key, r);
  }
  return map;
}

// ────────────── MockRouter ──────────────

export class MockRouter {
  private readonly _profile: MockRouterProfile;
  private readonly _index: Map<string, Readonly<MockHttpResponse>>;

  constructor(profile: MockRouterProfile) {
    this._profile = profile;
    this._index = buildIndex(profile);
  }

  get profile(): MockRouterProfile {
    return this._profile;
  }

  /**
   * يعيد الـ response المطابق للمسار، أو { matched: false }.
   * لا يرمي — الاستدعاء على مسار غير موجود سلوك طبيعي.
   */
  lookup(path: string): MockLookupResult {
    const key = normalizePath(path);
    const response = this._index.get(key);
    if (!response) {
      return { matched: false, reason: 'NOT_FOUND' };
    }
    return { matched: true, response };
  }

  /** قائمة المسارات المتاحة — sorted + deterministic */
  listPaths(): readonly string[] {
    return Array.from(this._index.keys()).sort();
  }
}

export function createMockRouter(profile: MockRouterProfile): MockRouter {
  return new MockRouter(profile);
}
