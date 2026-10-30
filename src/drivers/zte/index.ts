import { sha256 } from '@noble/hashes/sha2';
import { md5 } from '@noble/hashes/legacy';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import {
  RouterDriver, Capability, Signal, NetworkInfo, Traffic, ConnectedDevice,
  Usage, DeviceDetails, CellTower, BandConfig, ActiveLock, Carrier,
  SignalSnapshot, CellLockState, CellLockTarget, WifiRadio, DeviceTemp, SmsMessage,
} from '../types';
import { http } from '../http';
import { loadFormula, saveFormula, isBadPassword, markBadPassword, loadAdFormula, saveAdFormula } from './formulaStore';
import { ZteIo, zteExtras, zteSetUpnp, zteSetDmz, zteSetLedNight, zteSetBandOn, zteSetGuest, zteSetUrlBlocks, zteRadios, zteSetChannel, zteSetAutoRecover, zteSetWifiSleep, zteSetWifiNames, zteFactoryReset } from './extras';
import {
  parsePci, decodeBandMask, encodeBandMask, parseZteCa, bandLabel,
} from '../../utils/normalize';
import { buildSnapshot } from '../../utils/snapshot';
import { noChange, markNoChange } from '../noChange';
import { classifyZteWrite, WRITE_ALLOWED_WHEN_UNVERIFIED } from './writeResult';

import { LockSnapshot, restoreMismatch } from '../lockSnapshot';
import { ZteNgDriver } from '../zteng';
import { identifyZte, ModelProfile } from '../models';
import { u30SetBands, u30ReadLock, u30Supported, u30Locked, u30CellLocks, u30UnlockAll, u30Neighbors, u30Summary, u30Diff, U30Lock } from './u30';
import { ZTE_LOCK_KEYS, ZteLockData, checkComplete, zteDiff, zteSummary, ZTE_PART_LABEL, lteBands, nrBands, lteCell, nrCell, checkLockResponse} from './lockState';
const sha256Upper = (s: string) => bytesToHex(sha256(utf8ToBytes(s))).toUpperCase();
const sha256Hex = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));
const md5Hex = (s: string) => bytesToHex(md5(utf8ToBytes(s)));

/**
 * PCI/cell_id عند ZTE بالست عشري (f = 15) — نحوّله لعشري.
 * نعتمد parsePci لتفادي اختلافات الصيغ، ونسقط للنص الأصلي لو رجع undefined.
 */
const pciDec = (v?: string): string | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = parsePci(v);
  return n === undefined ? v.trim() : String(n);
};

/** ZTE يعطي PCI البرج الحالي (4G و5G) بالـ hex دايماً حتى لو كله أرقام: "107" = 263 */
const hexPci = (v?: string): string | undefined => {
  if (v === undefined || v === '') return undefined;
  const t = v.trim().replace(/^0x/i, '');
  if (/^[0-9a-f]+$/i.test(t)) {
    const n = parseInt(t, 16);
    if (n >= 0 && n <= 1007) return String(n);
  }
  return pciDec(v);
};

/** رقم التردد 4G من EARFCN */
const LTE_EARFCN: [number, number, number][] = [
  [1, 0, 599], [3, 1200, 1949], [7, 2750, 3449], [8, 3450, 3799], [20, 6150, 6449],
  [28, 9210, 9659], [38, 37750, 38249], [40, 38650, 39649], [41, 39650, 41589],
  [42, 41590, 43589],
];
const lteBandOf = (earfcn?: number) =>
  earfcn === undefined ? undefined : LTE_EARFCN.find(([, a, b]) => earfcn >= a && earfcn <= b)?.[0];

const CODE_TO_ZTE: Record<string, string> = { '00': 'WL_AND_5G', '0803': 'LTE_AND_5G', '03': 'Only_LTE', '08': 'Only_5G' };
const ZTE_TO_CODE: Record<string, string> = Object.fromEntries(Object.entries(CODE_TO_ZTE).map(([k, v]) => [v, k]));

/** ترددات MU5001 المعروفة — لو الراوتر ما قال غير كذا */
const DEFAULT_LTE = [1, 3, 7, 8, 20, 28, 40, 41];
// كل ترددات 5G الشائعة في راوترات ZTE — كانت ٣ بس فكان «عرض الكل» يطلّع n40/n41/n78 فقط
const DEFAULT_NR = [1, 3, 5, 7, 8, 20, 28, 38, 40, 41, 77, 78, 79];
// لو الراوتر رفض القائمة الكاملة وقت فك التثبيت نرجع لهذي
// إعداد المصنع الحقيقي لـ MU5001 (STC، قراءة حية ١٨ أكتوبر بعد ضبط المصنع):
// nr5g_*_band_lock = 40,41,78 — و 4G = B1/3/7/8/20/28/40/41 (= DEFAULT_LTE)، والأقفال "" فاضية.
// «فك التثبيت» يرجّع لهذي القائمة، **مو** لـ DEFAULT_NR (١٣ تردد أغلبها ما يدعمها الجهاز —
// كتابتها تنحفظ وتبقى بعد إعادة التشغيل، والمشتبه الأول في «بدون خدمة لين ضبط المصنع»).
// DEFAULT_NR يبقى للعرض بس (nrSupported)، وما ينكتب على الراوتر أبداً.
const SAFE_NR = [40, 41, 78];
// قائمة واسعة لفك التثبيت لو ما نعرف ترددات الراوتر الأصلية — تشمل ترددات الخليج (B38 وغيره)
const WIDE_LTE = [1, 2, 3, 4, 5, 7, 8, 12, 13, 17, 18, 19, 20, 25, 26, 28, 32, 34, 38, 39, 40, 41, 42, 43, 66, 71];

const bandsFromMask = (hex?: string): number[] => (hex ? decodeBandMask(hex) : []);
const maskFromBands = (bands: number[]) => encodeBandMask(bands);

const nrList = (v?: string) =>
  (v ?? '').split(',').map(x => parseInt(x, 10)).filter(n => Number.isFinite(n) && n > 0);

const num = (v?: string): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

