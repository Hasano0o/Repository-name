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
