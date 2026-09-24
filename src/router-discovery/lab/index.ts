/**
 * Router Lab — Public API — PHASE 5A
 */

export type {
  MockHttpMethod,
  MockHttpResponse,
  MockLookupReason,
  MockLookupResult,
  MockRouterProfile,
} from './types';

export {
  HUAWEI_GENERIC,
  ZTE_GENERIC,
  UNKNOWN_GENERIC,
  SENSITIVE_VALUES_FIXTURE,
  REDIRECT_FIXTURE,
  WRITE_ENDPOINT_FIXTURE,
  AUTH_ENDPOINT_FIXTURE,
  NORMAL_PROFILES,
  MALICIOUS_FIXTURES,
  ALL_PROFILES,
} from './profiles';

export { MockRouter, createMockRouter, normalizePath } from './router';

// ─────────────────────────────────────────────────────────────────
// PHASE 5F — Realistic Fixtures
// ─────────────────────────────────────────────────────────────────

export {
  HUAWEI_LTE_REALISTIC,
  HUAWEI_5G_REALISTIC,
  ZTE_LTE_REALISTIC,
  ZTE_5G_REALISTIC,
  UNKNOWN_CPE_REALISTIC,
  MALFORMED_FIXTURE,
  PARTIAL_FIXTURE,
  REALISTIC_FIXTURES,
  BEHAVIORAL_FIXTURES,
  ALL_LAB_FIXTURES,
  DISCLOSURE_UNIFORM,
} from './fixtures';