const pick = (o: Record<string, string>, ...keys: string[]): string | undefined => {
  for (const k of keys) { const v = o[k]; if (v !== undefined && v !== '') return v; }
  return undefined;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ═══ الرسائل في ZTE: النص يجي ويروح UTF-16BE بصيغة hex (4 خانات لكل حرف) ═══
// المرجع: github.com/teixeluis/zte-lte-modem (Apache-2.0) — sms_data_total / SET_MSG_READ / SEND_SMS
const ucs2Hex = (t: string): string => {
  let out = '';
  for (let i = 0; i < t.length; i++) out += t.charCodeAt(i).toString(16).padStart(4, '0');
  return out.toUpperCase();
};
const fromUcs2Hex = (h: string): string => {
  if (!h || h.length % 4 !== 0 || !/^[0-9a-fA-F]+$/.test(h)) return h ?? '';
  let out = '';
  for (let i = 0; i < h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
  return out;
};
/** "24,10,23,21,50,12,+12" ← تاريخ الراوتر → "2024-10-23 21:50" */
const zteSmsDate = (d: string): string => {
  const f = (d ?? '').split(',').map(x => x.trim());
  if (f.length < 5) return d ?? '';
  const p = (x: string) => x.padStart(2, '0');
  return `20${p(f[0])}-${p(f[1])}-${p(f[2])} ${p(f[3])}:${p(f[4])}`;
};
/** وقت الإرسال بصيغة ZTE: yy;MM;dd;HH;mm;ss;+3 */
const zteSmsNow = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const tz = -d.getTimezoneOffset() / 60;
  return [p(d.getFullYear() % 100), p(d.getMonth() + 1), p(d.getDate()), p(d.getHours()), p(d.getMinutes()), p(d.getSeconds())]
    .join(';') + ';' + (tz >= 0 ? '+' : '') + tz;
};
/** رقم داخل مدى مقبول — غيره نعتبره غير متوفر (حقول غير موثقة تختلف بين الفيرموير) */
const inRange = (v: string | undefined, lo: number, hi: number): number | undefined => {
  const n = num(v);
  return n !== undefined && Number.isInteger(n) && n >= lo && n <= hi ? n : undefined;
};

/** صيغة كلمة المرور اللي نجحت مع كل راوتر — عشان المرة الجاية نحاول مرة وحدة بس
 *  (كل محاولة غلط تنقص عداد الراوتر، وبعد ٥ غلطات يقفل الدخول دقائق) */
const GOOD_FORMULA = new Map<string, string>();
/** صيغة AD اللي نجحت لكل راوتر (بالذاكرة) */
const AD_LEARNED = new Map<string, string>();
/** راوترات جرّبنا عليها كل صيغ التوقيع وكلها انرفضت (MC801A) — ما نعيد ٩ محاولات كل مرة */
const AD_ALL_FAILED = new Set<string>();

/** تباعد الترددات الفرعية (SCS) لـ 5G — ترددات TDD العالية 30 والباقي 15 */
const NR_SCS30 = new Set([34, 38, 39, 40, 41, 46, 47, 48, 77, 78, 79]);
const nrScs = (band: number) => (NR_SCS30.has(band) ? 30 : 15);

/** أجهزة (حسب العنوان) احتاجت إعادة تشغيل عشان تطبّق قفل البرج */
const rebootToApply = new Set<string>();

const bandNum = (v?: string): number | undefined => {
  if (!v) return undefined;
  const m = String(v).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : undefined;
};

/**
 * نص الترددات بنفس صيغة هواوي عشان الواجهة تعرض الدمج:
 * "20MHz@500(B1) + 20MHz@1450(B3) + 20MHz@9310(B28)"
 */
function caBandString(r: Record<string, string>): string | undefined {
  const earfcn = r.wan_active_channel || r.lte_ca_pcell_freq || '';
  const pb = bandNum(r.lte_band) ?? bandNum(r.lte_ca_pcell_band)
    ?? bandNum(r.wan_active_band) ?? lteBandOf(num(earfcn));
  if (!pb) return undefined;
  const bw = num(r.lte_ca_pcell_bandwidth);
  const label = bandLabel(pb, 'LTE') ?? ('B' + pb);
  const parts = [(bw ? bw + 'MHz' : '') + (earfcn ? '@' + earfcn : '') + '(' + label + ')'];
  const ca = r.wan_lte_ca || '';
  if (/activ/i.test(ca) && !/deactiv|inactiv/i.test(ca)) {
    for (const row of (r.lte_multi_ca_scell_info || '').split(';')) {
      const f = row.split(',').map(x => x.trim());
      if (f.length < 5) continue;
      const b = bandNum(f[3]) ?? lteBandOf(num(f[4]));
      if (!b) continue;
      const w = num(f[5]);
      const lbl = bandLabel(b, 'LTE') ?? ('B' + b);
      parts.push((w ? w + 'MHz' : '') + '@' + f[4] + '(' + lbl + ')');
    }
  }
  return parts.join(' + ');
}

export class ZteDriver implements RouterDriver {
  id = 'zte';
  name = 'ZTE';
  capabilities: Capability[] = ['signal', 'devices', 'traffic', 'usage', 'reboot', 'cells', 'bandLock', 'sms'];
  // تجربة حقيقية (MU5001، ٤ أكتوبر ٢٠٢٦): التثبيت على برج ما يمسكه يطيّح الخدمة (LIMITED_SERVICE)
  // بس الراوتر يبقى حي، وفك التثبيت + إعادة التشغيل يرجّعه — فالميزة شغالة مع الإرجاع التلقائي.
  // ١٨ أكتوبر (MU5001 حي): الفك بالفاضي يرد failure وما يفك، و0/0 + إعادة التشغيل علّق الراوتر «بدون خدمة»
  // لين ضبط المصنع. ما عندنا فك مضمون — فنوقف تثبيت البرج على ZTE (تثبيت الترددات يبقى شغّال).
  cellLockRisk = 'تثبيت البرج موقوف على راوترات ZTE — فكّه ما يشتغل بأمان على هالموديلات، وممكن يعلّق الراوتر بدون خدمة لين ضبط المصنع. استخدم تثبيت الترددات بداله.';
  private host = '';
  private password = '';
  /** إعدادات الراوتر الأصلية (من أول اتصال وهو نظيف) */
  private orig: Record<string, string> | null = null;

  private log(...a: unknown[]) {
    if (__DEV__) console.log('[zte]', ...a);
  }

  private base() {
    const h = this.host.replace(/\/+$/, '');
    return h.startsWith('http') ? h : 'http://' + h;
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Referer: this.base() + '/index.html',
      'X-Requested-With': 'XMLHttpRequest',
      ...extra,
    };
  }

  /** قراءة حقول — لازم multi_data=1 لما تكون أكثر من حقل */
  private async get(fields: string[]): Promise<Record<string, string>> {
    const multi = fields.length > 1 ? '&multi_data=1' : '';
    const url = this.base() + '/goform/goform_get_cmd_process?isTest=false' + multi +
      '&cmd=' + encodeURIComponent(fields.join(',')) + '&_=' + Date.now();
    const res = await http(url, { headers: this.headers() });
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      const out: Record<string, string> = {};
      for (const k of Object.keys(j)) {
        const v = j[k];
        out[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      return out;
    } catch {
      throw new Error('رد غير مفهوم من الراوتر');
    }
  }

  private async getRaw(field: string): Promise<Record<string, unknown> | null> {
    const url = this.base() + '/goform/goform_get_cmd_process?isTest=false&cmd=' +
      encodeURIComponent(field) + '&_=' + Date.now();
    const res = await http(url, { headers: this.headers() });
    try {
      const parsed: unknown = JSON.parse(await res.text());
      // نتحقق أنه كائن فعلاً — الراوتر قد يرسل مصفوفة أو قيمة واحدة
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * مرشحو صيغة AD — من الأكثر شيوعاً للأقل. كلها موثقة من فيرمويرات ZTE،
   * مو brute-force. نجربها مرة وحدة ثم نحفظ الناجحة.
   */
  private static readonly AD_FORMULAS = ['wa+cr', 'sha:wa+cr', 'sha:wa+cr.lo', 'sha:wa', 'wa', 'wa+cr+web', 'wa+web', 'concat'] as const;
  private adFormula: string | null = null;

  private async computeAd(formula: string): Promise<string | undefined> {
    try {
      const v = await this.get(['wa_inner_version', 'cr_version', 'web_version']);
      const rd = (await this.get(['RD'])).RD;
      if (!rd) return undefined;
      const wa = v.wa_inner_version ?? '';
      const cr = v.cr_version ?? '';
      const web = v.web_version ?? '';
      switch (formula) {
        case 'wa+cr': return md5Hex(md5Hex(wa + cr) + rd);
        case 'wa': return md5Hex(md5Hex(wa) + rd);
        case 'wa+cr+web': return md5Hex(md5Hex(wa + cr + web) + rd);
        case 'wa+web': return md5Hex(md5Hex(wa + web) + rd);
        case 'concat': return md5Hex(wa + cr + rd);
        // فيرموير ZTE الأحدث (MC801A/MC888/MC889/G5…): نفس الفكرة بس SHA256 (service.js: cookWithRequest)
        case 'sha:wa+cr': return sha256Upper(sha256Upper(wa + cr) + rd);
        case 'sha:wa+cr.lo': return sha256Hex(sha256Hex(wa + cr) + rd);
        case 'sha:wa': return sha256Upper(sha256Upper(wa) + rd);
        default: return undefined;
      }
    } catch {
      return undefined;
    }
  }

  private async signAd(): Promise<string | undefined> {
    if (!this.adFormula && !AD_LEARNED.has(this.host)) {
      const saved = await loadAdFormula(this.host);
      if (saved) AD_LEARNED.set(this.host, saved);
    }
    const pin = this.profile?.pinned;
    if (pin) return this.computeAd(pin.ad);
    return this.computeAd(this.adFormula ?? AD_LEARNED.get(this.host) ?? 'wa+cr');
  }

  /**
   * الأمر انرفض ({"result":"failure"}) — غالباً صيغة AD غلط (تقرير MC801A: الدخول نجح وكل أمر فيه AD انرفض،
   * حتى LOGOUT). نجرّب الصيغ الثانية على نفس الأمر، والناجحة نحفظها للراوتر. الأمر المرفوض ما يغيّر شي.
   */
  private async retryWithOtherAd(body: Record<string, string>): Promise<string | null> {
    const cur = this.adFormula ?? AD_LEARNED.get(this.host) ?? 'wa+cr';
    for (const f of ZteDriver.AD_FORMULAS) {
      if (f === cur) continue;
      this.adFormula = f;
      const out = await this.post(body);
      if (/success/i.test(out)) { AD_LEARNED.set(this.host, f); await saveAdFormula(this.host, f); this.log('AD formula →', f); return out; }
    }
    this.adFormula = cur;
    return null;
  }

  /**
   * موديل كتابته ما انثبتت (U30 Pro): نوقف قبل أي أمر تغيير — هنا في post نفسه، عشان يمسك كل المسارات
   * (act، إعادة التشغيل، دخول المطوّر، الرسائل…) مو act بس. المسموح: الدخول والخروج (مجرّبة في السجل).
   */
  private async assertWritable(goformId: string): Promise<void> {
    if (WRITE_ALLOWED_WHEN_UNVERIFIED.has(goformId)) return;
    const prof = await this.identify();
    if (!prof?.writeUnverified) return;
    if (prof.writeAllow?.includes(goformId)) return;
    const e = noChange(`راوترك (${this.profile?.label ?? 'ZTE'}) نقرأ منه كل شي، بس أوامر التغيير فيه بصيغة خاصة لسا نضيفها — ما غيّرنا أي شي. أرسل «جهاز جديد» من الصفحة الرئيسية عشان نضيفها أسرع.`);
    (e as any).unsupported = true;
    throw e;
  }
  private async post(body: Record<string, string>): Promise<string> {
    await this.assertWritable(body.goformId);
    const extra: Record<string, string> = {};
    if (body.goformId !== 'LOGIN' && body.goformId !== 'SET_WEB_LANGUAGE') {
      const ad = await this.signAd();
      if (ad) extra.AD = ad;
    }
    const form = Object.entries({ isTest: 'false', ...body, ...extra })
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    const res = await http(this.base() + '/goform/goform_set_cmd_process', {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form,
    });
    return await res.text();
  }

  async detect(host: string): Promise<boolean> {
    this.host = host;
    try {
      const r = await this.get(['wa_inner_version']);
      return !!r.wa_inner_version;
    } catch {
      return false;
    }
  }

  /** ZTE ما يستخدم اسم مستخدم — كلمة المرور فقط */
  /**
   * دخول واحد بنفس الوقت: كانت كل شاشة/قراءة شغالة تشوف «الجلسة راحت» وتسجّل دخول لحالها —
   * ٩ محاولات (وكل وحدة LOGOUT) خلال ثانية → الراوتر يقفل الدخول ٥ دقايق.
   */
  private loginP: Promise<void> | null = null;
  login(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    if (this.loginP && !opts?.lastTry && !opts?.fresh) return this.loginP;
    this.loginP = this.loginOnce(host, username, password, !!opts?.lastTry, !!opts?.fresh).finally(() => {
      // نخلي النتيجة صالحة ثانيتين — الطلبات اللي وصلت متأخرة ما تفتح دخول جديد
      setTimeout(() => { this.loginP = null; }, 2000);
    });
    return this.loginP;
  }

  /** قيم كلمة المرور المحتملة حسب صيغة الفيرموير (من service.js) */
  private loginCandidates(password: string, ld: string, rd: string): Array<{ name: string; val: string }> {
    const candidates: Array<{ name: string; val: string }> = [];
    const s1u = sha256Upper(password);  // sha256(pw) upper-hex
    const s1l = sha256Hex(password);    // sha256(pw) lower-hex

    // حالة "2": sha256(sha256(pw) + LD) — الأكثر شيوعاً في MU5001
    if (ld) {
      candidates.push({ name: 'sha2(sha2(pw)+LD)', val: sha256Upper(s1u + ld) });
      candidates.push({ name: 'sha2(sha2(pw)+LD.up)', val: sha256Upper(s1u + ld.toUpperCase()) });
      candidates.push({ name: 'sha2(sha2L+LD)', val: sha256Hex(s1l + ld) });
      candidates.push({ name: 'sha2(pw+LD)', val: sha256Upper(password + ld) });
      candidates.push({ name: 'sha2(pw+LD.up)', val: sha256Upper(password + ld.toUpperCase()) });
    }
    candidates.push({ name: 'sha2(pw).up', val: s1u });
    candidates.push({ name: 'sha2(pw).lo', val: s1l });

    // حالة "1": sha256(base64(pw))
    try {
      const b64 = btoa(password);
      candidates.push({ name: 'sha2(b64).up', val: sha256Upper(b64) });
      candidates.push({ name: 'sha2(b64).lo', val: sha256Hex(b64) });
    } catch {}

    // حالة "0": base64(pw)
    try { candidates.push({ name: 'b64(pw)', val: btoa(password) }); } catch {}

    // ═══ احتياطي MD5 ═══
    if (rd) candidates.push({ name: 'md5(md5(pw)+RD)', val: md5Hex(md5Hex(password) + rd) });
    candidates.push({ name: 'md5(md5(pw))', val: md5Hex(md5Hex(password)) });

    return candidates;
  }

  /**
   * «دخول المطوّر» (DEVELOPER_OPTION_LOGIN) — بعض فيرموير ZTE الأحدث (MC888/MC889 وغيرها)
   * يرفض تثبيت الترددات إلا بجلسة مطوّر فوق جلسة الأدمن (مرجع: zte-advanced-router-panel، MIT).
   * محاولة وحدة بس بالجلسة، وبالصيغة اللي نجح فيها الدخول، وما نجرّب لو باقي أقل من ٣ محاولات.
   */
  private devTried = false;
  private devOk = false;
  private async devLogin(): Promise<boolean> {
    if (this.devTried) return this.devOk;
    this.devTried = true;
    const known = GOOD_FORMULA.get(this.host) ?? await loadFormula(this.host);
    if (!known || !this.password) return false;
    const left = await this.attemptsLeft();
    if (left !== undefined && left < 3) return false;
    try {
      const v = await this.get(['LD', 'RD']);
      const c = this.loginCandidates(this.password, v.LD || '', v.RD || '').find(x => x.name === known);
      if (!c) return false;
      const out = await this.post({ goformId: 'DEVELOPER_OPTION_LOGIN', password: c.val });
      this.log('dev-login →', out.slice(0, 80));
      this.devOk = /"result"\s*:\s*"?(0|success)"?/i.test(out);
    } catch { this.devOk = false; }
    return this.devOk;
  }

  /** 5G: NSA (مع 4G) ولا SA — لازم لأمر WAN_PERFORM_NR5G_SANSA_BAND_LOCK */
  private async nrType(): Promise<'0' | '1'> {
    try {
      const r = await this.get(['network_type']);
      return /^SA$/i.test((r.network_type || '').trim()) ? '0' : '1';
    } catch { return '1'; }
  }

  private async loginOnce(host: string, _username: string, password: string, lastTry = false, fresh = false): Promise<void> {
    this.host = host;
    this.password = password;

    // ═══ لو جلستنا شغالة أصلاً ما نصرف أي محاولة ═══
    // إلا لو المستخدم كتب الكلمة بنفسه (fresh): وقتها «داخل» ما تثبت إن الكلمة صح — لازم نجرّبها
    if (!fresh && !lastTry && await this.verifyLogin()) { this.log('login: already ok'); return; }

    // ═══ هل الراوتر قافل الدخول بسبب محاولات غلط؟ ═══
    const lockMsg = await this.lockState();
    if (lockMsg) throw new Error(lockMsg);

    // ═══ نفس الكلمة انرفضت قبل؟ ما نحرق محاولة ثانية عليها (إلا لو المستخدم طلب بنفسه) ═══
    const fp = sha256Hex('bandly:' + password);
    if (!lastTry && await isBadPassword(host, fp)) {
      const left = await this.attemptsLeft();
      const err = new Error('كلمة المرور المحفوظة رفضها الراوتر قبل — ما جرّبناها مرة ثانية عشان ما نقفل الدخول. حدّثها من إعدادات الراوتر، أو جرّبها بنفسك لو متأكد منها.');
      (err as any).code = 'LAST_TRY';
      (err as any).left = left;
      throw err;
    }

    // ═══ نفكّ أي جلسة عالقة أول (MU5001 يقبل مستخدم واحد فقط) ═══
    try { await this.post({ goformId: 'LOGOUT' }); } catch {}
    try { await this.post({ goformId: 'GOFORM_LOGOUT' }); } catch {}
    await new Promise(r => setTimeout(r, 800));

    // ═══ اجلب LD و RD طازج ═══
    let ld = '';
    let rd = '';
    try {
      const vals = await this.get(['LD', 'RD']);
      ld = vals.LD || '';
      rd = vals.RD || '';
    } catch {}
    this.log('login: LD=' + (ld ? ld.slice(0, 12) + '..' : '∅'),
             'RD=' + (rd ? rd.slice(0, 12) + '..' : '∅'));

    const candidates = this.loginCandidates(password, ld, rd);

    const isOk = (s: string) =>
      /"result"\s*:\s*"?0"?/.test(s) || /"result"\s*:\s*"?success"?/i.test(s);

    let sawBusy = false;

    // ═══ الصيغة اللي نجحت قبل (محفوظة على الجهاز) — لو نعرفها نجرّبها هي بس ═══
    // لو فشلت والصيغة معروفة = كلمة المرور تغيّرت (مو الصيغة) — ما نرش باقي الصيغ ونحرق المحاولات.
    const known = GOOD_FORMULA.get(host) ?? await loadFormula(host);
    const list0 = known && candidates.some(c => c.name === known)
      ? candidates.filter(c => c.name === known)
      : candidates;
    // المحاولة الأخيرة (بطلب المستخدم): صيغة وحدة بس — المعروفة أو الأشهر
    const list = lastTry ? list0.slice(0, 1) : list0;
    // حماية من القفل — بس بدون ما نقفل الباب على نفسنا:
    // • أول محاولة (أو الصيغة المعروفة) تنجرّب طالما باقي ٢ أو أكثر — لو فشلت يبقى واحدة للمستخدم.
    //   (قبل: كنا نوقف عند ٢ بدون ولا محاولة، والعدّاد ما يرجع إلا بدخول ناجح ← التطبيق ما يدخل أبداً)
    // • باقي الصيغ (رش) بس لو باقي ٣ أو أكثر.
    // بعض الفيرموير ما يقول كم باقي — وقتها ما نتعدى ٣ محاولات فاشلة
    let blindFails = 0;

    for (const [idx, c] of list.entries()) {
      const leftNow = await this.attemptsLeft();
      // lastTry: الراوتر مو مقفول (تأكدنا فوق) والمستخدم وافق ← نجرّب حتى لو باقي وحدة
      const minLeft = lastTry ? 0 : known || idx === 0 ? 2 : 3;
      if (leftNow !== undefined && leftNow < minLeft) {
        const lock = await this.lockState();
        if (lock) throw new Error(lock);
        // العدّاد ما يرجع إلا بدخول ناجح أو بعد قفل — فلو وقفنا هنا للأبد، الحل الوحيد كان ضبط المصنع.
        // الشاشة تعرض للمستخدم خيار «المحاولة الأخيرة» (lastTry) بدل كذا.
        const err = new Error(`باقي ${leftNow} ${leftNow === 1 ? 'محاولة وحدة' : 'محاولات'} قبل ما يقفل الراوتر الدخول — ما جرّبنا عشان ما نقفله عليك. تأكد من كلمة المرور وجرّب «المحاولة الأخيرة».`);
        (err as any).code = 'LAST_TRY';
        (err as any).left = leftNow;
        throw err;
      }
      if (leftNow === undefined && blindFails >= 3) break;
      let out = '';
      try {
        out = await this.post({ goformId: 'LOGIN', password: c.val });
      } catch (e) {
        this.log('login:', c.name, 'THREW', (e as any)?.message ?? String(e));
        continue;
      }
      this.log('login:', c.name, '→', out.slice(0, 120));

      // ✅ نجاح صريح — نرجع فوراً بدون انتظار verifyLogin
      if (isOk(out)) {
        this.log('login: ✓ ✓ ✓ نجح بـ', c.name);
        GOOD_FORMULA.set(host, c.name);
        await saveFormula(host, c.name);
        await markBadPassword(host, null);
        await new Promise(r => setTimeout(r, 400));
        return;
      }
      // 2 = duplicateUser (مستخدم آخر داخل) — نتذكره ونكمل
      if (/"result"\s*:\s*"?2"?/.test(out)) { sawBusy = true; continue; }
      blindFails++;
      // انرفضت بالصيغة الأكيدة (المعروفة، أو المحاولة الأخيرة) = الكلمة نفسها غلط ← نتذكرها
      if ((known && c.name === known) || lastTry) await markBadPassword(host, fp);
      if (lastTry) {
        const lock = await this.lockState();
        throw new Error(lock
          ? `كلمة المرور غلط، والراوتر قفل الدخول مؤقتاً. ${lock.replace(/^.*?—\s*/, '')} — بعدها يرجع طبيعي (ما يحتاج ضبط مصنع). تأكد من الكلمة قبل.`
          : 'كلمة المرور غلط. تأكد منها (الملصق تحت الراوتر أو اللي غيّرتها أنت) وجرّب بعد شوي.');
      }
      // الصيغة المعروفة فشلت ← الكلمة نفسها تغيّرت
      if (known && c.name === known) {
        throw new Error('تعذّر تسجيل الدخول — كلمة المرور غلط (غالباً تغيّرت أو الراوتر انضبط مصنع). تأكد منها من الإعدادات.');
      }
    }

    if (sawBusy) {
      throw new Error('الراوتر فيه مستخدم ثاني داخل حالياً. اقفل صفحته من أي متصفح وانتظر دقيقة.');
    }
    throw new Error('تعذّر تسجيل الدخول للراوتر — تأكد إن جوالك على شبكة الراوتر وإن كلمة المرور صحيحة، وبعدها اضغط إعادة المحاولة');
  }

  /** كم محاولة باقية قبل ما يقفل الراوتر الدخول (لو الفيرموير يرجعها) */
  private async attemptsLeft(): Promise<number | undefined> {
    try {
      const r = await this.get(['psw_fail_num_str']);
      const n = parseInt(r.psw_fail_num_str ?? '', 10);
      return Number.isFinite(n) ? n : undefined;
    } catch { return undefined; }
  }

  /** لو الراوتر قافل الدخول مؤقتاً نرجع رسالة واضحة بالوقت الباقي */
  private async lockState(): Promise<string | null> {
    try {
      const r = await this.get(['psw_fail_num_str', 'login_lock_time']);
      const left = parseInt(r.psw_fail_num_str ?? '', 10);
      const secs = parseInt(r.login_lock_time ?? '', 10);
      if (left === 0 && Number.isFinite(secs) && secs > 0) {
        const mins = Math.max(1, Math.ceil(secs / 60));
        return `الراوتر قفل تسجيل الدخول مؤقتاً بسبب محاولات كثيرة — انتظر ${mins} دقيقة وبعدها جرّب`;
      }
    } catch {}
    return null;
  }

  /** يفكّ الجلسة العالقة في الفيرموير اللي يسمح بمستخدم واحد */
  private async freeSession(): Promise<void> {
    try { await this.post({ goformId: 'LOGOUT' }); } catch {}
    try { await this.post({ goformId: 'GOFORM_LOGOUT' }); } catch {}
    try { await this.get(['loginfo']); } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }

  /**
   * فحص الجلسة: الراوتر يرجع loginfo = "ok" فقط لو جلستنا هي المسيطرة.
   * أي شي ثاني (فاضي، logout) = غير مسجّل.
   */
  private async verifyLogin(): Promise<boolean> {
    try {
      const r = await this.get(['loginfo']);
      const li = r.loginfo;
      this.log('verifyLogin: loginfo =', JSON.stringify(li ?? ''));
      return li === 'ok';
    } catch (e) {
      this.log('verifyLogin: error', (e as any)?.message ?? String(e));
      return false;
    }
  }

  private async act(body: Record<string, string>): Promise<string> {
    let out = await this.post(body);
    this.log('write', body.goformId, '→', classifyZteWrite(out));
    if (/success/i.test(out) || !this.password) return out;
    try { await this.login(this.host, '', this.password); } catch {}
    out = await this.post(body);
    if (/success/i.test(out)) return out;
    // نفس الرفض بعد الدخول = غالباً صيغة AD (مرة وحدة لكل راوتر — بعدها نعرف الصح)
    const prof = await this.identify();
    if (prof?.write === 'ubus') throw this.g5Error();
    if (!this.adTried && !prof?.pinned && !AD_ALL_FAILED.has(this.host)) {
      this.adTried = true;
      const alt = await this.retryWithOtherAd(body);
      if (alt) return alt;
      AD_ALL_FAILED.add(this.host);
      this.log('AD: all formulas rejected');
    }
    return out;
  }
  private adTried = false;
  /** أجهزة G5: الصفحة تقرا بالطريقة القديمة (goform) بس ترفض أي تغيير فيها — تقرير MC801A: ٨ صيغ توقيع كلها انرفضت */
  private g5Error(): Error {
    const e = new Error('هالخاصية لسا ما تشتغل على راوترك (من عائلة ZTE G5 — التغيير فيه بطريقة ثانية). الترددات ووضع الشبكة وإعادة التشغيل شغالة.');
    (e as any).unsupported = true;
    return e;
  }
  /** قبل أوامر ما لها بديل ubus: نوقف على طول بدل ما نجرّب ونفشل */
  private async g5Guard(_what: string): Promise<void> {
    if ((await this.identify())?.write === 'ubus' && !(await this.ngWriter())) return; // ما فيه ubus أصلاً ← نجرّب الطريقة العادية
    if ((await this.identify())?.write === 'ubus') throw this.g5Error();
  }

  private rejected(what: string, out: string): Error {
    const raw = (out || '').replace(/\s+/g, ' ').slice(0, 80);
    if (AD_ALL_FAILED.has(this.host)) {
      return new Error(`الراوتر رفض ${what} — راوترك يرفض كل أوامر التغيير من التطبيق (القراءة شغالة). نشتغل على دعم موديلك، أرسل تقرير من «الدعم» لو ما أرسلت (${raw || 'بدون رد'})`);
    }
    return new Error(`الراوتر رفض ${what}. لو صفحة الراوتر مفتوحة في متصفح، سكّرها وجرّب (${raw || 'بدون رد'})`);
  }

  async logout(): Promise<void> {
    try { await this.post({ goformId: 'LOGOUT' }); } catch {}
    this.password = '';
  }

  private async ensure(): Promise<void> {
    if (this.loginP) { await this.loginP.catch(() => {}); }
    if (await this.verifyLogin()) return;
    if (this.password) await this.login(this.host, '', this.password);
  }

  /** قراءة أي حقول بعد تسجيل الدخول — للفحص العميق */
  async rawFields(fields: string[]): Promise<Record<string, string>> {
    await this.ensure();
    return await this.get(fields);
  }

  async getSignal(): Promise<Signal> {
    await this.ensure();
    const r = await this.get([
      'network_type', 'lte_band', 'wan_active_band', 'lte_pci', 'cell_id',
      'lte_rsrp', 'rsrp', 'lte_rsrq', 'rsrq', 'lte_snr', 'rssi', 'lte_rssi',
      'wan_lte_ca', 'lte_ca_pcell_bandwidth', 'lte_ca_pcell_freq', 'wan_active_channel',
      'lte_multi_ca_scell_info', 'lte_ca_pcell_band',
      // 5G NSA (الوضع القديم)
      'Z5g_rsrp', 'Z5g_rsrq', 'Z5g_SINR', 'Z5g_dlEarfcn',
      'nr5g_pci', 'nr5g_action_band', 'nr5g_action_channel', 'nr5g_cell_id',
      // 5G SA (بدائل — MU5001 في وضع Standalone)
      'Z5g_snr', 'Z5g_CQI',
      'nr5g_rsrp', 'nr5g_rsrq', 'nr5g_sinr', 'nr5g_snr',
      'nr5g_band', 'nr5g_sa_band', 'nr_band',
      'nr5g_sa_pci', 'nr_pci', 'nr5g_cell_pci',
      'nr5g_dlEarfcn', 'nr5g_dl_earfcn', 'nr5g_sa_arfcn', 'nr5g_arfcn',
      'nr5g_sa_cell_id', 'nr_cell_id',
      'nr5g_dlbandwidth', 'nr5g_bandwidth', 'nr5g_sa_bandwidth', 'nr5g_dl_bandwidth',
      // صحة الوصلة (CQI / MCS) — أسماء مرشحة غير موثقة لكل الفيرموير؛ نعرض بس اللي يرجع بقيمة منطقية
      'lte_cqi', 'cqi', 'lte_dl_mcs', 'lte_mcs', 'dl_mcs', 'lte_ul_mcs', 'ul_mcs',
      'nr5g_cqi', 'nr_cqi', 'Z5g_dl_mcs', 'nr5g_dl_mcs', 'nr5g_mcs', 'nr_mcs',
      // MC888/MC889 (مرجع zte-advanced-router-panel): تردد 5G بوضع NSA + عرضه + قوة الإرسال
      'nr5g_action_nsa_band', 'nr5g_nsa_bandwidth', 'nr_ca_pcell_band', 'tx_power',
    ]);
    // نأخذ أول قيمة غير فاضية من قائمة بدائل (5G SA يسمي الحقول بشكل مختلف)
    const pickAny = (...keys: string[]): string | undefined => pick(r, ...keys);
    const nrRsrpVal = pickAny('Z5g_rsrp', 'nr5g_rsrp', 'nr5g_sa_rsrp');
    const nrSinrVal = pickAny('Z5g_SINR', 'nr5g_sinr', 'nr5g_sa_sinr', 'Z5g_snr', 'nr5g_snr');
    const nrRsrqVal = pickAny('Z5g_rsrq', 'nr5g_rsrq', 'nr5g_sa_rsrq');
    const nrBandVal = pickAny('nr5g_action_band', 'nr5g_action_nsa_band', 'nr_ca_pcell_band', 'nr5g_band', 'nr5g_sa_band', 'nr_band');
    const nrPciVal = pickAny('nr5g_pci', 'nr5g_sa_pci', 'nr_pci', 'nr5g_cell_pci');
    const nrArfcnVal = pickAny('Z5g_dlEarfcn', 'nr5g_action_channel', 'nr5g_dlEarfcn', 'nr5g_dl_earfcn', 'nr5g_sa_arfcn', 'nr5g_arfcn');
    const nrCellIdVal = pickAny('nr5g_cell_id', 'nr5g_sa_cell_id', 'nr_cell_id');
    const nrBwVal = pickAny('nr5g_dlbandwidth', 'nr5g_bandwidth', 'nr5g_nsa_bandwidth', 'nr5g_sa_bandwidth', 'nr5g_dl_bandwidth');
    const nrOn = !!(nrRsrpVal || nrBandVal);
    const nsa = /ENDC|NSA/i.test(r.network_type || '');
    return {
      network: pick(r, 'network_type'),
      band: caBandString(r),
      nrAvailable: !nrOn && nsa ? 3 : undefined,
      cellId: pciDec(pick(r, 'cell_id')),
      pci: hexPci(pick(r, 'lte_pci')),
      earfcn: pick(r, 'wan_active_channel', 'lte_ca_pcell_freq'),
      dlBandwidth: pick(r, 'lte_ca_pcell_bandwidth'),
      rsrp: num(pick(r, 'lte_rsrp', 'rsrp')),
      rsrq: num(pick(r, 'lte_rsrq', 'rsrq')),
      sinr: num(pick(r, 'lte_snr')),
      rssi: num(pick(r, 'lte_rssi', 'rssi')),
      nrBand: nrOn ? nrBandVal : undefined,
      nrPci: nrOn ? hexPci(nrPciVal) : undefined,
      nrArfcn: nrArfcnVal,
      nrDlBandwidth: nrBwVal,
      nrRsrp: num(nrRsrpVal),
      nrRsrq: num(nrRsrqVal),
      nrSinr: num(nrSinrVal),
      cqi: inRange(pick(r, 'lte_cqi', 'cqi'), 1, 15),
      dlMcs: inRange(pick(r, 'lte_dl_mcs', 'lte_mcs', 'dl_mcs'), 0, 31),
      ulMcs: inRange(pick(r, 'lte_ul_mcs', 'ul_mcs'), 0, 31),
      // قوة إرسال الراوتر (dBm) — عالية = البرج بعيد والراوتر يصارخ عشان يوصله
      txPower: ((t) => (t !== undefined && t >= -50 && t <= 33 ? t : undefined))(num(pick(r, 'tx_power'))),
      nrCqi: nrOn ? inRange(pick(r, 'Z5g_CQI', 'nr5g_cqi', 'nr_cqi'), 1, 15) : undefined,
      nrDlMcs: nrOn ? inRange(pick(r, 'Z5g_dl_mcs', 'nr5g_dl_mcs', 'nr5g_mcs', 'nr_mcs'), 0, 31) : undefined,
    };
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const sig = await this.getSignal();
    const ca = await this.getCarriers().catch(() => [] as Carrier[]);
    const cells = await this.getCells().catch(() => [] as CellTower[]);
    return buildSnapshot(sig, ca, cells, { driverId: this.id, driverName: this.name });
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    await this.ensure();
    const r = await this.get(['network_provider', 'network_type', 'ppp_status', 'modem_main_state']);
    const state = (r.modem_main_state || '') + ' ' + (r.ppp_status || '');
    const type = (pick(r, 'network_type') ?? '').trim();
    // تجربة حقيقية (٦ أكتوبر ٢٠٢٦): ppp_status في ZTE ما يعكس حالة الأبراج — الراوتر ماسك
    // B3 + n40 بإشارة ممتازة وهو يقول disconnected. فنعتمد على نوع الشبكة:
    // LIMITED_SERVICE / NO_SERVICE = الأبراج طايحة، وأي نوع ثاني (LTE / ENDC / SA...) = متصل.
    const connected = type
      ? !/LIMITED|NO[_ ]?SERVICE|NOSERVICE/i.test(type)
      : /connect|working/i.test(state);
    return {
      operator: pick(r, 'network_provider'),
      mode: type || undefined,
      connected,
    };
  }

  async isConnected(): Promise<boolean> {
    const n = await this.getNetworkInfo();
    return !!n.connected;
  }

  async getDeviceDetails(): Promise<DeviceDetails> {
    await this.ensure();
    const r = await this.get([
      'wa_inner_version', 'cr_version', 'hardware_version', 'wan_ipaddr',
      'network_provider', 'modem_main_state', 'prefer_dns_manual',
    ]);
    return {
      model: pick(r, 'wa_inner_version'),
      software: pick(r, 'cr_version', 'wa_inner_version'),
      hardware: pick(r, 'hardware_version'),
      wanIp: pick(r, 'wan_ipaddr'),
      dns: pick(r, 'prefer_dns_manual'),
      operator: pick(r, 'network_provider'),
      simStatus: pick(r, 'modem_main_state'),
    };
  }

  /**
   * حرارة القطع (ZTE 5G: MU5001 / MC801A / MC888...). الأسماء تختلف بين الفيرموير — نقرأ المعروفة ونعرض اللي رجع.
   * القيم بالدرجة المئوية؛ بعض الأجهزة ترجعها ×١٠ أو ×١٠٠٠ فنصحّحها، واللي برا ٠–١٣٠ نتجاهله.
   */
  async getTemps(): Promise<DeviceTemp[]> {
    await this.ensure();
    const F: [string, string][] = [
      ['pm_sensor_pa1', 'المرسل'],
      ['pm_sensor_mdm', 'المودم'],
      ['pm_modem_5g', 'مودم 5G'],
      ['pm_sensor_5g', 'شريحة 5G'],
      ['pm_sensor_ambient', 'داخل الجهاز'],
      ['wifi_chip_temp', 'الواي فاي'],
    ];
    const r = await this.get(F.map(f => f[0])).catch(() => ({} as Record<string, string>));
    const out: DeviceTemp[] = [];
    for (const [k, label] of F) {
      let v = parseFloat((r[k] ?? '').toString());
      if (!Number.isFinite(v)) continue;
      if (v > 1000) v = v / 1000; else if (v > 150) v = v / 10;
      if (v <= 0 || v > 130) continue;
      out.push({ key: k, label, c: Math.round(v) });
    }
    return out;
  }

  async getTraffic(): Promise<Traffic> {
    await this.ensure();
    const r = await this.get(['realtime_tx_thrpt', 'realtime_rx_thrpt', 'realtime_time']);
    return {
      downBytesPerSec: num(r.realtime_rx_thrpt) ?? 0,
      upBytesPerSec: num(r.realtime_tx_thrpt) ?? 0,
      connectedSecs: num(r.realtime_time) ?? 0,
    };
  }

  async getUsage(): Promise<Usage> {
    await this.ensure();
    const r = await this.get(['monthly_rx_bytes', 'monthly_tx_bytes', 'realtime_rx_bytes', 'realtime_tx_bytes']);
    return {
      downloadBytes: num(pick(r, 'monthly_rx_bytes', 'realtime_rx_bytes')) ?? 0,
      uploadBytes: num(pick(r, 'monthly_tx_bytes', 'realtime_tx_bytes')) ?? 0,
    };
  }

  async getDevices(): Promise<ConnectedDevice[]> {
    await this.ensure();
    const raw = await this.getRaw('station_list');
    if (!raw) return [];
    const list: unknown = raw.station_list ?? raw.lan_station_list;
    if (!Array.isArray(list)) return [];
    const out: ConnectedDevice[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const d = item as Record<string, unknown>;
      const macRaw = d.mac_addr ?? d.mac;
      if (typeof macRaw !== 'string' || !macRaw) continue;
      const mac = macRaw.toUpperCase();
      // تحقق بسيط من شكل MAC — يمنع عرض قيم غريبة
      if (!/^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/.test(mac)) continue;
      const ipRaw = d.ip_addr ?? d.ip;
      const nameRaw = d.hostname ?? d.host_name;
      out.push({
        mac,
        ip: typeof ipRaw === 'string' ? ipRaw : undefined,
        name: typeof nameRaw === 'string' ? nameRaw : undefined,
        blocked: false,
      });
    }
    return out;
  }

  async getCells(): Promise<CellTower[]> {
    await this.ensure();
    const s = await this.getSignal();
    const out: CellTower[] = [];
    // s.band نص الدمج "15MHz@1650(B3) + ..." — أول رقم فيه عرض النطاق مو التردد،
    // فنأخذ التردد من داخل القوسين
    const ca = parseZteCa(s.band);
    const pcc = ca.find(c => c.role === 'PCC');
    if (s.rsrp !== undefined || s.pci) {
      out.push({
        kind: 'serving', tech: 'LTE', pci: s.pci, cellId: s.cellId,
        arfcn: s.earfcn ?? pcc?.arfcn, band: pcc?.band ?? lteBandOf(num(s.earfcn)),
        rsrp: s.rsrp, rsrq: s.rsrq, sinr: s.sinr, rssi: s.rssi,
      });
    }
    if (s.nrRsrp !== undefined) {
      out.push({
        kind: 'serving', tech: 'NR', pci: s.nrPci, arfcn: s.nrArfcn,
        band: bandNum(s.nrBand), rsrp: s.nrRsrp, rsrq: s.nrRsrq, sinr: s.nrSinr,
      });
    }
    // النواقل الثانوية — من getCarriers لأنها تعطي رقم البرج (PCI) كمان
    const scc = (await this.getCarriers().catch(() => [] as Carrier[]))
      .filter(c => c.role === 'SCC' && c.tech === 'LTE');
    if (scc.length) {
      for (const c of scc) {
        out.push({ kind: 'secondary', tech: 'LTE', band: c.band, arfcn: c.arfcn, pci: c.pci, rsrp: c.rsrp, rsrq: c.rsrq, sinr: c.sinr });
      }
    } else {
      for (const c of ca) {
        if (c.role !== 'SCC') continue;
        out.push({ kind: 'secondary', tech: c.tech, band: c.band, arfcn: c.arfcn });
      }
    }
    // U30 Pro: neighbor_cell_info مصفوفة JSON (band/earfcn/pci/rsrp/rsrq/sinr)
    if (await this.isU30()) {
      for (const c of await u30Neighbors(this.io()).catch(() => [])) {
        if (c.pci === s.pci && c.arfcn === s.earfcn) continue;
        out.push({ kind: 'neighbor', tech: 'LTE', arfcn: c.arfcn, band: c.band ?? lteBandOf(num(c.arfcn)), pci: c.pci, rsrp: c.rsrp, rsrq: c.rsrq, sinr: c.sinr });
      }
      return out;
    }
    // الأبراج المجاورة (MU5001): "earfcn,pci,rsrq,rsrp,rssi;..." — PCI هنا عشري،
    // وأول سطر غالباً هو البرج الحالي نفسه فنتخطاه
    try {
      const r = await this.get(['ngbr_cell_info']);
      for (const row of (r.ngbr_cell_info || '').split(';')) {
        const p = row.split(',').map(x => x.trim());
        if (p.length < 4 || !p[0]) continue;
        if (p[1] === s.pci && p[0] === s.earfcn) continue;
        const earfcn = num(p[0]);
        out.push({
          kind: 'neighbor', tech: 'LTE',
          arfcn: p[0], band: lteBandOf(earfcn), pci: p[1],
          rsrq: num(p[2]), rsrp: num(p[3]), rssi: num(p[4]),
        });
      }
    } catch {}
    return out;
  }

  // ─── الإعدادات الأصلية والإنقاذ ───
  useBaseline(b: Record<string, string> | null) { this.orig = b; }
  private baseLte(): number[] | null {
    const l = bandsFromMask(this.orig?.lte_band_lock);
    return l.length ? l : null;
  }
  private baseNr(): number[] | null {
    const l = nrList((this.orig && pick(this.orig, 'nr5g_nsa_band_lock', 'nr5g_band_lock', 'nr5g_sa_band_lock')) || undefined);
    return l.length ? l : null;
  }

  async readBaseline(): Promise<Record<string, string> | null> {
    await this.ensure();
    if (await this.isU30()) {
      const [cur, sup] = [await u30ReadLock(this.io()), await u30Supported(this.io())];
      if (u30Locked(cur.lte, sup.lte).length || u30Locked(cur.nr, sup.nr).length) return null;
      if ((await u30CellLocks(this.io()).catch(() => [])).length) return null;
      if (cur.mode === 'Only_LTE' || cur.mode === 'Only_5G') return null;
      return { u30_lte: cur.lte.join(','), u30_nr: cur.nr.join(','), net_select: cur.mode };
    }
    const r = await this.get([
      'lte_band_lock', 'nr5g_nsa_band_lock', 'nr5g_sa_band_lock', 'nr5g_band_lock', 'net_select',
      'lte_pci_lock', 'lte_earfcn_lock', 'nr5g_cell_lock',
    ]);
    // مثبّت على برج؟ هذا مو الوضع الأصلي
    const ear = (r.lte_earfcn_lock || '').trim();
    const nrCell = (r.nr5g_cell_lock || '').split(',').map(x => x.trim());
    if ((ear && ear !== '0') || (nrCell.length >= 2 && nrCell[1] && nrCell[1] !== '0')) return null;
    // التثبيت عادة تردد أو ترددين — الأصلي فيه قائمة كاملة
    if (bandsFromMask(r.lte_band_lock).length < 4) return null;
    const mode = (r.net_select || '').trim();
    if (mode === 'Only_LTE' || mode === 'Only_5G') return null;
    const out: Record<string, string> = {};
    for (const k of ['lte_band_lock', 'nr5g_nsa_band_lock', 'nr5g_sa_band_lock', 'nr5g_band_lock', 'net_select']) {
      if (r[k] !== undefined && r[k] !== '') out[k] = r[k];
    }
    return out;
  }

  async restoreAll(baseline: Record<string, string> | null): Promise<void> {
    if (baseline) this.orig = baseline;
    await this.ensure();
    if (await this.isU30()) return this.u30RestoreAll(baseline);

    const profile = await this.identify();
    const canRestoreNr = profile?.nrLock === true;
    const ok: string[] = [];

    const writeAndVerify = async (
      name: string,
      write: () => Promise<string>,
      verify: () => Promise<boolean>,
    ): Promise<boolean> => {
      try {
        const out = await write();
        if (!/success/i.test(out)) {
          this.log('restore', name, 'write rejected');
          return false;
        }
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            if (await verify()) {
              ok.push(name);
              return true;
            }
          } catch (e) {
            this.log('restore', name, 'readback failed', (e as any)?.message);
          }
          if (attempt < 3) await sleep(1500);
        }
        this.log('restore', name, 'readback mismatch');
      } catch (e) {
        this.log('restore', name, 'failed', (e as any)?.message);
      }
      return false;
    };

    const sameBands = (actual: number[], expected: number[]) => {
      const a = [...actual].sort((x, y) => x - y);
      const b = [...expected].sort((x, y) => x - y);
      return a.length === b.length && a.every((v, i) => v === b[i]);
    };

    // أمان: لا نفك أقفال الأبراج العامة عبر goform.
    // نعيد الترددات ووضع الشبكة فقط؛ مسار U30 Pro الخاص محفوظ أعلاه.

    // ١. ترددات 4G: لا نعتبر رد success إثباتًا أن الإعداد تغيّر.
    const lteTries = [
      this.baseLte(),
      [...new Set([...DEFAULT_LTE, ...WIDE_LTE])].sort((a, b) => a - b),
      DEFAULT_LTE,
    ].filter((x): x is number[] => !!x && x.length > 0);

    let lteRestored = false;
    for (const bands of lteTries) {
      const expected = [...bands].sort((a, b) => a - b);
      lteRestored = await writeAndVerify(
        'lte-bands',
        () => this.act({
          goformId: 'BAND_SELECT',
          is_gw_band: '0',
          gw_band_mask: '0',
          is_lte_band: '1',
          lte_band_mask: maskFromBands(bands),
        }),
        async () => {
          const r = await this.get(['lte_band_lock']);
          const raw = r.lte_band_lock;
          if (typeof raw !== 'string' || !raw.trim()) return false;
          const actual = bandsFromMask(raw);
          return actual.length > 0 && sameBands(actual, expected);
        },
      );
      if (lteRestored) break;
    }

    // ٢. ترددات 5G: لا نرسل أي أمر إلا لموديل مؤكّد الدعم.
    // الحقول المفقودة لا تُفسّر على أنها قائمة فارغة أو نجاح.
    let nrRestored = false;
    if (canRestoreNr) {
      const nrTries = [
        this.baseNr(),
        SAFE_NR,
      ].filter((x): x is number[] => !!x && x.length > 0);

      for (const bands of nrTries) {
        const expected = [...bands].sort((a, b) => a - b);
        nrRestored = await writeAndVerify(
          'nr-bands',
          () => this.act({
            goformId: 'WAN_PERFORM_NR5G_BAND_LOCK',
            nr5g_band_mask: bands.join(','),
          }),
          async () => {
            const r = await this.get([
              'nr5g_nsa_band_lock',
              'nr5g_sa_band_lock',
              'nr5g_band_lock',
            ]);
            const raw = pick(
              r,
              'nr5g_nsa_band_lock',
              'nr5g_band_lock',
              'nr5g_sa_band_lock',
            );
            if (typeof raw !== 'string' || !raw.trim()) return false;
            const actual = nrList(raw);
            return actual.length > 0 && sameBands(actual, expected);
          },
        );
        if (nrRestored) break;
      }
    } else {
      this.log('restore', 'nr-bands', 'skipped: model support not confirmed');
    }

    // ٣. وضع الشبكة: الأصلي أو 4G + 5G، مع قراءة تحقق فعلية.
    const origMode = (this.orig?.net_select || '').trim();
    const mode = origMode && !/^WL|WCDMA|GSM/i.test(origMode)
      ? origMode
      : CODE_TO_ZTE['0803'];

    const modeRestored = await writeAndVerify(
      'mode',
      () => this.act({
        goformId: 'SET_BEARER_PREFERENCE',
        BearerPreference: mode,
      }),
      async () => {
        const r = await this.get(['net_select']);
        return typeof r.net_select === 'string'
          && !!r.net_select.trim()
          && r.net_select.trim() === mode;
      },
    );

    this.log('restoreAll verified:', ok.join(',') || 'none');

    if (!lteRestored || !modeRestored || (canRestoreNr && !nrRestored)) {
      throw new Error(
        'لم نتحقق من استعادة كل الإعدادات المطلوبة؛ أوقفنا إعادة التشغيل لتقليل المخاطر. افحص إعدادات الراوتر قبل إعادة المحاولة.',
      );
    }

    // ٤. إعادة التشغيل فقط بعد نجاح التحقق من الإعدادات المطلوبة.
    await this.assertWritable('REBOOT_DEVICE');
    try {
      await this.post({ goformId: 'REBOOT_DEVICE' });
    } catch {}
  }
  // ─── الترددات ───
  private async readLocks() {
    const r = await this.get(['lte_band_lock', 'nr5g_nsa_band_lock', 'nr5g_sa_band_lock', 'nr5g_band_lock']);
    const lte = bandsFromMask(r.lte_band_lock);
    const nr = nrList(pick(r, 'nr5g_nsa_band_lock', 'nr5g_band_lock', 'nr5g_sa_band_lock'));
    return { lte, nr };
  }

  async getBandConfig(): Promise<BandConfig> {
    await this.ensure();
    if (await this.isU30()) return this.u30BandConfig();
    const { lte, nr } = await this.readLocks();
    const bl = this.baseLte();
    const bn = this.baseNr();
    const supported = [...new Set([...DEFAULT_LTE, ...lte, ...(bl ?? [])])].sort((a, b) => a - b);
    const nrSupported = [...new Set([...DEFAULT_NR, ...nr, ...(bn ?? [])])].sort((a, b) => a - b);
    // لو نعرف الأصلي: مو مقفول طالما كل الترددات الأصلية مفتوحة
    const locked = lte.length === 0 || (bl ? bl.every(b => lte.includes(b)) : supported.every(b => lte.includes(b))) ? [] : lte;
    // نفس القاعدة القديمة: لو فيها n40+n41+n78 كلها نعتبرها غير مثبّتة (قائمة الراوتر الأصلية تختلف من جهاز لجهاز)
    const nrLocked = nr.length === 0 || (bn ? bn.every(b => nr.includes(b)) : SAFE_NR.every(b => nr.includes(b))) ? [] : nr;
    // وضع الشبكة (net_select) — نحوّله لنفس أكواد هواوي عشان الشاشات تشتغل على الاثنين
    let mode = 'auto';
    let modes: { value: string; label: string }[] = [];
    try {
      const r = await this.get(['net_select']);
      const raw = (r.net_select || '').trim();
      if (raw) {
        mode = ZTE_TO_CODE[raw] ?? raw;
        modes = [
          { value: '00', label: 'تلقائي' },
          { value: '0803', label: '4G + 5G' },
          { value: '03', label: '4G فقط' },
          { value: '08', label: '5G فقط (SA)' },
        ];
      }
    } catch {}
    // اللي نجرّبه تلقائياً: إعداد الراوتر الأصلي (أو المصنع) + المكتوب حالياً — مو DEFAULT_NR (أغلبها يرفضها الفيرموير)
    const nrPreferred = [...new Set([...(bn ?? SAFE_NR), ...nr])].sort((a, b) => a - b);
    // موديل 4G بس (مثل U10S Pro) أو ما يقبل تثبيت 5G ← ما نعرض خيارات 5G
    const prof = await this.identify();
    if (prof?.nrLock === false) return { supported, locked, nrSupported: [], nrLocked: [], nrPreferred: [], nrLockable: false, mode, modes };
    return { supported, locked, nrSupported, nrLocked, nrPreferred, mode, modes };
  }

  /** وضع الشبكة: 00 تلقائي، 0803 = 4G+5G، 03 = 4G فقط، 08 = 5G فقط (SA) — أو القيمة الأصلية كما هي */
  async setNetworkMode(mode: string): Promise<void> {
    await this.ensure();
    const v = CODE_TO_ZTE[mode] ?? mode;
    { const ng = await this.ubusFirst(); if (ng) { try { await ng.setNetworkMode(v); return; } catch (e) { this.log('ubus write failed → goform', (e as any)?.message); } } }
    const out = await this.act({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: v });
    if (!/success/i.test(out)) {
      const ng = (await this.identify())?.pinned ? null : await this.ngWriter();
      if (ng) { await ng.setNetworkMode(v); return; }
      throw this.rejected('تغيير وضع الشبكة', out);
    }
  }

  async setBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    await this.ensure();
    if (await this.isU30()) {
      // صفحة الراوتر نفسها تعيد التشغيل بعد تغيير الترددات — بدونها ما يتطبّق
      if (await u30SetBands(this.io(), bands, nrBands)) await this.rebootAndWait();
      return;
    }
    if (bands !== 'keep') await this.setLteBands(bands);
    if (nrBands) await this.setNrBands(nrBands);
  }
  private async setLteBands(bands: number[]): Promise<void> {
    // «فك التثبيت» = الترددات الأصلية للراوتر لو نعرفها (مو قائمة تخمينية — كانت تشيل ترددات زي B38 ويطيح الراوتر بدون خدمة)
    const all = this.baseLte() ?? [...new Set([...DEFAULT_LTE, ...(await this.readLocks()).lte])];
    const lte = bands.length ? bands : all;
    { const ng = await this.ubusFirst(); if (ng) { try { await ng.setBand(lte, undefined); return; } catch (e) { this.log('ubus write failed → goform', (e as any)?.message); } } }
    // بعض الفيرموير (MC888/MC889…) يبي القناع ١٢ خانة بالضبط: 0x000000000005 بدل 0x5
    const short = maskFromBands(lte);
    const padded = '0x' + short.slice(2).padStart(12, '0');
    const pin = (await this.identify())?.pinned;
    // موديل مقفول (MU5001): القناع اللي ثبت عنده بس — بدون تجارب
    const masks = pin ? [pin.lteMask === 'padded' ? padded : short] : [...new Set(this.ltePad ? [padded, short] : [short, padded])];
    const send = (m: string) => this.act({
      goformId: 'BAND_SELECT',
      is_gw_band: '0', gw_band_mask: '0',
      is_lte_band: '1', lte_band_mask: m,
    });
    let out = '';
    for (const m of masks) {
      out = await send(m);
      if (/success/i.test(out)) { this.ltePad = m === padded && m !== short; return; }
    }
    if (pin) throw this.rejected('تثبيت الترددات', out);
    // آخر شي: جلسة مطوّر (بعض الأجهزة تشترطها للتثبيت)
    if (await this.devLogin()) {
      for (const m of masks) {
        out = await send(m);
        if (/success/i.test(out)) { this.ltePad = m === padded && m !== short; return; }
      }
    }
    // أجهزة ZTE الجديدة (MC801A Pro بصفحة G5…): القراءة goform بس الكتابة عبر ubus
    const ng = await this.ngWriter();
    if (ng) { await ng.setBand(lte, undefined); return; }
    throw this.rejected('تثبيت الترددات', out);
  }
  private ltePad = false;
  private profile: ModelProfile | null = null;
  /** الموديل من wa_inner_version/web_version — بدون دخول */
  async identify(): Promise<ModelProfile | null> {
    if (this.profile) return this.profile;
    try {
      const r = await this.get(['wa_inner_version', 'web_version', 'hardware_version']);
      if (!r.wa_inner_version && !r.web_version) return null;
      this.profile = identifyZte(r.wa_inner_version, r.web_version, r.hardware_version);
      this.log('model:', this.profile.label, '· write:', this.profile.write);
    } catch { return null; }
    return this.profile;
  }
  /** الموديل معروف إنه يكتب عبر ubus؟ نروح له على طول بدل ما نجرّب goform ونفشل */
  private async ubusFirst(): Promise<ZteNgDriver | null> {
    const p = await this.identify();
    return p?.write === 'ubus' ? await this.ngWriter() : null;
  }
  /** كاتب احتياطي عبر ubus (undefined = ما فحصنا، null = الجهاز ما يدعمه) */
  private ng: ZteNgDriver | null | undefined;
  private async ngWriter(): Promise<ZteNgDriver | null> {
    if (this.ng !== undefined) return this.ng;
    this.ng = null;
    try {
      const d = new ZteNgDriver();
      if (await d.detect(this.host)) {
        await d.login(this.host, '', this.password);
        this.ng = d;
        this.log('writer: ubus (zwrt) — goform رفض الكتابة');
      }
    } catch { this.ng = null; }
    return this.ng;
  }
  /** أي أمر 5G قبله الراوتر: classic = WAN_PERFORM_NR5G_BAND_LOCK (MU5001)، sansa = الأحدث مع type */
  private nrCmd: 'classic' | 'sansa' | null = null;
  private async setNrBands(nrBands: number[]): Promise<void> {
    const cur = (await this.readLocks()).nr;
    // «أي 5G» (تلقائي) والراوتر ما فيه قفل 5G أصلاً (أو ما يعطيه): ما فيه شي نغيّره.
    // قبل: نرسل قائمة افتراضية، والراوتر (4G بس / ما يقبل) يرفض ← «الراوتر رفض» ← إرجاع (تقرير ٢٥ أكتوبر، ZTE على Infinix)
    if (!nrBands.length && !cur.length) return;
    // الراوتر رفض كل أوامر 5G قبل (كل الصيغ + المطوّر + ubus) — ما نعيد ١٤ أمر كل ضغطة
    if (this.nrDead) throw this.rejected('تثبيت ترددات 5G', 'failure');
    const nr = nrBands.length ? nrBands : (this.baseNr() ?? SAFE_NR);
    const same = cur.length === nr.length && nr.every(b => cur.includes(b));
    if (same) return;
    { const ng = await this.ubusFirst(); if (ng) { try { await ng.setNrBandsTyped(nr, (await this.nrType()) === '1'); return; } catch (e) { this.log('ubus write failed → goform', (e as any)?.message); } } }
    const pinNr = (await this.identify())?.pinned?.nrCmd;
    const classic = (m: string) => this.act({ goformId: 'WAN_PERFORM_NR5G_BAND_LOCK', nr5g_band_mask: m });
    const sansa = async (m: string) => this.act({
      goformId: 'WAN_PERFORM_NR5G_SANSA_BAND_LOCK', nr5g_band_mask: m, type: await this.nrType(),
    });
    const ok = (o: string) => /success/i.test(o);
    const tryAll = async (m: string): Promise<string> => {
      const order = pinNr ? [pinNr === 'sansa' ? sansa : classic] : this.nrCmd === 'sansa' ? [sansa, classic] : [classic, sansa];
      let o = '';
      for (const f of order) {
        o = await f(m);
        if (ok(o)) { this.nrCmd = f === sansa ? 'sansa' : 'classic'; return o; }
      }
      return o;
    };
    let o2 = await tryAll(nr.join(','));
    if (!ok(o2) && !nrBands.length) o2 = await tryAll(SAFE_NR.join(','));
    // آخر شي: جلسة مطوّر ثم نعيد
    if (!ok(o2) && pinNr) throw this.rejected('تثبيت ترددات 5G', o2);
    if (!ok(o2) && await this.devLogin()) o2 = await tryAll(nr.join(','));
    if (!ok(o2)) {
      const ng = await this.ngWriter();
      if (ng) { await ng.setNrBandsTyped(nr, (await this.nrType()) === '1'); return; }
      this.nrDead = true;
      throw this.rejected('تثبيت ترددات 5G', o2);
    }
  }
  private nrDead = false;

  async getActiveLock(): Promise<ActiveLock | null> {
    const c = await this.getBandConfig();
    if (!c.locked.length && !c.nrLocked.length) return null;
    return { bands: c.locked, nrBands: c.nrLocked };
  }

  /** النواقل: الأساسي 4G + 5G المرتبط (NSA) — الدمج الإضافي لو الراوتر يعطيه */
  async getCarriers(): Promise<Carrier[]> {
    await this.ensure();
    const r = await this.get([
      'lte_band', 'wan_active_channel', 'lte_pci', 'lte_rsrp', 'lte_rsrq', 'lte_snr',
      'lte_ca_pcell_bandwidth', 'wan_lte_ca', 'lte_multi_ca_scell_info',
      'nr5g_action_band', 'nr5g_action_channel', 'nr5g_pci',
      'Z5g_rsrp', 'Z5g_rsrq', 'Z5g_SINR', 'nr5g_bandwidth',
      'nr5g_band', 'nr5g_sa_band', 'nr5g_sa_pci', 'nr5g_dlEarfcn',
      'nr5g_dl_earfcn', 'nr5g_sa_arfcn', 'nr5g_rsrp', 'nr5g_sinr',
      'nr5g_rsrq', 'nr5g_dlbandwidth', 'nr5g_sa_bandwidth',
      // عرض 5G — كل فيرموير يسميه باسم (تطبيقات ثانية تعرضه، فالراوتر يعطيه)
      'nr5g_dl_bandwidth', 'nr_ca_pcell_bandwidth', 'nr5g_ca_pcell_bandwidth',
      // MC888/MC889: تردد 5G بوضع NSA + دمج 5G (أكثر من تردد 5G مع بعض)
      'nr5g_action_nsa_band', 'nr5g_nsa_bandwidth', 'nr_ca_pcell_band', 'nr_multi_ca_scell_info',
    ]);
    const out: Carrier[] = [];
    const earfcn = num(r.wan_active_channel);
    const band = bandNum(r.lte_band) ?? lteBandOf(earfcn);
    if (band) {
      out.push({
        tech: 'LTE', role: 'PCC', band, arfcn: r.wan_active_channel || undefined, pci: pciDec(r.lte_pci),
        bandwidth: num(r.lte_ca_pcell_bandwidth), rsrp: num(r.lte_rsrp), rsrq: num(r.lte_rsrq), sinr: num(r.lte_snr),
      });
    }
    if (/activ/i.test(r.wan_lte_ca || '') && !/deactiv|inactiv/i.test(r.wan_lte_ca || '')) {
      for (const row of (r.lte_multi_ca_scell_info || '').split(';')) {
        const f = row.split(',').map(x => x.trim());
        if (f.length < 5) continue;
        const b = bandNum(f[3]) ?? lteBandOf(num(f[4]));
        if (!b) continue;
        out.push({
          tech: 'LTE', role: 'SCC', band: b, arfcn: f[4] || undefined,
          pci: pciDec(f[1]), bandwidth: num(f[5]),
        });
      }
    }
    const nrBand = pick(r, 'nr5g_action_band', 'nr5g_action_nsa_band', 'nr_ca_pcell_band', 'nr5g_band', 'nr5g_sa_band');
    const nrRsrpV = pick(r, 'Z5g_rsrp', 'nr5g_rsrp');
    const nb = bandNum(nrBand);
    if (nb && nrRsrpV) {
      out.push({
        tech: 'NR', role: out.length ? 'SCC' : 'PCC', band: nb,
        arfcn: pick(r, 'Z5g_dlEarfcn', 'nr5g_action_channel', 'nr5g_dlEarfcn', 'nr5g_sa_arfcn') || undefined,
        pci: pciDec(pick(r, 'nr5g_pci', 'nr5g_sa_pci')),
        bandwidth: num(pick(r, 'nr5g_bandwidth', 'nr5g_dlbandwidth', 'nr5g_nsa_bandwidth', 'nr5g_sa_bandwidth', 'nr5g_dl_bandwidth', 'nr_ca_pcell_bandwidth', 'nr5g_ca_pcell_bandwidth')),
        rsrp: num(nrRsrpV),
        rsrq: num(pick(r, 'Z5g_rsrq', 'nr5g_rsrq')),
        sinr: num(pick(r, 'Z5g_SINR', 'nr5g_sinr')),
      });
      // دمج 5G: «idx,pci,?,band,arfcn,bw,?,rsrp,rsrq,sinr» لكل ناقل، مفصولة بـ ;
      for (const row of (r.nr_multi_ca_scell_info || '').split(';')) {
        const f = row.split(',').map(x => x.trim());
        if (f.length < 6) continue;
        const b = bandNum(f[3]);
        if (!b) continue;
        const rsrp = num(f[7]);
        out.push({
          tech: 'NR', role: 'SCC', band: b, arfcn: f[4] || undefined, pci: pciDec(f[1]),
          bandwidth: num((f[5] || '').replace(/MHz/i, '')),
          rsrp: rsrp !== undefined && rsrp < 0 ? rsrp : undefined,
          rsrq: num(f[8]), sinr: f[9] && f[9] !== '0.0' ? num(f[9]) : undefined,
        });
      }
    }
    return out;
  }

  // ─── التثبيت على برج (Cell Lock) ───

  async getCellLocks(): Promise<CellLockState[]> {
    await this.ensure();
    if (await this.isU30()) return (await u30CellLocks(this.io())).map(c => ({ tech: c.tech, pci: c.pci, arfcn: c.arfcn, band: c.tech === 'LTE' ? lteBandOf(num(c.arfcn)) : undefined }));
    const r = await this.get(['lte_pci_lock', 'lte_earfcn_lock', 'nr5g_cell_lock']);
    const out: CellLockState[] = [];
    const pci = (r.lte_pci_lock || '').trim();
    const ear = (r.lte_earfcn_lock || '').trim();
    if (pci && ear && ear !== '0') out.push({ tech: 'LTE', pci, arfcn: ear, band: lteBandOf(num(ear)) });
    const nr = (r.nr5g_cell_lock || '').split(',').map(x => x.trim());
    if (nr.length >= 2 && nr[1] && nr[1] !== '0') out.push({ tech: 'NR', pci: nr[0], arfcn: nr[1], band: bandNum(nr[2]) });
    return out;
  }

  async getCellLock(): Promise<CellLockState | null> {
    return (await this.getCellLocks())[0] ?? null;
  }

  private async servingPci(tech: 'LTE' | 'NR'): Promise<string | undefined> {
    const s = await this.getSignal();
    return tech === 'NR' ? s.nrPci : s.pci;
  }

  private async waitServing(tech: 'LTE' | 'NR', pci: string, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      await sleep(3000);
      try { if ((await this.servingPci(tech)) === pci) return true; } catch {}
    }
    return false;
  }

  /** يعيد تشغيل الراوتر وينتظره يرجع ويتصل (حتى ~٣ دقائق) */
  private async rebootAndWait(): Promise<void> {
    await this.assertWritable('REBOOT_DEVICE');
    try { await this.post({ goformId: 'REBOOT_DEVICE' }); } catch {}
    await sleep(25000);
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      try {
        await this.login(this.host, '', this.password);
        if (await this.isConnected()) return;
      } catch {}
      await sleep(5000);
    }
  }

  /** لقطة إعدادات القفل قبل التجربة (قراءة فقط) — ترمي لو القراءة ناقصة */
  async readLockState(): Promise<LockSnapshot> {
    await this.ensure();
    if (await this.isU30()) {
      const d = await u30ReadLock(this.io());
      if (!d.lte.length) throw new Error('ما قدرنا نقرأ ترددات الراوتر كاملة — ما غيّرنا شي');
      return { driver: this.id, at: Date.now(), summary: u30Summary(d), data: { u30: d } };
    }
    const r = await this.get([...ZTE_LOCK_KEYS]);
    checkLockResponse(r);
    const data: ZteLockData = {};
    for (const k of ZTE_LOCK_KEYS) data[k] = (r[k] ?? '').trim();
    checkComplete(data);
    return { driver: this.id, at: Date.now(), summary: zteSummary(data), data };
  }
  /**
   * يرجّع اللقطة: نكتب بس الأجزاء اللي تغيّرت، وبعدها نقرأ ونقارن.
   * قفل البرج على الأجهزة اللي تحتاج إعادة تشغيل عشان تطبّقه: نعيد التشغيل وننتظر (مثل التثبيت نفسه).
   */
  async restoreLockState(snap: LockSnapshot): Promise<void> {
    if (snap.driver !== this.id) throw new Error('اللقطة من نوع راوتر ثاني — ما نرجّعها');
    await this.ensure();
    const u = (snap.data as { u30?: U30Lock })?.u30;
    if (u) return this.u30Restore(u);
    const d = snap.data as ZteLockData;
    const read = async () => {
      const r = await this.get([...ZTE_LOCK_KEYS]);
      checkLockResponse(r);
      const o: ZteLockData = {};
      for (const k of ZTE_LOCK_KEYS) o[k] = (r[k] ?? '').trim();
      checkComplete(o);
      return o;
    };
    const todo = zteDiff(d, await read());
    this.log('restore parts', todo.join(',') || 'none');
    const must = (what: string, out: string) => { if (!/success/i.test(out)) throw this.rejected(what, out); };
    // نفس طرق التثبيت (فيها البدائل: القناع الطويل، أمر 5G الجديد، دخول المطوّر، ubus)
    if (todo.includes('mode') && d.net_select) await this.setNetworkMode(d.net_select);
    if (todo.includes('lte') && lteBands(d).length) await this.setLteBands(lteBands(d));
    if (todo.includes('nr') && nrBands(d).length) await this.setNrBands(nrBands(d));
    // لا نكتب أقفال الأبراج العامة أثناء الاستعادة.
    // إذا اختلف قفل برج، ستظهر عدم المطابقة في التحقق النهائي بدلًا من
    // إرسال أوامر فك/تثبيت غير آمنة.
    // الراوتر يحدّث lte_band_lock بعد لحظة من «success» — كنا نقرأ بعد ٥٠ms ونقول «ما رجع» (تقرير ٢٥ أكتوبر)
    let left = zteDiff(d, await read());
    for (let i = 0; i < 4 && left.length; i++) {
      await new Promise(r => setTimeout(r, 1500));
      left = zteDiff(d, await read());
    }
    this.log('restore verify', left.join(',') || 'match');
    if (left.length) throw restoreMismatch(left.map(x => ZTE_PART_LABEL[x]));
  }
  async lockCell(t: CellLockTarget): Promise<void> {
    throw noChange('تثبيت البرج موقوف على راوترات ZTE العامة حفاظًا على الخدمة. استخدم تثبيت الترددات بدلًا منه.');
  }

  /**
   * فك تثبيت برج 4G. مجرّب حي على MU5001 (١٨ أكتوبر): الفاضي يرد failure وما يفك القفل،
   * و0/0 ينقبل بس بعد إعادة التشغيل علق الراوتر بدون خدمة لين ضبط المصنع.
   * أهم شي: **لو ما فيه قفل ما نرسل شي** — ليلة ١٧ أكتوبر «رجّع الإشارة» أرسل 0/0 لراوتر نظيف وعلّقه.
   */
  private async clearLteCell(): Promise<string> {
    const cur = await this.get(['lte_pci_lock', 'lte_earfcn_lock']).catch(() => null);
    const v = (x?: string) => (x ?? '').trim();
    if (cur && !v(cur.lte_earfcn_lock) && !v(cur.lte_pci_lock)) return '{"result":"success"}';
    if (cur && v(cur.lte_earfcn_lock) === '0' && v(cur.lte_pci_lock) === '0') return '{"result":"success"}';
    if (!cur) throw noChange('تعذرت قراءة قفل برج 4G؛ أوقفنا العملية ولم نرسل أي أمر.');
    throw noChange('فك قفل برج 4G غير مدعوم بأمان على راوترات ZTE العامة؛ لم نرسل أي أمر.');
  }
  private async clearNrCell(): Promise<string> {
    const cur = await this.get(['nr5g_cell_lock']).catch(() => null);
    const f = (cur?.nr5g_cell_lock ?? '').split(',').map(x => x.trim());
    if (cur && (!f[0] || f.every(x => !x || x === '0'))) return '{"result":"success"}';
    if (!cur) throw noChange('تعذرت قراءة قفل برج 5G؛ أوقفنا العملية ولم نرسل أي أمر.');
    throw noChange('فك قفل برج 5G غير مدعوم بأمان على راوترات ZTE العامة؛ لم نرسل أي أمر.');
  }

  async unlockCell(tech?: 'LTE' | 'NR'): Promise<void> {
    await this.ensure();
    // U30: أمر وحيد يفك الكل (UNLOCK_ALL_CELL) وصفحته تعيد التشغيل بعده
    if (await this.isU30()) { if (await u30UnlockAll(this.io())) await this.rebootAndWait(); return; }
    // لا نعتبر فشل القراءة دليلًا على عدم وجود قفل.
    const had = await this.getCellLocks();
    const relevant = had.filter(h => !tech || h.tech === tech);
    if (!relevant.length) return;
    throw noChange('يوجد قفل برج، لكن فكّه غير مدعوم بأمان على راوترات ZTE العامة. لم نرسل أي أمر؛ استخدم واجهة الراوتر الرسمية بحذر.');
  }

  async reboot(): Promise<void> {
    await this.ensure();
    // أجهزة G5 (MC801A Pro…): التغييرات كلها عبر ubus
    const ng = await this.ubusFirst();
    if (ng) { try { await ng.reboot(); return; } catch (e) { this.log('ubus reboot failed → goform', (e as any)?.message); } }
    await this.post({ goformId: 'REBOOT_DEVICE' });
  }
  async reconnectData(opts?: { holdSecs?: number }): Promise<void> {
    await this.ensure();
    await this.g5Guard('آي بي جديد');
    const off = await this.act({ goformId: 'DISCONNECT_NETWORK' });
    if (!/success/i.test(off)) throw this.rejected('قطع الاتصال', off);
    // ننتظر الجلسة تنقطع فعلاً، ونخليها مقطوعة شوي عشان الشركة تفك الآي بي
    for (let i = 0; i < 6; i++) {
      await sleep(2000);
      const r = await this.get(['ppp_status']).catch(() => ({} as Record<string, string>));
      if (/disconnected/i.test(r.ppp_status || '')) break;
    }
    await sleep((opts?.holdSecs ?? 10) * 1000);
    const on = await this.act({ goformId: 'CONNECT_NETWORK' });
    if (!/success/i.test(on)) throw this.rejected('إرجاع الاتصال', on);
  }

  // ───── قنوات الواي فاي ─────
  /** من وين جات القنوات: ap = queryAccessPointInfo (MU5001…)، legacy = حقل Channel القديم */
  private wifiSrc: 'ap' | 'legacy' | null = null;
  private static readonly WIFI_FIELDS = ['Channel', 'wifi_band', 'WirelessMode', 'CountryCode', 'HT_MCS', 'wifi_11n_cap'];
  private static readonly WIFI5_FIELDS = ['m_Channel', 'Channel_5G', 'channel_5g', 'wifi_5g_channel'];

  async getWifiRadios(): Promise<WifiRadio[]> {
    await this.ensure();
    // الموديلات الجديدة (MU5001…): القنوات في queryAccessPointInfo لكل شريحة
    let fresh = await zteRadios(this.io()).catch(() => []);
    // بعد تغيير القناة بعض الأجهزة ترد بقائمة فاضية لين ندخل من جديد (تقرير MU5001: len=27 لدقايق)
    if (!fresh.length && this.wifiSrc === 'ap' && this.password) {
      try { await this.login(this.host, '', this.password, { fresh: true }); } catch {}
      fresh = await zteRadios(this.io()).catch(() => []);
    }
    if (fresh.length) { this.wifiSrc = 'ap'; return fresh; }
    if (this.wifiSrc === 'ap') throw new Error('الراوتر ما رد على إعدادات الواي فاي — غالباً الواي فاي يعيد التشغيل. جرّب بعد ثواني.');
    this.wifiSrc = 'legacy';
    const r = await this.get(ZteDriver.WIFI_FIELDS).catch(() => ({} as Record<string, string>));
    const out: WifiRadio[] = [];
    const ch = (r.Channel ?? '').trim();
    if (/^\d{1,3}$/.test(ch)) {
      const five = /^a$|5/i.test(r.wifi_band ?? '') || Number(ch) >= 36;
      out.push({ band: five ? '5' : '2.4', channel: ch, writable: true });
    }
    // بعض الموديلات ثنائية النطاق تحط قناة الـ5 في حقل ثاني — نعرضها بس (الكتابة غير مؤكدة)
    const r5 = await this.get(ZteDriver.WIFI5_FIELDS).catch(() => ({} as Record<string, string>));
    const v5 = ZteDriver.WIFI5_FIELDS.map(k => (r5[k] ?? '').trim()).find(v => /^\d{1,3}$/.test(v));
    if (v5 && !out.some(o => o.band === '5')) out.push({ band: '5', channel: v5, writable: false });
    return out;
  }

  async setWifiChannel(band: '2.4' | '5', channel: string): Promise<void> {
    await this.ensure();
    // الواي فاي ممكن يكون يعيد التشغيل من تغيير قبل (أثناء «دوّر على أنظف قناة») — نعيد القراءة شوي
    // قبل ما نقرر إن الراوتر من النوع القديم (كان يطلع «ما يسمح نغيّر قناة هذا النطاق» بالغلط على MU5001)
    for (let i = 0; i < (this.wifiSrc === 'legacy' ? 1 : 4); i++) {
      if ((await zteRadios(this.io()).catch(() => [])).length) { this.wifiSrc = 'ap'; return zteSetChannel(this.io(), band, channel); }
      if (this.wifiSrc !== 'legacy') {
        // المحاولة الثانية: دخول جديد (القائمة الفاضية غالباً جلسة انتهت بعد إعادة تشغيل الواي فاي)
        if (i === 1 && this.password) { try { await this.login(this.host, '', this.password, { fresh: true }); } catch {} }
        await sleep(2500);
      }
    }
    if (this.wifiSrc === 'ap') throw new Error('الراوتر ما رد على إعدادات الواي فاي — غالباً الواي فاي يعيد التشغيل.');
    const r = await this.get(ZteDriver.WIFI_FIELDS);
    const five = /^a$|5/i.test(r.wifi_band ?? '') || Number(r.Channel) >= 36;
    if ((band === '5') !== five) throw new Error('هذا الراوتر ما يسمح نغيّر قناة هذا النطاق من التطبيق');
    const out = await this.act({
      goformId: 'SET_WIFI_INFO',
      wifiMode: r.WirelessMode || '4',
      countryCode: r.CountryCode || 'SA',
      selectedChannel: channel,
      abg_rate: r.HT_MCS || '0',
      wifi_band: r.wifi_band || 'b',
      wifi_11n_cap: r.wifi_11n_cap || '1',
    });
    if (!/success/i.test(out)) throw this.rejected('تغيير القناة', out);
  }

  /** فصل كامل عن البرج (وضع الطيران LOW_POWER ثم ONLINE) — الشركة تفك الآي بي مثل إعادة التشغيل */
  /**
   * فصل كامل عن البرج ورجوع (مثل الطفي) عشان الشركة تفك الآي بي.
   * ١) وضع الطيران — بعض الأجهزة ترد «failure» وهي طبّقته، فنتأكد بالقراءة مو بالرد.
   * ٢) ما اشتغل؟ نحوّل وضع الشبكة مؤقتاً لوضع ما فيه خدمة عندنا (3G فقط / 5G SA فقط) ونرجّعه.
   */
  async reattach(holdSecs = 12) {
    await this.ensure();
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
    const read = (f: string[]) => this.get(f).catch(() => ({} as Record<string, string>));

    // ١) وضع الطيران
    const off = await this.act({ goformId: 'WAN_OPERATE_MODE_SET', operate_mode: 'LOW_POWER' }).catch(() => '');
    let flight = /success/i.test(off);
    for (let i = 0; i < 4 && !flight; i++) {
      await wait(1500);
      const r = await read(['operate_mode', 'network_type', 'ppp_status']);
      flight = /LOW_POWER|OFFLINE/i.test(r.operate_mode || '') || /^(no ?service|limited|airplane)/i.test(r.network_type || '');
    }
    if (flight) {
      try {
        await wait(holdSecs * 1000);
      } finally {
        let ok = false;
        for (let i = 0; i < 5 && !ok; i++) {
          await this.act({ goformId: 'WAN_OPERATE_MODE_SET', operate_mode: 'ONLINE' }).catch(() => '');
          await wait(2000);
          const r = await read(['operate_mode', 'network_type']);
          // لو الراوتر ما يعطي operate_mode: نحكم من نوع الشبكة (مو «بلا خدمة»)
          ok = r.operate_mode ? /ONLINE/i.test(r.operate_mode) : !!r.network_type && !/no ?service|limited|airplane/i.test(r.network_type);
        }
        if (!ok) throw new Error('ما قدرنا نطلّع الراوتر من وضع الطيران — أعد تشغيله');
      }
      return;
    }

    // ٢) تبديل وضع الشبكة مؤقتاً
    const orig = ((await read(['net_select'])).net_select || '').trim();
    if (!orig) throw this.rejected('الفصل عن البرج', off);
    this.reattachOrig = orig;
    let switched = '';
    for (const temp of ['Only_WCDMA', 'Only_5G']) {
      if (temp === orig) continue;
      await this.act({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: temp }).catch(() => '');
      await wait(1500);
      if (((await read(['net_select'])).net_select || '').trim() === temp) { switched = temp; break; }
    }
    if (!switched) throw this.rejected('الفصل عن البرج', off);
    try {
      await wait(holdSecs * 1000);
    } finally {
      let ok = false;
      for (let i = 0; i < 5 && !ok; i++) {
        await this.act({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: orig }).catch(() => '');
        await wait(2000);
        ok = ((await read(['net_select'])).net_select || '').trim() === orig;
      }
      if (!ok) throw new Error('ما قدرنا نرجّع وضع الشبكة — اضغط «رجّع الإشارة» من صفحة الراوتر');
      this.reattachOrig = '';
    }
  }

  private reattachOrig = '';

  // ───── فحص المكان (الموقع المقترح) — نفس أوامر صفحة الراوتر ─────
  async placeCheckStart() {
    await this.ensure();
    const out = await this.act({ goformId: 'SIGNAL_QUALITY_DETECT_START' });
    if (!/success/i.test(out)) throw this.rejected('فحص المكان', out);
  }
  async placeCheckStatus() {
    await this.ensure();
    const r = await this.get(['signal_detect_progress', 'signal_detect_quality']);
    const step = parseInt(r.signal_detect_progress ?? '', 10);
    const q = parseInt(r.signal_detect_quality ?? '', 10);
    return {
      step: Number.isFinite(step) ? step : 0,
      quality: step === 4 && q >= 1 && q <= 4 ? q : undefined,
    };
  }
  async placeCheckCancel() {
    await this.ensure();
    await this.act({ goformId: 'SIGNAL_QUALITY_DETECT_CANCEL' }).catch(() => '');
  }

  /** إنقاذ بعد الفصل: نطلّعه من وضع الطيران ونرجّع وضع الشبكة لو بقى على وضع مؤقت (3G فقط / 5G فقط) */
  async wakeRadio() {
    await this.ensure();
    await this.act({ goformId: 'WAN_OPERATE_MODE_SET', operate_mode: 'ONLINE' }).catch(() => '');
    const cur = ((await this.get(['net_select']).catch(() => ({} as Record<string, string>))).net_select || '').trim();
    const want = this.reattachOrig && this.reattachOrig !== cur ? this.reattachOrig
      : /WCDMA|GSM/i.test(cur) && !/LTE|5G/i.test(cur) ? CODE_TO_ZTE['0803'] : '';
    if (want) await this.act({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: want }).catch(() => '');
    this.reattachOrig = '';
  }

  // ───── مركز التحكم ─────
  // ─── ZTE U30 Pro (zte/u30.ts) — يمر هنا بس لو الموديل u30Pro ───
  private async isU30(): Promise<boolean> { return (await this.identify())?.cmdSet === 'u30'; }
  private async u30BandConfig(): Promise<BandConfig> {
    const io = this.io();
    const [cur, sup] = [await u30ReadLock(io), await u30Supported(io)];
    const supported = [...new Set([...sup.lte, ...cur.lte])].sort((a, b) => a - b);
    const nrSupported = [...new Set([...sup.nr, ...cur.nr])].sort((a, b) => a - b);
    return {
      supported, locked: u30Locked(cur.lte, sup.lte),
      nrSupported, nrLocked: u30Locked(cur.nr, sup.nr), nrPreferred: nrSupported,
      mode: ZTE_TO_CODE[cur.mode] ?? (cur.mode || 'auto'),
      modes: [
        { value: '00', label: 'تلقائي' },
        { value: '0803', label: '4G + 5G' },
        { value: '03', label: '4G فقط' },
        { value: '08', label: '5G فقط (SA)' },
      ],
    };
  }
  private async u30Restore(u: U30Lock): Promise<void> {
    const io = this.io();
    const cur = await u30ReadLock(io);
    if (u.mode && u.mode !== cur.mode) await this.setNetworkMode(u.mode);
    const changed = await u30SetBands(io, u.lte.length ? u.lte : 'keep', u.nr.length ? u.nr : undefined);
    if (changed) await this.rebootAndWait();
    let left = u30Diff({ ...u, lte: u.lte.length ? u.lte : cur.lte, nr: u.nr.length ? u.nr : cur.nr }, await u30ReadLock(io));
    for (let i = 0; i < 3 && left.length; i++) {
      await sleep(1500);
      left = u30Diff({ ...u, lte: u.lte.length ? u.lte : cur.lte, nr: u.nr.length ? u.nr : cur.nr }, await u30ReadLock(io));
    }
    if (left.length) throw restoreMismatch(left);
  }
  private async u30RestoreAll(baseline: Record<string, string> | null): Promise<void> {
    const io = this.io();
    let changed = await u30UnlockAll(io).catch(e => { this.log('u30 unlock', (e as any)?.message); return false; });
    const lte = (baseline?.u30_lte || '').split(',').map(Number).filter(Boolean);
    const nr = (baseline?.u30_nr || '').split(',').map(Number).filter(Boolean);
    // الأصلي لو نعرفه، وإلا كل المدعوم ([] = الكل)
    if (await u30SetBands(io, lte, nr)) changed = true;
    const origMode = (baseline?.net_select || '').trim();
    const mode = origMode && !/^WL|WCDMA|GSM/i.test(origMode) ? origMode : CODE_TO_ZTE['0803'];
    try { await this.act({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: mode }); } catch {}
    if (changed) await this.rebootAndWait();
  }

  private io(): ZteIo {
    return { get: f => this.get(f), getRaw: f => this.getRaw(f), act: b => this.act(b) };
  }
  async getExtras() { await this.ensure(); return zteExtras(this.io()); }
  async setUpnp(on: boolean) { await this.ensure(); return zteSetUpnp(this.io(), on); }
  async setDmz(on: boolean, ip: string) { await this.ensure(); return zteSetDmz(this.io(), on, ip); }
  async setLedNight(on: boolean, start: string, end: string) { await this.ensure(); return zteSetLedNight(this.io(), on, start, end); }
  async setBandOn(band: '2.4' | '5', on: boolean) { await this.ensure(); return zteSetBandOn(this.io(), band, on); }
  async setGuest(on: boolean, offHours: number) { await this.ensure(); return zteSetGuest(this.io(), on, offHours); }
  async setUrlBlocks(list: { url: string; macs: string[] }[]) { await this.ensure(); return zteSetUrlBlocks(this.io(), list); }
  async setAutoRecover(on: boolean) { await this.ensure(); return zteSetAutoRecover(this.io(), on); }
  async setWifiNames(names: { index: string; name: string }[], password?: string) { await this.ensure(); return zteSetWifiNames(this.io(), names, password); }
  async factoryReset() { await this.ensure(); return zteFactoryReset(this.io()); }
  async setWifiSleep(mins: number) { await this.ensure(); return zteSetWifiSleep(this.io(), mins); }

  // ═══ الرسائل SMS ═══
  // tag: 0 = مقروءة، 1 = جديدة (موثّق)، 2/3 = مرسلة (حسب واجهة ZTE — يحتاج تأكيد على كل فيرموير)
  async listSms(box: 'inbox' | 'sent' = 'inbox'): Promise<SmsMessage[]> {
    await this.ensure();
    const url = this.base() + '/goform/goform_get_cmd_process?isTest=false&cmd=sms_data_total' +
      '&page=0&data_per_page=200&mem_store=1&tags=10&order_by=order+by+id+desc&_=' + Date.now();
    const res = await http(url, { headers: this.headers() });
    let j: { messages?: Record<string, string>[] } | null = null;
    try { j = JSON.parse(await res.text()); } catch { throw new Error('رد غير مفهوم من الراوتر'); }
    const msgs = Array.isArray(j?.messages) ? j!.messages! : [];
    const want = box === 'inbox' ? ['0', '1'] : ['2', '3'];
    return msgs
      .filter(m => want.includes(String(m.tag)))
      .map(m => ({
        index: String(m.id ?? ''),
        phone: String(m.number ?? ''),
        content: fromUcs2Hex(String(m.content ?? '')),
        date: zteSmsDate(String(m.date ?? '')),
        unread: String(m.tag) === '1',
      }))
      .filter(m => m.index);
  }

  async markSmsRead(index: string): Promise<void> {
    await this.ensure();
    const out = await this.act({ goformId: 'SET_MSG_READ', msg_id: index + ';', tag: '0' });
    if (!/success/i.test(out)) throw this.rejected('تعليم الرسالة كمقروءة', out);
  }

  async deleteSms(index: string): Promise<void> {
    await this.ensure();
    const out = await this.act({ goformId: 'DELETE_SMS', msg_id: index + ';', notCallback: 'true' });
    if (!/success/i.test(out)) throw this.rejected('حذف الرسالة', out);
  }

  /** بدون إعادة محاولة تلقائية — عشان ما تنرسل الرسالة مرتين */
  async sendSms(phone: string, text: string): Promise<void> {
    await this.ensure();
    const out = await this.post({
      goformId: 'SEND_SMS', notCallback: 'true', Number: phone.trim(), sms_time: zteSmsNow(),
      MessageBody: ucs2Hex(text), ID: '-1', encode_type: 'UNICODE',
    });
    if (!/success/i.test(out)) throw this.rejected('إرسال الرسالة', out);
  }

  async wifiDebug(): Promise<string> {
    await this.ensure();
    const a = await this.get([...ZteDriver.WIFI_FIELDS, ...ZteDriver.WIFI5_FIELDS, 'SSID1', 'wifi_chip1_ssid1_wifi_coverage']).catch(e => ({ err: String(e?.message ?? e) }));
    // MU5001 وغيره: القنوات في queryAccessPointInfo — نرسل شكله بدون أسماء الشبكات وكلماتها
    const ap = await this.getRaw('queryAccessPointInfo').catch(e => ({ err: String((e as any)?.message ?? e) }));
    const SECRET = /"(SSID\d*|Password|WPAPSK\d*|KeyPassphrase|PreSharedKey|WEPKey\w*|PasswordShow)"\s*:\s*"[^"]*"/gi;
    const clean = JSON.stringify(ap ?? null).replace(SECRET, '"$1":"«محذوف»"');
    // قبل: SSID1 (اسم الشبكة) كان يطلع كما هو في التقرير (تقرير U30 Pro ٢٥ أكتوبر)
    return JSON.stringify(a, null, 1).replace(SECRET, '"$1": "«محذوف»"') + '\n\nqueryAccessPointInfo: ' + clean.slice(0, 3000);
  }
}
