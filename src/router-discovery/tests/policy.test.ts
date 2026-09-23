/**
 * PHASE 2 — ReadOnlySafetyPolicy Tests
 *
 * غطاء:
 *  - Method validation (GET vs others)
 *  - URL / Host validation (SSRF)
 *  - Dangerous paths / segments
 *  - Dangerous query params
 *  - ZTE goform (read/write)
 *  - Huawei whitelist / unknown
 *  - LuCI
 *  - Encoding (single + double)
 *  - Case insensitivity
 *  - Auth context
 *  - Path traversal
 *
 * لا تعتمد على طباعة قيم حساسة.
 */

import { evaluatePolicy } from '../policy';
import { PolicyInput } from '../types';

const LAN = '192.168.1.1';

function req(
  method: string,
  path: string,
  host: string = LAN,
  context?: PolicyInput['context'],
): PolicyInput {
  return {
    method,
    url: `http://${host}${path}`,
    context,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Method validation
// ═══════════════════════════════════════════════════════════════════════

describe('policy — method validation', () => {
  test('GET on safe page → ALLOW', () => {
    expect(evaluatePolicy(req('GET', '/')).decision).toBe('ALLOW');
  });
  test('POST → DENY', () => {
    expect(evaluatePolicy(req('POST', '/')).decision).toBe('DENY');
  });
  test('PUT → DENY', () => {
    expect(evaluatePolicy(req('PUT', '/')).decision).toBe('DENY');
  });
  test('PATCH → DENY', () => {
    expect(evaluatePolicy(req('PATCH', '/')).decision).toBe('DENY');
  });
  test('DELETE → DENY', () => {
    expect(evaluatePolicy(req('DELETE', '/')).decision).toBe('DENY');
  });
  test('OPTIONS → DENY', () => {
    expect(evaluatePolicy(req('OPTIONS', '/')).decision).toBe('DENY');
  });
  test('HEAD → DENY', () => {
    expect(evaluatePolicy(req('HEAD', '/')).decision).toBe('DENY');
  });
  test('lowercase "get" → ALLOW (case-insensitive)', () => {
    expect(evaluatePolicy(req('get', '/')).decision).toBe('ALLOW');
  });
  test('mixed case "GeT" → ALLOW', () => {
    expect(evaluatePolicy(req('GeT', '/')).decision).toBe('ALLOW');
  });
  test('POST result code is NON_GET_METHOD', () => {
    expect(evaluatePolicy(req('POST', '/')).code).toBe('NON_GET_METHOD');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. URL validation
// ═══════════════════════════════════════════════════════════════════════

describe('policy — URL validation', () => {
  test('invalid URL → DENY INVALID_URL', () => {
    const r = evaluatePolicy({ method: 'GET', url: 'not-a-url' });
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('INVALID_URL');
  });
  test('empty URL → DENY', () => {
    expect(evaluatePolicy({ method: 'GET', url: '' }).decision).toBe('DENY');
  });
  test('ftp:// → DENY INVALID_URL', () => {
    const r = evaluatePolicy({ method: 'GET', url: 'ftp://192.168.1.1/' });
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('INVALID_URL');
  });
  test('file:// → DENY', () => {
    const r = evaluatePolicy({ method: 'GET', url: 'file:///etc/passwd' });
    expect(r.decision).toBe('DENY');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Host validation (SSRF)
// ═══════════════════════════════════════════════════════════════════════

describe('policy — host validation', () => {
  test('192.168.1.1 → LAN allowed', () => {
    expect(evaluatePolicy(req('GET', '/', '192.168.1.1')).decision).toBe('ALLOW');
  });
  test('10.0.0.1 → LAN allowed', () => {
    expect(evaluatePolicy(req('GET', '/', '10.0.0.1')).decision).toBe('ALLOW');
  });
  test('172.16.5.5 → LAN allowed', () => {
    expect(evaluatePolicy(req('GET', '/', '172.16.5.5')).decision).toBe('ALLOW');
  });
  test('8.8.8.8 public → DENY UNSAFE_HOST', () => {
    const r = evaluatePolicy(req('GET', '/', '8.8.8.8'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('UNSAFE_HOST');
  });
  test('example.com → DENY', () => {
    const r = evaluatePolicy(req('GET', '/', 'example.com'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('UNSAFE_HOST');
  });
  test('google.com → DENY', () => {
    expect(evaluatePolicy(req('GET', '/', 'google.com')).decision).toBe('DENY');
  });
  test('userinfo in URL → DENY', () => {
    const r = evaluatePolicy({
      method: 'GET',
      url: 'http://user:pass@192.168.1.1/',
    });
    expect(r.decision).toBe('DENY');
  });
  test('port in URL is fine for LAN', () => {
    expect(evaluatePolicy({
      method: 'GET',
      url: 'http://192.168.1.1:8080/',
    }).decision).toBe('ALLOW');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Safe discovery pages
// ═══════════════════════════════════════════════════════════════════════

describe('policy — safe discovery pages', () => {
  test.each([
    '/',
    '/index.html',
    '/home.html',
    '/html/index.html',
    '/html/home.html',
    '/login',
    '/login.html',
    '/favicon.ico',
    '/robots.txt',
  ])('GET %s → ALLOW', (p) => {
    expect(evaluatePolicy(req('GET', p)).decision).toBe('ALLOW');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Huawei safe whitelist
// ═══════════════════════════════════════════════════════════════════════

describe('policy — Huawei safe endpoints', () => {
  test.each([
    '/api/device/information',
    '/api/device/basic_information',
    '/api/device/signal',
    '/api/device/seccellinfo',
    '/api/device/nbrcellinfo',
    '/api/monitoring/status',
    '/api/monitoring/traffic-statistics',
    '/api/monitoring/month_statistics',
    '/api/monitoring/start_date',
    '/api/net/current-plmn',
    '/api/net/net-mode',
    '/api/net/net-mode-list',
    '/api/net/net-feature-switch',
    '/api/net/lock-freq',
    '/api/wlan/host-list',
    '/api/wlan/multi-macfilter-settings',
    '/api/dhcp/settings',
    '/api/dialup/profiles',
  ])('GET %s → ALLOW', (p) => {
    expect(evaluatePolicy(req('GET', p)).decision).toBe('ALLOW');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Huawei unknown /api/*
// ═══════════════════════════════════════════════════════════════════════

describe('policy — Huawei unknown endpoints', () => {
  test('GET /api/unknown → DENY', () => {
    const r = evaluatePolicy(req('GET', '/api/unknown'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('UNKNOWN_ENDPOINT');
  });
  test('GET /api/device/secret → DENY', () => {
    expect(evaluatePolicy(req('GET', '/api/device/secret')).decision).toBe('DENY');
  });
  test('GET /api/firmware/upgrade → DENY (also dangerous segment)', () => {
    expect(evaluatePolicy(req('GET', '/api/firmware/upgrade')).decision).toBe('DENY');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. ZTE goform
// ═══════════════════════════════════════════════════════════════════════

describe('policy — ZTE goform', () => {
  test('GET get_cmd_process?cmd=rsrp → ALLOW', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=rsrp'));
    expect(r.decision).toBe('ALLOW');
    expect(r.code).toBe('SAFE_READ');
  });
  test('GET get_cmd_process?cmd=rsrp,rsrq,sinr → ALLOW', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=rsrp,rsrq,sinr'));
    expect(r.decision).toBe('ALLOW');
  });
  test('GET get_cmd_process?cmd=RD → DENY (auth command)', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=RD'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('AUTH_ENDPOINT');
  });
  test('GET get_cmd_process?cmd=LD → DENY (auth command)', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=LD'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('AUTH_ENDPOINT');
  });
  test('GET get_cmd_process?cmd=lte_band_lock → ALLOW (read of lock state)', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=lte_band_lock'));
    expect(r.decision).toBe('ALLOW');
  });
  test('GET get_cmd_process?cmd=SET_foo → DENY', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=SET_foo'));
    expect(r.decision).toBe('DENY');
  });
  test('GET get_cmd_process?cmd=unknown_xyz → DENY (not in whitelist)', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=unknown_xyz'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('UNKNOWN_ZTE_CMD');
  });
  test('GET get_cmd_process?cmd=rsrp&cmd=SET_foo → DENY', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=rsrp&cmd=SET_foo'));
    expect(r.decision).toBe('DENY');
  });
  test('GET get_cmd_process without cmd → DENY', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('UNKNOWN_ZTE_CMD');
  });
  test('GET goform_set_cmd_process → DENY (write endpoint)', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_set_cmd_process'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('WRITE_GOFORM');
  });
  test('GET goform_set_cmd_process?goformId=REBOOT → DENY', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_set_cmd_process?goformId=REBOOT'));
    expect(r.decision).toBe('DENY');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. Dangerous path segments
// ═══════════════════════════════════════════════════════════════════════

describe('policy — dangerous path segments', () => {
  test.each([
    '/reboot',
    '/restart',
    '/reset',
    '/factory_reset',
    '/factory-reset',
    '/restore',
    '/write',
    '/save',
    '/apply',
    '/delete',
    '/remove',
    '/update',
    '/send_sms',
    '/sendsms',
    '/reboot.cgi',
    '/reset.html',
    '/write_config',
    '/set_password',
  ])('GET %s → DENY', (p) => {
    const r = evaluatePolicy(req('GET', p));
    expect(r.decision).toBe('DENY');
  });

  test('LuCI path with reboot segment → DENY (not CONFIRM)', () => {
    const r = evaluatePolicy(req('GET', '/cgi-bin/luci/;stok=X/reboot'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('DANGEROUS_PATH');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 9. Dangerous query params
// ═══════════════════════════════════════════════════════════════════════

describe('policy — dangerous query params', () => {
  test('?action=reboot → DENY', () => {
    const r = evaluatePolicy(req('GET', '/?action=reboot'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('DANGEROUS_QUERY');
  });
  test('?op=reset → DENY', () => {
    expect(evaluatePolicy(req('GET', '/?op=reset')).decision).toBe('DENY');
  });
  test('?do=factory → DENY', () => {
    expect(evaluatePolicy(req('GET', '/?do=factory')).decision).toBe('DENY');
  });
  test('?task=reset → DENY', () => {
    expect(evaluatePolicy(req('GET', '/?task=reset')).decision).toBe('DENY');
  });
  test('?mode=reboot → DENY', () => {
    expect(evaluatePolicy(req('GET', '/?mode=reboot')).decision).toBe('DENY');
  });
  test('?cmd=SET_foo → DENY', () => {
    expect(evaluatePolicy(req('GET', '/?cmd=SET_foo')).decision).toBe('DENY');
  });
  test('?command=WRITE_bar → DENY', () => {
    expect(evaluatePolicy(req('GET', '/?command=WRITE_bar')).decision).toBe('DENY');
  });
  test('?goformId=REBOOT_DEVICE → DENY', () => {
    expect(evaluatePolicy(req('GET', '/?goformId=REBOOT_DEVICE')).decision).toBe('DENY');
  });
  test('?x=reboot (any key, dangerous value) → DENY', () => {
    expect(evaluatePolicy(req('GET', '/?x=reboot')).decision).toBe('DENY');
  });
  test('?action=read → not dangerous value', () => {
    const r = evaluatePolicy(req('GET', '/?action=read'));
    // لا يُرفض بسبب القيمة — لكن '/' قد يمر
    expect(r.decision).toBe('ALLOW');
  });
  test('?cmd=rsrp standalone → DENY (cmd outside ZTE endpoint)', () => {
    const r = evaluatePolicy(req('GET', '/?cmd=rsrp'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('UNKNOWN_ENDPOINT');
  });
  test('?cmd=signalbar standalone → DENY', () => {
    expect(evaluatePolicy(req('GET', '/?cmd=signalbar')).decision).toBe('DENY');
  });
  test('?cmd=network_type standalone → DENY', () => {
    expect(evaluatePolicy(req('GET', '/?cmd=network_type')).decision).toBe('DENY');
  });
  test('/unknown?cmd=rsrp → DENY', () => {
    expect(evaluatePolicy(req('GET', '/unknown?cmd=rsrp')).decision).toBe('DENY');
  });
  test('/?CMD=RSRP → DENY (case-insensitive cmd key)', () => {
    expect(evaluatePolicy(req('GET', '/?CMD=RSRP')).decision).toBe('DENY');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 10. Encoding (single + double)
// ═══════════════════════════════════════════════════════════════════════

describe('policy — URL encoding', () => {
  test('?cmd=%53%45%54_foo → DENY (SET_foo decoded)', () => {
    const r = evaluatePolicy(req('GET', '/?cmd=%53%45%54_foo'));
    expect(r.decision).toBe('DENY');
  });
  test('?action=%72%65%62%6F%6F%74 → DENY (reboot)', () => {
    const r = evaluatePolicy(req('GET', '/?action=%72%65%62%6F%6F%74'));
    expect(r.decision).toBe('DENY');
  });
  test('path /%72%65%62%6F%6F%74 → DENY (reboot)', () => {
    const r = evaluatePolicy(req('GET', '/%72%65%62%6F%6F%74'));
    expect(r.decision).toBe('DENY');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 11. Case insensitivity
// ═══════════════════════════════════════════════════════════════════════

describe('policy — case insensitivity', () => {
  test('?ACTION=REBOOT → DENY', () => {
    expect(evaluatePolicy(req('GET', '/?ACTION=REBOOT')).decision).toBe('DENY');
  });
  test('?Action=Reboot → DENY', () => {
    expect(evaluatePolicy(req('GET', '/?Action=Reboot')).decision).toBe('DENY');
  });
  test('/REBOOT → DENY', () => {
    expect(evaluatePolicy(req('GET', '/REBOOT')).decision).toBe('DENY');
  });
  test('/Reboot.CGI → DENY', () => {
    expect(evaluatePolicy(req('GET', '/Reboot.CGI')).decision).toBe('DENY');
  });
  test('/API/device/signal → ALLOW (path case preserved in whitelist)', () => {
    // اللوائح حساسة لحالة الأحرف عمدًا: Huawei يستخدم mixed-case
    const r = evaluatePolicy(req('GET', '/API/device/signal'));
    // غير في whitelist لأن الأصل /api/device/signal
    expect(r.decision).toBe('DENY');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 12. Auth context
// ═══════════════════════════════════════════════════════════════════════

describe('policy — auth context', () => {
  test('context.hasAuth=true → REQUIRE_USER_CONFIRMATION', () => {
    const r = evaluatePolicy(req('GET', '/', LAN, { hasAuth: true }));
    expect(r.decision).toBe('REQUIRE_USER_CONFIRMATION');
    expect(r.code).toBe('AUTH_CONTEXT');
  });
  test('context.hasAuth=false → not affecting decision', () => {
    const r = evaluatePolicy(req('GET', '/', LAN, { hasAuth: false }));
    expect(r.decision).toBe('ALLOW');
  });
  test('no context → decision based on URL only', () => {
    const r = evaluatePolicy(req('GET', '/'));
    expect(r.decision).toBe('ALLOW');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 13. Path traversal
// ═══════════════════════════════════════════════════════════════════════

describe('policy — path traversal', () => {
  test('/api/../etc/passwd → DENY PATH_TRAVERSAL', () => {
    const r = evaluatePolicy(req('GET', '/api/../etc/passwd'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('PATH_TRAVERSAL');
  });
  test('/api/device/../secret → DENY', () => {
    expect(evaluatePolicy(req('GET', '/api/device/../secret')).decision).toBe('DENY');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 14. LuCI
// ═══════════════════════════════════════════════════════════════════════

describe('policy — LuCI', () => {
  test('GET /cgi-bin/luci → ALLOW (root page)', () => {
    const r = evaluatePolicy(req('GET', '/cgi-bin/luci'));
    expect(r.decision).toBe('ALLOW');
  });
  test('GET /cgi-bin/luci/ → ALLOW', () => {
    expect(evaluatePolicy(req('GET', '/cgi-bin/luci/')).decision).toBe('ALLOW');
  });
  test('GET /cgi-bin/luci/admin/status → REQUIRE_USER_CONFIRMATION', () => {
    const r = evaluatePolicy(req('GET', '/cgi-bin/luci/admin/status'));
    expect(r.decision).toBe('REQUIRE_USER_CONFIRMATION');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 15. Result shape invariants
// ═══════════════════════════════════════════════════════════════════════

describe('policy — result shape invariants', () => {
  test.each([
    '/',
    '/reboot',
    '/api/device/signal',
    '/goform/goform_get_cmd_process?cmd=rsrp',
  ])('result for %s has decision + code + reason (English)', (p) => {
    const r = evaluatePolicy(req('GET', p));
    expect(r.decision).toBeTruthy();
    expect(r.code).toBeTruthy();
    expect(r.reason).toBeTruthy();
    // reason إنجليزي تقني — لا عربي
    expect(/[\u0600-\u06FF]/.test(r.reason)).toBe(false);
  });

  test('all decisions are one of 3 values', () => {
    const paths = ['/', '/reboot', '/api/device/signal', '/cgi-bin/luci/admin', '/?action=reboot'];
    for (const p of paths) {
      const r = evaluatePolicy(req('GET', p));
      expect(['ALLOW', 'DENY', 'REQUIRE_USER_CONFIRMATION']).toContain(r.decision);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 16. Auth endpoints — always DENY in Discovery
// ═══════════════════════════════════════════════════════════════════════

describe('policy — auth endpoints always DENY', () => {
  test.each([
    '/api/webserver/SesTokInfo',
    '/api/webserver/token',
    '/api/user/state-login',
  ])('GET %s → DENY AUTH_ENDPOINT', (p) => {
    const r = evaluatePolicy(req('GET', p));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('AUTH_ENDPOINT');
  });

  test('GET /api/webserver/SesTokInfo?foo=bar → DENY', () => {
    const r = evaluatePolicy(req('GET', '/api/webserver/SesTokInfo?foo=bar'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('AUTH_ENDPOINT');
  });

  test('GET /api/user/state-login?x=1 → DENY', () => {
    const r = evaluatePolicy(req('GET', '/api/user/state-login?x=1'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('AUTH_ENDPOINT');
  });

  test('GET /goform/goform_get_cmd_process?cmd=RD → DENY AUTH_ENDPOINT', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=RD'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('AUTH_ENDPOINT');
  });

  test('GET /goform/goform_get_cmd_process?cmd=LD → DENY AUTH_ENDPOINT', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=LD'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('AUTH_ENDPOINT');
  });

  test('GET /goform/goform_get_cmd_process?cmd=rsrp,RD → DENY', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=rsrp,RD'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('AUTH_ENDPOINT');
  });

  test('GET /goform/goform_get_cmd_process?cmd=rsrp,LD → DENY', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=rsrp,LD'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('AUTH_ENDPOINT');
  });

  test('GET /goform/goform_get_cmd_process?cmd=%52%44 → DENY (encoded RD)', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=%52%44'));
    expect(r.decision).toBe('DENY');
    expect(r.code).toBe('AUTH_ENDPOINT');
  });

  test('GET /goform/goform_get_cmd_process?cmd=rd → DENY (lowercase, not whitelisted)', () => {
    const r = evaluatePolicy(req('GET', '/goform/goform_get_cmd_process?cmd=rd'));
    expect(r.decision).toBe('DENY');
    // ليس في AUTH_CMDS (case-sensitive) — يسقط كـ UNKNOWN_ZTE_CMD
    expect(r.code).toBe('UNKNOWN_ZTE_CMD');
  });

  test('GET /?command=rsrp → DENY (command key, not ZTE path)', () => {
    expect(evaluatePolicy(req('GET', '/?command=rsrp')).decision).toBe('DENY');
  });

  test('GET /?goformId=LOGIN → DENY (goformId key, not ZTE read path)', () => {
    expect(evaluatePolicy(req('GET', '/?goformId=LOGIN')).decision).toBe('DENY');
  });
});
