/**
 * Router Lab — Host Mapping — PHASE 5C
 *
 * 192.168.255.x — LAN range reserved for the lab.
 * Exact host match only (no wildcards).
 */

import { MockRouterProfile } from './types';
import {
  HUAWEI_GENERIC_V1,
  HUAWEI_GENERIC_V2,
  ZTE_GENERIC_V1,
  ZTE_GENERIC_V2,
  UNKNOWN_GENERIC,
  UNKNOWN_NOISY,
  SENSITIVE_VALUES_FIXTURE,
  REDIRECT_FIXTURE,
  WRITE_ENDPOINT_FIXTURE,
  AUTH_ENDPOINT_FIXTURE,
} from './profiles';

export const MOCK_HOSTS: Readonly<Record<string, MockRouterProfile>> = {
  '192.168.255.1': HUAWEI_GENERIC_V1,
  '192.168.255.2': HUAWEI_GENERIC_V2,
  '192.168.255.3': ZTE_GENERIC_V1,
  '192.168.255.4': ZTE_GENERIC_V2,
  '192.168.255.5': UNKNOWN_GENERIC,
  '192.168.255.6': UNKNOWN_NOISY,
  '192.168.255.10': SENSITIVE_VALUES_FIXTURE,
  '192.168.255.11': REDIRECT_FIXTURE,
  '192.168.255.12': WRITE_ENDPOINT_FIXTURE,
  '192.168.255.13': AUTH_ENDPOINT_FIXTURE,
};

export function isMockHost(host: string): boolean {
  return Object.prototype.hasOwnProperty.call(MOCK_HOSTS, host);
}

export function getProfileForHost(host: string): MockRouterProfile | null {
  return MOCK_HOSTS[host] ?? null;
}
