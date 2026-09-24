/**
 * Router Lab — Realistic Fixtures Registry — PHASE 5F
 *
 * القواعد:
 *   - REALISTIC_FIXTURES: بيانات واقعية البنية، اصطناعية القيم
 *   - BEHAVIORAL_FIXTURES: ردود شاذة لاختبار المتانة
 *   - لا capability declarations — فقط HTTP evidence
 */

import { MockRouterProfile } from '../types';

import { HUAWEI_LTE_REALISTIC } from './huawei-lte';
import { HUAWEI_5G_REALISTIC } from './huawei-5g';
import { ZTE_LTE_REALISTIC } from './zte-lte';
import { ZTE_5G_REALISTIC } from './zte-5g';
import { UNKNOWN_CPE_REALISTIC } from './unknown-cpe';
import { MALFORMED_FIXTURE } from './malformed';
import { PARTIAL_FIXTURE } from './partial';

export {
  HUAWEI_LTE_REALISTIC,
  HUAWEI_5G_REALISTIC,
  ZTE_LTE_REALISTIC,
  ZTE_5G_REALISTIC,
  UNKNOWN_CPE_REALISTIC,
  MALFORMED_FIXTURE,
  PARTIAL_FIXTURE,
};

export { DISCLOSURE_UNIFORM } from './metadata';

export const REALISTIC_FIXTURES: readonly MockRouterProfile[] = [
  HUAWEI_LTE_REALISTIC,
  HUAWEI_5G_REALISTIC,
  ZTE_LTE_REALISTIC,
  ZTE_5G_REALISTIC,
  UNKNOWN_CPE_REALISTIC,
];

export const BEHAVIORAL_FIXTURES: readonly MockRouterProfile[] = [
  MALFORMED_FIXTURE,
  PARTIAL_FIXTURE,
];

export const ALL_LAB_FIXTURES: readonly MockRouterProfile[] = [
  ...REALISTIC_FIXTURES,
  ...BEHAVIORAL_FIXTURES,
];
