/**
 * lab-hosts.test.ts — PHASE 5C
 */

import { MOCK_HOSTS, isMockHost, getProfileForHost } from '../lab/hosts';
import {
  NORMAL_PROFILES,
  MALICIOUS_FIXTURES,
  ALL_PROFILES,
} from '../lab/profiles';

describe('MOCK_HOSTS mapping', () => {
  test('has 10 entries', () => {
    expect(Object.keys(MOCK_HOSTS).length).toBe(10);
  });

  test('all hosts are in 192.168.255.x range', () => {
    for (const host of Object.keys(MOCK_HOSTS)) {
      expect(host).toMatch(/^192\.168\.255\.\d+$/);
    }
  });

  test('every normal profile is mapped', () => {
    const mappedIds = new Set(Object.values(MOCK_HOSTS).map((p) => p.id));
    for (const p of NORMAL_PROFILES) {
      expect(mappedIds.has(p.id)).toBe(true);
    }
  });

  test('every malicious fixture is mapped', () => {
    const mappedIds = new Set(Object.values(MOCK_HOSTS).map((p) => p.id));
    for (const p of MALICIOUS_FIXTURES) {
      expect(mappedIds.has(p.id)).toBe(true);
    }
  });

  test('every mapped profile exists in ALL_PROFILES', () => {
    const allIds = new Set(ALL_PROFILES.map((p) => p.id));
    for (const profile of Object.values(MOCK_HOSTS)) {
      expect(allIds.has(profile.id)).toBe(true);
    }
  });
});

describe('isMockHost', () => {
  test('true for known host', () => {
    expect(isMockHost('192.168.255.1')).toBe(true);
  });
  test('true for known fixture host', () => {
    expect(isMockHost('192.168.255.13')).toBe(true);
  });
  test('false for unknown host in same subnet', () => {
    expect(isMockHost('192.168.255.99')).toBe(false);
  });
  test('false for different subnet', () => {
    expect(isMockHost('192.168.1.1')).toBe(false);
  });
  test('false for empty string', () => {
    expect(isMockHost('')).toBe(false);
  });
  test('false for non-IP', () => {
    expect(isMockHost('example.com')).toBe(false);
  });
});

describe('getProfileForHost', () => {
  test('returns profile for 192.168.255.1', () => {
    const p = getProfileForHost('192.168.255.1');
    expect(p).not.toBeNull();
    expect(p?.id).toBe('huawei-generic-v1');
  });
  test('returns profile for 192.168.255.3 (ZTE)', () => {
    expect(getProfileForHost('192.168.255.3')?.vendor).toBe('ZTE');
  });
  test('returns null for unknown host', () => {
    expect(getProfileForHost('192.168.255.99')).toBeNull();
  });
  test('returns null for public host', () => {
    expect(getProfileForHost('8.8.8.8')).toBeNull();
  });
});
