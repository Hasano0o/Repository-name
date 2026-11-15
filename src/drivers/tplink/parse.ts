/**
 * TP-Link «GDPR» — قراءة صفحة الدخول وردود الراوتر (بدون react-native).
 * من ملفات NX200 (١٥ نوفمبر): الصفحة على https، وصفحة http «ترحيب» بس.
 */
import type { Signal } from '../types';

/** صفحة http اللي وظيفتها «روح لـ https» */
export function tpIsWelcome(t: string): boolean {
  return /\/cgi\/welcome/.test(t) && /go-https-modal|visitHttpsNote/.test(t);
}
/** صفحة دخول TP-Link (نسخة GDPR): تطلب /cgi/getGDPRParm وفيها gdprProxy.js */
export function tpIsLoginPage(t: string): boolean {
  return /\/cgi\/getGDPRParm/.test(t) || (/gdprProxy\.js/.test(t) && /tpEncrypt\.js/.test(t));
}
/** متغيرات السطر الأخير في الصفحة: modelName · adminType · authTimes · forbidFlag … */
export function tpPageVars(t: string): { model?: string; desc?: string; adminType?: string; authTimes?: number; maxAuthTimes?: number; forbidFlag?: boolean; forbidForever?: boolean; forbidTime?: number } {
  const s = (k: string) => t.match(new RegExp(`\\bvar\\s+${k}\\s*=\\s*"([^"]*)"`))?.[1];
  const n = (k: string) => { const v = t.match(new RegExp(`\\bvar\\s+${k}\\s*=\\s*(\\d+)`))?.[1]; return v === undefined ? undefined : Number(v); };
  return {
    model: s('modelName'), desc: s('modelDesc'), adminType: s('adminType'),
    authTimes: n('authTimes'), maxAuthTimes: n('maxAuthTimes'),
    forbidFlag: n('forbidFlag') === 1, forbidForever: n('forbidForever') === 1, forbidTime: n('forbidTime'),
  };
}
/**
 * اسم المستخدم مثل الصفحة: INCLUDE_LOGIN_USERNAME = 0 (CHGINIT_PWD=1 و AUTH_PASSWORD=1) و USER_RESTRICTION=1
 * ← user = adminType == "admin" ? 'admin' : 'user'. صفحة بدون adminType ← اللي كتبه العضو أو admin.
 */
export function tpLoginUser(adminType: string | undefined, typed: string): string {
  if (adminType) return adminType === 'admin' ? 'admin' : 'user';
  return (typed || '').trim() || 'admin';
}
/** رد /cgi/getBusy */
export function tpBusy(t: string): { logined: boolean; busy: boolean } {
  return { logined: /isLogined\s*=\s*1/.test(t), busy: /isBusy\s*=\s*1/.test(t) };
}
/** رد أمر cgi بعد فك التشفير: «$.ret=0;» — null = ما فيه */
export function tpRet(t: string): number | null {
  const m = t.match(/\$\.ret\s*=\s*(-?\d+)/);
  return m ? Number(m[1]) : null;
}
/** رمز الجلسة في الصفحة الرئيسية بعد الدخول (var token="…") — يروح في رأس TokenID */
export function tpToken(t: string): string | null {
  return t.match(/\btoken\s*=\s*"([0-9a-zA-Z]{8,})"/)?.[1] ?? null;
}
/** خطأ الكلمة الغلط في الصفحة (HTTP_ERR_USER_PWD_NOT_CORRECT) */
export const TP_ERR_PWD = 71233;

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) && /\d/.test(String(v)) ? n : undefined;
};

/**
 * الإشارة من ردود الراوتر — ما نعرف أسماء الخانات بالضبط للحين (تنعرف من ملف FULL)، فنقرأ بس الخانات
 * اللي اسمها واضح (rsrp / rsrq / sinr|snr / rssi) وبقيم معقولة. خانة فيها nr أو 5g ← 5G.
 * ما نخمّن شي غير كذا — لو ما لقينا ← فاضي.
 */
export function tpSignalGuess(objs: Record<string, unknown>[]): Signal {
  const s: Signal = {};
  const set = <K extends keyof Signal>(k: K, v: Signal[K]) => { if (v !== undefined && s[k] === undefined) s[k] = v; };
  for (const o of objs) {
    for (const [k0, v] of Object.entries(o ?? {})) {
      if (v && typeof v === 'object') continue;
      const k = k0.toLowerCase();
      const nr = /nr|5g/.test(k.replace(/sinr/g, '')); // «sinr» فيها nr — ما تنحسب 5G
      const x = num(v);
      if (x === undefined) continue;
      if (/rsrp/.test(k) && x <= -40 && x >= -150) set(nr ? 'nrRsrp' : 'rsrp', x);
      else if (/rsrq/.test(k) && x < 0 && x >= -40) set(nr ? 'nrRsrq' : 'rsrq', x);
      else if (/(sinr|snr)/.test(k) && x >= -30 && x <= 50) set(nr ? 'nrSinr' : 'sinr', x);
      else if (/rssi/.test(k) && x <= -20 && x >= -130 && !nr) set('rssi', x);
    }
  }
  if (s.nrRsrp !== undefined) s.nrActiveFromStatus = true;
  if (s.rsrp !== undefined || s.nrRsrp !== undefined) s.network = s.rsrp !== undefined && s.nrRsrp !== undefined ? '5G NSA' : s.nrRsrp !== undefined ? '5G SA' : '4G';
  return s;
}

/** أوامر القراءة اللي نسحبها في FULL (go = كائن · gl = قائمة) — كلها قراءة. أسماؤها من oid_str.js في الراوتر */
export const TP_READ_OIDS: { op: 'go' | 'gl'; oid: string; stacks: string[] }[] = [
  { op: 'go', oid: 'DEV2_DEV_INFO', stacks: ['0,0,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_NET_STATUS', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_SERVING_CELL_INFO', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'gl', oid: 'DEV2_LTE_SERVING_CELL_INFO', stacks: ['0,0,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_BANDINFO', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_LINK_CFG', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_4G_CELL_LOCK', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_5G_CELL_LOCK', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_CELL_LOCK', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_PROF_STAT', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_WAN_CFG', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_CELL_INTF', stacks: ['1,0,0,0,0,0'] },
  { op: 'gl', oid: 'DEV2_CELL_INTF', stacks: ['0,0,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_CELL_INTF_STAT', stacks: ['1,0,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_XTP_LTE_INTF_CFG', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0'] },
];
