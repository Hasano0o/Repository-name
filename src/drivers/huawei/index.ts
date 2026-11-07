import * as Crypto from 'expo-crypto';
import { diag } from '../../services/diag';
import { huaweiEncrypt } from './rsaEnc';
import { sha256 } from '@noble/hashes/sha2';
import { hmac } from '@noble/hashes/hmac';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import {
  RouterDriver, Capability, Signal, ConnectedDevice, Usage, NetworkInfo, Traffic,
  BandConfig, SmsMessage, DeviceDetails, CellTower, CellLockTarget, CellLockState, DataPlan, ActiveLock,
  ApnProfile, DnsConfig, Carrier, SignalSnapshot, TimeRule, BandRoles } from '../types';
import { http as rawHttp } from '../http';
import { hasSesTok, tokenFromReply, isHuaweiSessionReply, cookieShape } from './session';
import { Platform } from 'react-native';
import { trafficBurst } from '../../utils/nrprobe';
import { getApnProfiles, setApn, selectApn, getDns, setDns } from './apn-dns';
import { carriersFrom } from './carriers';
import { getWifiRadios, setWifiChannel, wifiDebug } from './wifi';
import * as extras from './extras';
import * as more from './more';
import { identifyHuawei, ModelProfile } from '../models';
import { parseTxPower, parseDlMcs, parseUlMcs } from '../../utils/linkHealth';
import { buildSnapshot } from '../../utils/snapshot';
import { noChange } from '../noChange';
import { NetStandard, standardOf, standardBody } from './netStandard';
import { LockSnapshot, restoreMismatch } from '../lockSnapshot';
import { HuaweiLockData, parseNetModeFields, netModeBody, netModeDiff, lockDiffForMode, lockRestoreBody, huaweiSummary } from './lockState';
import { buildCellLockBody, buildUnlockBody, lockMatches, parseCellLocks, parseLockRaw, LockRaw, Tech as CellTech, bandLockSection, buildChannelLockBody, channelMatches, lockKindOf } from './cellLock';

/**
 * شكل رد challenge_login للتشخيص — أسماء الخانات وأطوالها، والأرقام الصغيرة (iterations…) بقيمها.
 * ما فيه أسرار: الملح والـ nonce بطولها بس. «nonce✓» = servernonce يبدأ بالـ firstnonce حقنا.
 * (٢ نوفمبر: رد ٣٣٨ حرف ينجح و٣٤٣ يرد 108006 بنفس الكلمة — نبي نعرف وش الفرق)
 */
export function challengeShape(xml: string, firstNonce: string): string {
  const body = (xml.match(/<response>([\s\S]*)<\/response>/) ?? [, xml])[1] ?? '';
  const parts: string[] = [];
  for (const m of body.matchAll(/<([A-Za-z_][\w-]*)>([^<]*)<\/\1>/g)) {
    const v = m[2].trim();
    parts.push(/^\d{1,5}$/.test(v) ? `${m[1]}=${v}` : `${m[1]}:${v.length}`);
  }
  const sn = (body.match(/<servernonce>([^<]*)</) ?? [])[1] ?? '';
  const ent = (sn.match(/&[#\w]+;/g) ?? []).length;
  return `${parts.join(' ') || 'فاضي'} · nonce${sn.startsWith(firstNonce) ? '✓' : '✗'}${ent ? ` · رموز مرمّزة ${ent}` : ''} · ${xml.length}`;
}

const tag = (xml: string, t: string) =>
  xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1];
const tagsAll = (xml: string, t: string) =>
  [...xml.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'g'))].map(m => m[1]);
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s = '') =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
const sha256Hex = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));
const num = (v?: string) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : undefined;
};
const ALL_LTE = '7FFFFFFFFFFFFFFF';
/**
 * راوترات (العنوان) اللي تأكدنا إن net-mode فيها ما يثبّت تردد 4G معيّن (WebUI 4.0 بدون lock-freq):
 * الراوتر يرجّع LTEBand = كل ترددات FDD/TDD مهما طلبنا. ما نعيد التجربة كل ضغطة (تقرير ٢٧ أكتوبر).
 */
const netModeBandDead = new Set<string>();
/** روابط صفحة «تحديد النطاق» (وضع المطوّر) — تحتاج جلسة loginflag=2 في الفيرموير الجديدة */
const DEV_ONLY = /^net\/(lock-freq|celllock)/;

function parseDataLimit(v?: string): number {
  if (!v) return 0;
  const m = v.trim().match(/^([\d.]+)\s*([KMGT]?B)?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] ?? 'MB').toUpperCase();
  const mult: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
  return Math.round(n * (mult[unit] ?? 1e6));
}
function formatDataLimit(bytes: number): string {
  if (bytes <= 0) return '0MB';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(bytes % 1e9 === 0 ? 0 : 2) + 'GB';
  return Math.round(bytes / 1e6) + 'MB';
}
function arfcnOf(v?: string): string {
  if (!v) return '';
  const dl = v.match(/DL[:\s]*(\d+)/i);
  if (dl) return dl[1];
  const n = v.match(/\d+/);
  return n ? n[0] : '';
}
const DEFAULT_NR_BANDS = [1, 3, 5, 20, 28, 40, 41, 77, 78, 79];

function big(hex: string): bigint {
  try { return BigInt('0x' + hex.trim().replace(/^0x/i, '')); } catch { return 0n; }
}
function bandsFromMask(mask: bigint): number[] {
  const out: number[] = [];
  let m = mask;
  let i = 0;
  while (m > 0n && i < 128) {
    if (m & 1n) out.push(i + 1);
    m >>= 1n;
    i++;
  }
  return out;
}
function maskFromBands(bands: number[]): string {
  let m = 0n;
  for (const b of bands) if (b > 0) m |= 1n << BigInt(b - 1);
  return m.toString(16).toUpperCase();
}

const MODE_NAMES: Record<string, string> = { '01': '2G', '02': '3G', '03': '4G', '08': '5G' };
function modeLabel(v: string): string {
  if (v === '00') return 'تلقائي';
  const parts = v.match(/../g) ?? [v];
  return parts.map(p => MODE_NAMES[p] ?? p).join(' + ');
}

const NET_TYPES: Record<string, string> = {
  // 4G LTE
  '19': '4G LTE', '101': '4G LTE',
  // 4G+ (CA نشط)
  '1011': '4G+',
  // 4G+ مع 5G NSA (بعض فيرمويرات H138/H155)
  '1111': '4G+', '1112': '4G+',
  // 5G NSA
  '111': '5G NSA',
  // 5G SA
  '112': '5G SA',
  // 5G NSA + 4G CA
  '1021': '5G NSA', '1022': '5G SA',
  // قديم
  '2': '2G', '3': '3G', '4': '3G+', '41': '3G+',
};

const ERRORS: Record<string, string> = {
  '-1': 'الراوتر رفض الطلب',
  '100002': 'الراوتر ما يدعم هذي الخاصية',
  '100003': 'ما عندك صلاحية — سجل دخول',
  '100005': 'الراوتر رفض الإعداد',
  '108001': 'اسم المستخدم غير صحيح',
  '108002': 'كلمة المرور غير صحيحة',
  '108003': 'فيه مستخدم ثاني داخل حالياً',
  '108006': 'اسم المستخدم أو كلمة المرور غلط',
  '108007': 'محاولات كثيرة، انتظر شوي وحاول',
  '112003': 'الترددات المختارة غير مدعومة',
  '113018': 'ذاكرة الرسائل ممتلئة',
  '125002': 'انتهت الجلسة',
  '125003': 'رمز الجلسة غير صالح',
};

export class HuaweiError extends Error {
  constructor(public code: string, msg?: string) {
    super(msg ?? (ERRORS[code] ? `${ERRORS[code]} (${code})` : `خطأ من الراوتر (${code})`));
  }
}

/**
 * ═══ بوابة الدخول المشتركة (٢ نوفمبر — «كلمة غلط» و«محاولات كثيرة» عند الكل، آيفون وأندرويد) ═══
 * كل شاشة/مهمة تسوي نسخة درايفر لحالها (registry: new HuaweiDriver كل مرة): إضافة الراوتر + الرئيسية + المراقبة
 * بالخلفية ممكن يسجلون دخول لنفس الراوتر بنفس اللحظة. في الأندرويد جرة الكوكيز وحدة للكل ← التحدي على جلسة
 * والتحقق على جلسة ثانية ← 108006 بالكلمة الصحيحة، ومع كم محاولة 108007 (قفل). الحل:
 *  ١. دخول واحد بالمرة لكل راوتر — لكل النسخ (gate).
 *  ٢. نجاح قريب بنفس الكلمة (جرة مشتركة بس) ← النسخ الثانية ما تعيد الدخول (okAt).
 *  ٣. الراوتر قافل (108007 أو state-login يقول) ← ما نرسل أي محاولة لين ينتهي (lockUntil) — المحاولات تمدّد القفل.
 *  ٤. كلمة محفوظة رفضها الراوتر (108006) ← المهام الخلفية ما تعيدها نص ساعة (badPw) — هذي كانت تحرق المحاولات.
 * القيم في الذاكرة بس (ما تنحفظ).
 */
const gate = new Map<string, Promise<unknown>>();
const okAt = new Map<string, { key: string; at: number }>();
/**
 * راوترات دخلناها بالأندرويد بالكوكي اليدوي (جرة النظام ترفض كل رمز) — النسخ الجديدة للدرايفر تبدأ فيه على طول.
 * تقارير ٧ نوفمبر (H168-383 / 5G CPE Ultra 6 وغيره، سامسونج/شاومي/هونر/POCO): كل رمز 125003 — من token ومن SesTokInfo،
 * قبل وبعد Update-Cookie — يعني الكوكي اللي ترسله جرة أندرويد (CookieManager) مو كوكي الجلسة اللي طلع منها الرمز.
 */
const manualHosts = new Set<string>();
const lockUntil = new Map<string, number>();
const badPw = new Map<string, { key: string; at: number }>();
const OK_REUSE_MS = 15_000;
const BAD_PW_MS = 30 * 60_000;
const LOCK_DEFAULT_MS = 5 * 60_000;
const mins = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
function lockedError(host: string): HuaweiError {
  const left = (lockUntil.get(host) ?? 0) - Date.now();
  return new HuaweiError('108007',
    `الراوتر قافل الدخول مؤقتاً بسبب محاولات سابقة (108007). انتظر ${mins(left)} دقيقة وجرّب مرة وحدة بس — كل محاولة وهو قافل تمدّد القفل. لو صفحة الراوتر أو تطبيق هواوي مفتوح في جهاز ثاني، سكّره.`);
}
/** للاختبارات بس */
export function _resetHuaweiGate() { gate.clear(); okAt.clear(); lockUntil.clear(); badPw.clear(); manualHosts.clear(); }
/**
 * راوتر ثاني على 192.168.8.1 يرجّع صفحته (HTML) لأي رابط بـ 200 — كنا نحسب الدخول «نجح» والقراءات فاضية
 * (ملف FULL ٣١ أكتوبر ١٢:٣٧: كل /api/* ← 1027 بايت index.html، صفحة layui/jQuery مو هواوي)
 */
function notHuaweiPage(body: string) {
  if (/^\s*(<!doctype\s+html|<html)/i.test(body)) {
    throw new Error('الراوتر رد بصفحة بدل رد هواوي — غالباً مو راوتر هواوي. احذفه وأضفه من جديد، ولو ما انعرف استخدم «مو مدعوم؟»');
  }
}

const isTokenError = (e: unknown) =>
  e instanceof HuaweiError && (e.code === '125002' || e.code === '125003');

/** روابط موجودة في كل راوترات هواوي — لو ردّت 100003 فالجلسة فعلاً راحت */
const CORE_GET = /^(device\/signal|monitoring\/status|device\/information|net\/net-mode)$/;
/** أوامر حفظ بطيئة (المودم يعيد الاتصال وهو يطبّقها) — مهلتها أطول */
const SLOW_POST = /^net\/(lock-freq|net-mode)$/;

export class HuaweiDriver implements RouterDriver {
  id = 'huawei-lte';
  // بعض الموديلات (H138/H155/H165) 5G-capable — نكشفها ديناميكياً
  name = 'Huawei LTE/5G';
  capabilities: Capability[] = ['signal', 'devices', 'reboot', 'bandLock', 'sms', 'usage', 'block', 'traffic', 'cells'];
  private host = '';
  /**
   * أصل الصفحة الفعلي لو الراوتر يحوّل (H112-370 من Three: http://192.168.8.1 ← https://hirouter.net).
   * بدونه: الدخول ينجح على hirouter.net والقراءات تروح لـ 192.168.8.1 بدون كوكي الجلسة ← 100003 «الراوتر يطلّع التطبيق».
   * فاضي = http://<العنوان> مثل قبل (باقي الموديلات ما يتغيّر عليها شي).
   */
  private origin = '';
  private base() { return this.origin || `http://${this.host}`; }
  /** نقرأ home.html ونشوف وين انتهى التحويل — لو https أو اسم ثاني نمشي عليه */
  private async homePage(host: string): Promise<void> {
    const r = await this.http(`${this.origin || `http://${host}`}/html/home.html`, { headers: this.headers() });
    await r.text();
    try {
      const u = new URL(r.url);
      if (u.host && (u.protocol === 'https:' || u.host !== host) && /^https?:$/.test(u.protocol)) {
        const o = `${u.protocol}//${u.host}`;
        if (o !== this.origin) { this.origin = o; diag(`[huawei] الراوتر يحوّل صفحته ← ${o} — نكمّل عليه`); }
      }
    } catch {}
  }
  private queue: string[] = [];
  private allLte = ALL_LTE;
  private lockFreq: boolean | null = null;
  /** net/lock-freq يرد 100003 والجلسة شغالة = الموديل ما يدعمه (H158 مثلاً) — نتوقف عن استدعائه */
  private lockFreqDead = false;
  /**
   * فيرموير هواوي الجديدة (H155/H158 Vue …): صفحة «تحديد النطاق» (lockband) مخفية في وضع المطوّر —
   * تظهر لما developer/developermode-featureswitch يقول lockband_enable=1، حتى لو net-feature-switch
   * يقول lock_freq_switch=0. وصفحة المطوّر تدخل بـ SCRAM مع loginflag=2 (main.js). كنا نشوف 0 ونروح
   * لـ net-mode اللي ما يثبّت تردد معيّن في هالفيرموير ← «جرّبناه وما طبّقه» على كل تردد (تقارير ٢٧ أكتوبر).
   */
  private devLockband: boolean | null = null;
  private devTried = false;
  private creds: { u: string; p: string } | null = null;
  private async devLockbandOn(): Promise<boolean> {
    if (this.devLockband !== null) return this.devLockband;
    try {
      const x = await this.get('developer/developermode-featureswitch', false);
      this.devLockband = tag(x, 'lockband_enable') === '1';
    } catch { this.devLockband = false; }
    return this.devLockband;
  }
  /** دخول جلسة المطوّر (نفس الكلمة + loginflag=2) — مرة وحدة بس، ولو فشل نرجع للجلسة العادية */
  private async devRelogin(): Promise<boolean> {
    if (this.devTried || !this.creds || this.scram === false || !(await this.devLockbandOn())) return false;
    this.devTried = true;
    const { u, p } = this.creds;
    this.log('lock-freq 100003 — retrying with developer-mode login (loginflag=2)');
    try { await this.post('user/logout', '<Logout>1</Logout>', undefined, false); } catch {}
    this.queue = [];
    try { await this.homePage(this.host); } catch {}
    if (this.manualCookie) { try { await this.sesTok(); } catch {} }
    try {
      await this.loginScram(u, p, true);
      return true;
    } catch (e) {
      this.log('developer login failed:', (e as any)?.message ?? String(e));
      this.queue = [];
      try { await this.loginScram(u, p); } catch {}
      return false;
    }
  }
  private async lockFreqUnsupported(e: unknown): Promise<boolean> {
    if (!(e instanceof HuaweiError) || e.code !== '100003') return false;
    try { await this.get('net/net-mode'); } catch { return false; }
    this.lockFreqDead = true;
    this.lockFreq = false;
    return true;
  }
  private cellLockMode: string | null = null;
  private nr5g: boolean | undefined | null = null; // null = ما فحصنا بعد
  /** الراوتر رد «ما عندك صلاحية» — ما نصدّق state-login (يقول داخل وهو طاردنا) */
  private stale = false;
  private reattachOrig = '';
  /** null = ما جرّبنا · true = الراوتر يدعم SCRAM · false = ما يدعمه */
  private scram: boolean | null = null;
  /**
   * الكوكي يدوي على الآيفون: جرة كوكيز iOS مع طلبات متوازية بعد انتهاء الجلسة كانت تخلط SessionID
   * فيرفض الراوتر الرمز (125003) والدخول — والنتيجة «الراوتر يطلّع التطبيق». هنا نمسك SessionID بأنفسنا.
   * لو ما قدرنا (الراوتر ما يرسل SesInfo) نرجع لجرة النظام.
   */
  private manualCookie = Platform.OS === 'ios';
  private cookie = '';
  private takeCookie(r: Response) {
    const sc = r.headers.get('set-cookie') || '';
    const m = sc.match(/SessionID=([^;,\s]+)/);
    if (m) this.cookie = `SessionID=${m[1]}`;
  }
  /**
   * بعض الموديلات (H122-373 / 5G CPE Pro 2 — ملفات FULL ٣١ أكتوبر) ما تتحمل ٨–١٠ طلبات مع بعض بعد الدخول:
   * كلها تعلق ٨ ث وتنقطع («تعذر الاتصال بالراوتر (GET /api/device/signal)») وبعضها يرجع بعد ٣–٧ ث.
   * أول ما يصير هالشي (مهلة وفيه ٣ طلبات أو أكثر شغالة) نحوّل هالراوتر لطلب واحد بالمرة — الباقي ما يتأثر.
   */
  private inflight = 0;
  private serial = false;
  private chain: Promise<unknown> = Promise.resolve();
  private async http(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<Response> {
    if (this.serial) {
      const run = this.chain.then(() => this.http1(url, init, timeoutMs ?? 15_000), () => this.http1(url, init, timeoutMs ?? 15_000));
      // الطلب الجاي يبدأ بعد ما يرد هذا (الرأس) — ما نلمس جسم الرد عشان يقراه صاحبه
      this.chain = run.then(() => undefined, () => undefined);
      return run;
    }
    this.inflight++;
    const many = this.inflight >= 3;
    try {
      return await this.http1(url, init, timeoutMs);
    } catch (e) {
      if (many && /ما رد|timeout|انتهت المهلة/i.test(String((e as any)?.message ?? e))) {
        this.serial = true;
        diag('[huawei] الراوتر ما يتحمل طلبات متوازية — نكمّل طلب واحد بالمرة');
      }
      throw e;
    } finally {
      this.inflight--;
    }
  }
  private async http1(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<Response> {
    if (!this.manualCookie) { const r0 = await rawHttp(url, init, timeoutMs); this.noteCookie(r0); return r0; }
    const headers = { ...(init.headers as Record<string, string> | undefined), ...(this.cookie ? { Cookie: this.cookie } : {}) };
    // credentials: 'omit' ← أندرويد يشيل جرة الكوكيز من الطلب (CookieJar.NO_COOKIES) فما تغطي على ترويسة Cookie حقتنا
    const r = await rawHttp(url, { ...init, headers, credentials: 'omit' } as RequestInit, timeoutMs);
    this.noteCookie(r);
    this.takeCookie(r);
    return r;
  }
  /** شكل set-cookie (الأسماء والخصائص، بدون القيمة) مرة لكل دخول — نعرف منه ليش الجرة ما تمسكه */
  private cookieNoted = false;
  private noteCookie(r: Response) {
    if (this.cookieNoted) return;
    let sc = '';
    try { sc = r.headers?.get?.('set-cookie') || ''; } catch {}
    if (!sc) return;
    this.cookieNoted = true;
    diag(`[huawei] set-cookie: ${cookieShape(sc)} · ${this.manualCookie ? 'يدوي' : 'جرة النظام'}`);
  }
  /** جلسة جديدة من الراوتر: SesInfo = الكوكي، TokInfo = الرمز */
  private async sesTok(): Promise<string> {
    this.cookie = '';
    const r = await this.http(this.url('webserver/SesTokInfo'), { headers: this.headers() });
    const x = await r.text();
    const ses = tag(x, 'SesInfo') ?? '';
    const m = ses.match(/SessionID=([^;,\s]+)/);
    if (m) this.cookie = `SessionID=${m[1]}`;
    // H155-383 (فيرموير Vue ٢٠٢٥): ما فيه SesTokInfo — الكوكي يجي من رأس set-cookie والرمز من webserver/token
    if (!hasSesTok(x)) {
      try {
        const t = await this.http(this.url('webserver/token'), { headers: this.headers() });
        const tok = tokenFromReply(await t.text());
        if (!this.cookie) this.manualCookie = false;
        return tok;
      } catch {}
    }
    if (!m && !this.cookie) this.manualCookie = false;
    return tag(x, 'TokInfo') ?? '';
  }
  /** الراوتر يرد؟ (بعد إعادة اتصال/تشغيل) — SesTokInfo أو webserver/token للفيرموير الجديدة */
  private async answers(): Promise<boolean> {
    try { if (isHuaweiSessionReply(await (await rawHttp(this.url('webserver/SesTokInfo'), {}, 3000)).text())) return true; } catch {}
    try { if (isHuaweiSessionReply(await (await rawHttp(this.url('webserver/token'), {}, 3000)).text())) return true; } catch {}
    return false;
  }

  private log(...a: unknown[]) {
    if (__DEV__) console.log('[huawei]', ...a);
  }
  private url(p: string) {
    return `${this.base()}/api/${p}`;
  }
  private headers(extra: Record<string, string> = {}) {
    return {
      'X-Requested-With': 'XMLHttpRequest',
      // صفحة الراوتر نفسها (WebUI 4.0 في H158 وغيره) ترسل هالترويسة مع كل طلب — بالإملاء هذا («Broswer»).
      // بدونها الجلسة ما تشوف قفل الترددات (net/lock-freq يرد فاضي) والكتابة ترفض.
      // تأكدنا منها من طلب الحفظ الفعلي لصفحة «تحديد النطاق» على H158-381 (أكتوبر 2026).
      _ResponseSource: 'Broswer',
      Referer: `${this.base()}/html/home.html`,
      ...extra,
    };
  }
  private captureTokens(r: Response) {
    const one = r.headers.get('__requestverificationtokenone');
    const two = r.headers.get('__requestverificationtokentwo');
    const single = r.headers.get('__requestverificationtoken');
    if (one) this.queue = two ? [one, two] : [one];
    else if (single) this.queue = single.split('#').filter(Boolean);
  }
  private async freshToken(viaSes = false): Promise<string> {
    // الآيفون (الكوكي يدوي): webserver/token يغيّر SessionID بترويسة set-cookie ما نقدر نقراها في iOS ← الرمز ما يطابق
    // كوكينا ← 125003 على challenge_login، وبعدها الدخول القديم يرد 108006 (كلمة غلط) ← الراوتر يقفل الدخول.
    // تقارير ٣١ أكتوبر (آيفون): «token → challenge 125003» يتكرر، و«SesTokInfo → challenge» ينجح.
    // فعلى الآيفون نجيب الرمز من SesTokInfo ونمسك SessionID اللي معه (الاثنين مع بعض)
    if (this.manualCookie) viaSes = true;
    if (!viaSes) try {
      const r = await this.http(this.url('webserver/token'), { headers: this.headers() });
      const t = tokenFromReply(await r.text());
      if (t) return t;
    } catch {}
    const r = await this.http(this.url('webserver/SesTokInfo'), { headers: this.headers() });
    const x = await r.text();
    if (hasSesTok(x)) {
      if (this.manualCookie) { const m = (tag(x, 'SesInfo') ?? '').match(/SessionID=([^;,\s]+)/); if (m) this.cookie = `SessionID=${m[1]}`; }
      return tag(x, 'TokInfo') ?? '';
    }
    // H155-383: ما فيه SesTokInfo — نرجع لـ webserver/token (حتى لو طُلب viaSes)
    const t = await this.http(this.url('webserver/token'), { headers: this.headers() });
    return tokenFromReply(await t.text());
  }
  private async get(p: string, retry = true): Promise<string> {
    const r = await this.http(this.url(p), { headers: this.headers() });
    const xml = await r.text();
    notHuaweiPage(xml);
    if (xml.includes('<error>')) {
      const code = tag(xml, 'code') ?? '0';
      this.log('GET', p, 'error', code);
      // صفحة «تحديد النطاق» في وضع المطوّر: الجلسة العادية ترد 100003 — ندخل بجلسة المطوّر ونعيد مرة
      if (retry && code === '100003' && DEV_ONLY.test(p) && await this.devRelogin()) return this.get(p, false);
      // 100003 على رابط أساسي = انطردنا. على رابط اختياري (مثل net/lock-freq في H158) = غير مدعوم — مو طرد
      if (code === '100003' && CORE_GET.test(p)) this.stale = true;
      throw new HuaweiError(code);
    }
    return xml;
  }
  /** مفتاح التشفير العام للراوتر (للطلبات «;enc») */
  private rsaKey: { n: string; e: string } | null = null;
  private async encKey() {
    if (this.rsaKey) return this.rsaKey;
    const x = await this.get('webserver/publickey');
    const n = tag(x, 'encpubkeyn') ?? '', e = tag(x, 'encpubkeye') ?? '';
    if (!/^[0-9a-f]{128,}$/i.test(n) || !/^[0-9a-f]+$/i.test(e)) throw new HuaweiError('9003');
    this.rsaKey = { n, e };
    return this.rsaKey;
  }
  private async post(p: string, body: string, token?: string, retry = true, enc = false): Promise<string> {
    const tok = token ?? (this.queue.shift() || await this.freshToken());
    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?><request>${body}</request>`;
    let payload = xmlBody;
    if (enc) {
      const k = await this.encKey();
      payload = huaweiEncrypt(xmlBody, k.n, k.e, n => Crypto.getRandomBytes(n));
    }
    // net/lock-freq و net/net-mode ياخذون لين ٧٫٥ ث في H155/H158 5G (المودم يعيد الاتصال وهو يحفظ) —
    // مهلة ٨ ث كانت تقطعهم ونحسبها «رفض» ونرجّع والراوتر لسا يطبّق (تقرير ٢٥ أكتوبر)
    const r = await this.http(this.url(p), {
      method: 'POST',
      headers: this.headers({
        // «;enc» = نفس صفحة الراوتر لما تشفّر (إعدادات الواي فاي في الموديلات الجديدة)
        'Content-Type': enc ? 'application/x-www-form-urlencoded; charset=UTF-8;enc' : 'application/x-www-form-urlencoded; charset=UTF-8',
        __RequestVerificationToken: tok,
      }),
      body: payload,
    }, SLOW_POST.test(p) ? 25_000 : undefined);
    this.captureTokens(r);
    const xml = await r.text();
    notHuaweiPage(xml);
    if (xml.includes('<error>')) {
      const code = tag(xml, 'code') ?? '0';
      this.log('POST', p, 'error', code);
      if (retry && !token && (code === '125002' || code === '125003')) {
        this.queue = [];
        return this.post(p, body, undefined, false, enc);
      }
      // المحاولة الثانية بعد بعد رفض الرمز: بعد ما الراوتر يعيد الاتصال (تغيير الترددات) webserver/token
      // يعطي رمز قديم — نجيبه من SesTokInfo (نفس اللي يسويه الدخول) ونجرّب مرة أخيرة
      if (!retry && !token && (code === '125002' || code === '125003')) {
        this.queue = [];
        await new Promise(r => setTimeout(r, 1200));
        // بعد أمر ما وصلنا رده، الراوتر ممكن غيّر SessionID في الرد اللي ضاع — الرموز بعدها كلها 125003
        // لين نقرأ صفحة تجدد الكوكي (state-login يرسله). هذا اللي خلّى الأمر ينقبل بعد «الدخول» في التقرير
        if (this.manualCookie) { try { await this.http(this.url('user/state-login'), { headers: this.headers() }).then(x => x.text()); } catch {} }
        return this.post(p, body, await this.freshToken(true), false, enc);
      }
      // الموديلات الجديدة (H158-381 / 5G CPE Pro 5) ترفض كتابة الواي فاي بدون تشفير: 9003 / 100005
      if (!enc && /^wlan\//.test(p) && (code === '9003' || code === '100005')) {
        this.log('POST', p, 'needs encryption — retrying with ;enc');
        return this.post(p, body, undefined, true, true);
      }
      if (retry && !enc && code === '100003' && DEV_ONLY.test(p) && await this.devRelogin()) {
        return this.post(p, body, undefined, false, enc);
      }
      // POST: ما نعلّم الجلسة خربانة هنا — 100003 على أمر حفظ غالباً «غير مدعوم» (مثل net/lock-freq في H158)
      const err = new HuaweiError(code);
      // في التقارير يبان إن المحاولة المشفّرة نفسها انرفضت (مو بس العادية)
      if (enc) err.code = `${code}·مشفّر`;
      throw err;
    }
    return xml;
  }
  async detect(host: string) {
    try {
      const r = await rawHttp(`http://${host}/api/webserver/SesTokInfo`, {}, 3000);
      if (hasSesTok(await r.text())) return true;
    } catch {}
    // فيرموير Vue ٢٠٢٥ (H155-383 — «مو مدعوم» ٢٧ أكتوبر): SesTokInfo مشال، والصفحة تاخذ الرمز من webserver/token
    const t = await rawHttp(`http://${host}/api/webserver/token`, {}, 3000);
    return isHuaweiSessionReply(await t.text());
  }
  /**
   * دخول وحد بالمرة، وما نعيده لو نجح قبل ثواني بنفس الكلمة.
   * تقارير «أرسل الخطأ للمطوّر» (آيفون، ٢ نوفمبر): الدخول ينجح ← وخلال نص ثانية دخولين ثانيين على نفس الدرايفر،
   * الوسطاني 108006 («كلمة غلط» وهي صحيحة) — يزيد عدّاد المحاولات لين القفل 108007.
   * والدخولين مع بعض يتشاركون الكوكي (الآيفون: this.cookie واحد) ← تحدي جلسة وتحقق جلسة ثانية ← 108006.
   */
  private lastOk: { key: string; at: number } | null = null;
  private loginRun: { key: string; p: Promise<void> } | null = null;
  async login(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    const key = `${host}\u0000${username}\u0000${password}`;
    // نفس النسخة: دخول شغال بنفس الكلمة ← ننتظره
    if (this.loginRun?.key === key) {
      diag('[huawei] فيه دخول شغال بنفس الكلمة — ننتظره بدل دخول ثاني');
      return this.loginRun.p;
    }
    if (!opts?.fresh && !this.stale && this.lastOk?.key === key && Date.now() - this.lastOk.at < OK_REUSE_MS) {
      diag('[huawei] دخلنا قبل ثواني بنفس الكلمة — ما نعيد الدخول');
      return;
    }
    const p = this.gated(host, username, password, key, opts);
    this.loginRun = { key, p };
    try {
      await p;
      this.lastOk = { key, at: Date.now() };
    } catch (e) {
      this.lastOk = null;
      throw e;
    } finally {
      if (this.loginRun?.p === p) this.loginRun = null;
    }
  }
  /** البوابة المشتركة لكل نسخ الدرايفر (فوق) */
  private async gated(host: string, username: string, password: string, key: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    if ((lockUntil.get(host) ?? 0) > Date.now()) {
      diag('[huawei] الراوتر قافل الدخول — ما نرسل محاولة');
      throw lockedError(host);
    }
    const bad = badPw.get(host);
    if (!opts?.fresh && bad?.key === key && Date.now() - bad.at < BAD_PW_MS) {
      diag('[huawei] الكلمة المحفوظة انرفضت قبل شوي — ما نعيدها (ما نحرق محاولات)');
      throw new HuaweiError('108006', 'الراوتر رفض كلمة المرور المحفوظة (108006). عدّلها من إعدادات الراوتر في التطبيق — ما نعيد المحاولة لحالنا عشان الراوتر ما يقفل.');
    }
    const prev = gate.get(host) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>(r => { release = r; });
    const chain = prev.then(() => mine, () => mine);
    gate.set(host, chain);
    try {
      await prev.catch(() => {});
      // نسخة ثانية دخلت للتو بنفس الكلمة (جرة الكوكيز المشتركة) ← الجلسة جاهزة، ما نعيد
      const ok = okAt.get(host);
      // الكوكي اليدوي (الآيفون، أو أندرويد بعد ما رفضت جرته) = جلسة لكل نسخة — ما فيه جلسة مشتركة نستخدمها
      if (!this.manualCookie && !manualHosts.has(host) && !this.stale && ok?.key === key && Date.now() - ok.at < OK_REUSE_MS) {
        diag('[huawei] نسخة ثانية دخلت للتو بنفس الكلمة — نستخدم نفس الجلسة');
        if (this.host !== host) this.origin = '';
        this.host = host;
        this.creds = { u: username, p: password };
        return;
      }
      if ((lockUntil.get(host) ?? 0) > Date.now()) throw lockedError(host);
      try {
        await this.loginOnce(host, username, password, opts);
      } catch (e) {
        if (e instanceof HuaweiError && e.code === '108007') {
          if ((lockUntil.get(host) ?? 0) <= Date.now()) lockUntil.set(host, Date.now() + LOCK_DEFAULT_MS);
          throw lockedError(host);
        }
        if (e instanceof HuaweiError && e.code === '108006') badPw.set(host, { key, at: Date.now() });
        throw e;
      }
      okAt.set(host, { key, at: Date.now() });
      badPw.delete(host);
      lockUntil.delete(host);
    } finally {
      release();
      if (gate.get(host) === chain) gate.delete(host);
    }
  }
  /** switched: بدّلنا طريقة الكوكي مرة (يدوي ↔ جرة النظام) في هالدخول — ما نبدّل مرة ثانية (ما نلف) */
  private async loginOnce(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }, switched = false): Promise<void> {
    if (!switched) {
      this.cookieNoted = false;
      if (Platform.OS === 'android' && manualHosts.has(host) && !this.manualCookie) { this.manualCookie = true; this.cookie = ''; }
    }
    if (this.host !== host) this.origin = '';
    this.host = host;
    this.queue = [];
    this.creds = { u: username, p: password };
    this.devTried = false;
    try { await this.homePage(host); } catch {}
    // H112-370 على الآيفون (add-login ٣١ أكتوبر): state-login ينقطع («تعذر الاتصال») مرة وينجح مرة —
    // الصفحة اللي قبله صارت تنقرى كاملة (فوق)، ولو انقطع نعيده مرة بعد ثانية. ما يغيّر شي للي يرد من أول مرة
    const getState = async (): Promise<string> => {
      try {
        return await this.get('user/state-login');
      } catch (e) {
        if (!/تعذر الاتصال/.test(String((e as any)?.message ?? e))) throw e;
        diag('[huawei] state-login انقطع — نعيده مرة');
        await new Promise(r => setTimeout(r, 1000));
        return await this.get('user/state-login');
      }
    };
    let state: string;
    try {
      state = await getState();
    } catch (e) {
      // H112-370 على الآيفون (١ نوفمبر): التحويل لـ https://hirouter.net يفشل — iOS (ATS) ما يسمح بشهادة ذاتية لاسم
      // مو محلي، حتى مع قبولنا لها. نفس الصفحة على https://<العنوان> مسموحة (العناوين المحلية مستثناة) ← نجرّبها مرة.
      // يصير بس بعد خطأ تشفير — الراوترات اللي تشتغل ما يتغيّر عليها شي.
      const httpsIp = `https://${host}`;
      if (!/مشفّر/.test(String((e as any)?.message ?? e)) || this.origin === httpsIp) throw e;
      diag('[huawei] https بالاسم انرفض — نجرّب https على العنوان مباشرة');
      this.origin = httpsIp;
      state = await getState();
    }
    // الراوتر نفسه يقول إنه قافل (بعض الفيرموير: lockstatus / remainwaittime بالثواني) ← ما نرسل الكلمة أبد
    const waitS = parseInt(tag(state, 'remainwaittime') ?? '0', 10);
    if (tag(state, 'lockstatus') === '1' || waitS > 0) {
      lockUntil.set(host, Date.now() + (waitS > 0 ? waitS * 1000 : LOCK_DEFAULT_MS));
      diag(`[huawei] state-login: الدخول مقفول (باقي ${waitS || '؟'} ث) — ما نرسل الكلمة`);
      throw new HuaweiError('108007');
    }
    const type = tag(state, 'password_type');
    this.log('state', tag(state, 'State'), 'password_type', type);
    // H122 (5G CPE Pro 2) وغيره: wifipwdsamewithwebpwd=1 ← كلمة دخول الراوتر هي نفسها كلمة الواي فاي،
    // مو الكلمة المطبوعة تحت IP. فلو رفض الكلمة نقول للمستخدم يجرّب كلمة الواي فاي
    const samePwd = tag(state, 'wifipwdsamewithwebpwd') === '1';
    // H155-383 (5G CPE 5) وغيره: accounts_number=2 ← حسابين، وصفحة الراوتر تعرض خانة اسم المستخدم بدل admin الثابت.
    // التحدي ينجح حتى باسم غلط (هواوي ما يكشف الأسماء) وبعدها 108006 — تقارير الآيفون ٦ نوفمبر: التحدي سليم والكوكي ثابت
    const twoAccounts = tag(state, 'accounts_number') === '2';
    try {
      await this.loginWith(host, type, state, username, password, opts);
      if (Platform.OS === 'android' && this.manualCookie) manualHosts.add(host);
      return;
    } catch (e) {
      // الآيفون: كل طلب يرد 125003 (الرمز من SesTokInfo مع SessionID اللي معه) — H112-370 تقرير add-login ٣١ أكتوبر:
      // challenge_login و user/login كلها 125003 ×٨. الكوكي اليدوي ما ينفع مع هالراوتر ← نعيد الدخول مرة بجرة كوكيز النظام
      // (نفس رجوع net-mode تحت). يصير بس بعد ما تفشل كل محاولات الرمز — اللي يدخل من أول ما يتغيّر عليه شي.
      // 125003 مو محاولة كلمة غلط، فما يقرّب الراوتر من قفل الدخول.
      if (!switched && this.manualCookie && isTokenError(e)) {
        diag('[huawei] الكوكي اليدوي: الرمز ينرفض (125003) — نعيد الدخول بجرة كوكيز النظام');
        this.manualCookie = false;
        manualHosts.delete(host);
        this.cookie = '';
        this.queue = [];
        this.stale = true;
        return this.loginOnce(host, username, password, opts, true);
      }
      // الأندرويد بالعكس: جرة النظام ترفض كل رمز (125003 من أول طلب لين آخر محاولة — تقارير ٧ نوفمبر) ←
      // نمسك SessionID بأنفسنا من set-cookie / SesInfo ونرسله بترويسة Cookie (نفس طريقة الآيفون الناجحة).
      // يصير بس بعد ما تفشل كل محاولات الرمز. 125003 مو محاولة كلمة غلط — ما يقرّب من القفل.
      if (!switched && !this.manualCookie && Platform.OS === 'android' && isTokenError(e)) {
        diag('[huawei] أندرويد: جرة الكوكيز ترفض كل رمز (125003) — نعيد الدخول بالكوكي اليدوي');
        this.manualCookie = true;
        this.cookie = '';
        this.queue = [];
        this.stale = true;
        return this.loginOnce(host, username, password, opts, true);
      }
      if (samePwd && e instanceof HuaweiError && /^10800[126]$/.test(e.code)) {
        e.message = `الراوتر رفض الكلمة (${e.code}). في هذا الجهاز كلمة الدخول هي نفسها كلمة الواي فاي — جرّب كلمة الواي فاي (اللي تتصل فيها بالشبكة)`;
      } else if (twoAccounts && e instanceof HuaweiError && /^10800[126]$/.test(e.code)) {
        diag('[huawei] الراوتر فيه حسابين (accounts_number=2) — اسم المستخدم ممكن مو admin');
        e.message = `الراوتر رفض اسم المستخدم أو الكلمة (${e.code}). راوترك فيه حسابين — تأكد من اسم المستخدم (مو دايماً admin) وكلمته من ملصق الراوتر أو صفحة الدخول، وجرّب مرة وحدة بس عشان ما يقفل`;
      }
      throw e;
    }
  }
  private async loginWith(host: string, type: string | undefined, state: string, username: string, password: string,
    opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    if (tag(state, 'State') === '0') {
      // بعض الموديلات (H155) بعد تغيير الإعدادات: state-login يقول «داخل» والأوامر ترد 100003 —
      // كنا نصدّقه ونعلق بحلقة طرد. الحين: لو انطردنا، نطلع ونفتح جلسة جديدة فعلاً
      // fresh: المستخدم كتب كلمة بنفسه ← ما نصدّق الجلسة القديمة، نطلع وندخل بالكلمة عشان نتحقق منها
      if (!this.stale && !opts?.fresh) return;
      this.log(opts?.fresh ? 'fresh login requested — verifying password' : 'stale session — forcing fresh login');
      try { await this.post('user/logout', '<Logout>1</Logout>'); } catch {}
      this.queue = [];
      try { await this.homePage(host); } catch {}
    }
    this.stale = false;
    await this.updateCookie();
    if (this.manualCookie) { try { await this.sesTok(); } catch { this.manualCookie = false; } }
    // صفحة الراوتر الجديدة (H158/H155…) تسجّل دخول بـ SCRAM (challenge_login) — والدخول القديم (user/login)
    // يعطي جلسة ناقصة الصلاحيات: net/lock-freq وغيره يرد 100003 مع إنها شغالة من المتصفح. فنبدأ بـ SCRAM.
    if (this.scram !== false) {
      try {
        await this.loginScram(username, password);
        this.scram = true;
        this.log('login ok (SCRAM first)');
        return;
      } catch (e) {
        const code = e instanceof HuaweiError ? e.code : '';
        // كلمة مرور غلط / قفل: لا نجرّب طريقة ثانية (ما نزيد المحاولات الفاشلة)
        if (/^1080(0[1-7])$/.test(code)) throw e;
        // رمز/جلسة قديمة (125002/125003) مو دليل إن الراوتر ما يدعم SCRAM — كنا نطفيه ونرجع للدخول القديم
        // (جلسة ناقصة الصلاحيات ← 100003). نجدد الجلسة ونعيد SCRAM مرة؛ لو نفس الرفض نرجّعه بدون ما نطفيه
        // لو رفض الرمز مرة ثانية: نجرّب الدخول القديم هالمرة بس — ما نطفي SCRAM (الدخول الجاي يبدأ فيه)
        let tokenOnly = false;
        if (isTokenError(e)) {
          await this.freshSession(host);
          try {
            await this.loginScram(username, password);
            this.scram = true;
            this.log('login ok (SCRAM after fresh session)');
            return;
          } catch (e2) {
            if (e2 instanceof HuaweiError && /^1080(0[1-7])$/.test(e2.code)) throw e2;
            tokenOnly = isTokenError(e2);
            e = e2;
          }
        }
        if (!tokenOnly) this.scram = false;
        this.queue = [];
        this.log('SCRAM not available, falling back:', code || (e as any)?.message);
      }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // بعد إعادة تشغيل/فصل الراوتر أحياناً الكوكي القديم يخلي التوكن يرفض (125003):
        // نجدد الجلسة من الصفحة ونجيب التوكن من SesTokInfo بدل webserver/token
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, 1500 * attempt));
          await this.freshSession(host);
        }
        if (type === '4') await this.loginSha256(username, password, attempt === 2);
        else await this.loginBase64(username, password);
        this.log('login ok');
        // الكوكي اليدوي: نتأكد إن الجلسة الجديدة انمسكت فعلاً — لو لا، نرجع لجرة النظام وندخل من جديد
        if (this.manualCookie) {
          try { await this.get('net/net-mode'); } catch (e) {
            if (e instanceof HuaweiError && /^(100003|125002|125003)$/.test(e.code)) {
              this.manualCookie = false;
              manualHosts.delete(host);
              this.stale = false;
              this.queue = [];
              return this.loginOnce(host, username, password, undefined, true);
            }
          }
        }
        return;
      } catch (e) {
        if (isTokenError(e) && attempt < 2) continue;
        // «فيه مستخدم داخل» وهو غالباً جلستنا القديمة: نطلع ونعيد مرة
        if (e instanceof HuaweiError && e.code === '108003' && attempt === 0) {
          try { await this.post('user/logout', '<Logout>1</Logout>'); } catch {}
          this.queue = [];
          continue;
        }
        if (e instanceof HuaweiError && e.code === '100002') break;
        throw e;
      }
    }
    await this.loginScram(username, password);
    this.log('login ok (SCRAM)');
  }
  private async loginBase64(username: string, password: string) {
    await this.post('user/login',
      `<Username>${esc(username)}</Username><Password>${btoa(password)}</Password><password_type>0</password_type>`);
  }
  private async loginSha256(username: string, password: string, viaSes = false) {
    const token = await this.freshToken(viaSes);
    const hashed = btoa(sha256Hex(username + btoa(sha256Hex(password)) + token));
    await this.post('user/login',
      `<Username>${esc(username)}</Username><Password>${hashed}</Password><password_type>4</password_type>`,
      token);
  }
  private async loginScram(username: string, password: string, dev = false) {
    const firstNonce = bytesToHex(Crypto.getRandomBytes(32));
    // dev: نفس صفحة المطوّر (main.js: route developermode ← loginflag "2" في الطلبين)
    const flag = dev ? '<loginflag>2</loginflag>' : '';
    const ck0 = this.cookie;
    const ch = await this.post('user/challenge_login',
      `<username>${esc(username)}</username><firstnonce>${firstNonce}</firstnonce><mode>1</mode>${flag}`);
    // الـ nonce من الراوتر ممكن فيه رموز مكتوبة بصيغة XML (&quot; …) — لازم نفكها قبل الحساب ونرجّعها مرمّزة.
    // كنا نحسب على النص المرمّز ← 108006 «كلمة غلط» وهي صحيحة، وبس لما يطلع رمز (عشان كذا نفس الراوتر ينجح
    // مرة ويفشل مرة). تقرير ٢ نوفمبر ٥:٥٣: servernonce:101 بدل 96 (+5 = &quot;) ← 108006.
    const salt = unesc(tag(ch, 'salt') ?? '').trim() || undefined;
    const serverNonce = unesc(tag(ch, 'servernonce') ?? '') || undefined;
    const iterations = parseInt(tag(ch, 'iterations') ?? '0', 10);
    diag(`[huawei] challenge: ${challengeShape(ch, firstNonce)}`);
    if (!salt || !serverNonce || !iterations) throw new Error('الراوتر ما رجّع بيانات تسجيل الدخول');
    const msg = `${firstNonce},${serverNonce},${serverNonce}`;
    const salted = pbkdf2(sha256, utf8ToBytes(password), hexToBytes(salt), { c: iterations, dkLen: 32 });
    const clientKey = hmac(sha256, utf8ToBytes('Client Key'), salted);
    const storedKey = sha256(clientKey);
    const signature = hmac(sha256, utf8ToBytes(msg), storedKey);
    const proof = clientKey.map((b, i) => b ^ signature[i]);
    const ck1 = this.cookie;
    try {
      await this.post('user/authentication_login',
        `<clientproof>${bytesToHex(proof)}</clientproof><finalnonce>${esc(serverNonce)}</finalnonce>${flag}`);
    } finally {
      // الآيفون (كوكي يدوي): هل الجلسة تغيّرت بين التحدي والتحقق؟ (بدون قيم)
      if (this.manualCookie) diag(`[huawei] كوكي: قبل التحدي→بعده ${ck0 === ck1 ? 'نفسه' : 'تغيّر'} · بعد التحقق ${ck1 === this.cookie ? 'نفسه' : 'تغيّر'}`);
    }
  }
  async logout() {
    try { await this.post('user/logout', '<Logout>1</Logout>'); } catch {}
    this.queue = [];
  }
  /**
   * انطردنا (100003/125002/125003) ← إعادة الدخول الجاية لازم تكون حقيقية: ما نصدّق state-login «داخل»
   * (State=0 في هواوي يعني «فيه جلسة» عموماً — مو إن جلستنا شغالة)، ونرمي الرموز والكوكي القديم.
   * أخطاء ٢٣–٣٠ أكتوبر: ٢١ مرة «100003 → sig:100003…» (رجعنا بدون دخول) و٣٣ مرة «… → 125003 ×3» (رمز قديم).
   */
  markStale() {
    this.stale = true;
    this.lastOk = null;
    okAt.delete(this.host);
    this.queue = [];
    if (this.manualCookie) this.cookie = '';
  }
  /** جلسة جديدة من الراوتر قبل محاولة دخول ثانية: الصفحة (تعطي SessionID جديد) + SesTokInfo للآيفون */
  private async freshSession(host: string) {
    this.queue = [];
    try { await this.homePage(host); } catch {}
    await this.updateCookie();
    if (this.manualCookie) { try { await this.sesTok(); } catch {} }
  }
  /**
   * صفحة الراوتر نفسها قبل كل دخول: GET monitoring/status مع ترويسة «Update-Cookie: UpdateCookie» (الراوتر يجدد كوكي
   * الجلسة) ← webserver/token ← challenge_login. (main.js في H155-383 / 5G CPE 5 — ملفات add-error ٦ نوفمبر:
   * `"/api/monitoring/status"===c&&(s["Update-Cookie"]="UpdateCookie")` وتسلسل الدخول monitoringStatus ← getToken ← challenge).
   * بدونها بعض الأجهزة ترفض كل رمز من أول طلب (125003) — ٦٤ مرة بالأندرويد ٣–٦ نوفمبر، ولا مرة وصلنا التحدي.
   * جرة النظام بس: في الآيفون (كوكي يدوي) set-cookie ما يوصل للتطبيق؛ لو الكوكي اليدوي انرفض نرجع لجرة النظام وتنطلب هناك.
   * قراءة بس — وأي خطأ نتجاهله (الراوترات القديمة تتجاهل الترويسة).
   */
  private async updateCookie() {
    // الآيفون (يدوي): set-cookie ما يوصل للتطبيق. الأندرويد اليدوي يقراه (takeCookie) ← نطلبها عادي
    if (this.manualCookie && Platform.OS === 'ios') return;
    try {
      const r = await this.http(this.url('monitoring/status'), { headers: this.headers({ 'Update-Cookie': 'UpdateCookie' }) });
      await r.text();
      this.queue = [];
    } catch {}
  }
  async getSignal(): Promise<Signal> {
    const xml = await this.get('device/signal');
    let network: string | undefined;
    let nrAvailable: number | undefined;
    let nrActiveFromStatus: boolean | undefined;
    try {
      const st = await this.get('monitoring/status');
      const ntEx = tag(st, 'CurrentNetworkTypeEx') ?? '';
      const nt = tag(st, 'CurrentNetworkType') ?? '';
      network = NET_TYPES[ntEx] ?? NET_TYPES[nt];
      // كشف 5G من CurrentNetworkTypeEx (أكواد متعددة عبر الفيرمويرات)
      // 111 = 5G NSA | 112 = 5G SA | 1021/1022 = 5G جديد
      const nrActiveCodes = ['111', '112', '1021', '1022'];
      if (nrActiveCodes.includes(ntEx)) nrActiveFromStatus = true;
      // بعض فيرمويرات H138 ترجع 1111/1112 لما 4G+ CA نشط مع إمكانية 5G
      // — نتأكد من حقل NR منفصل
      try {
        const nrType = tag(st, 'CurrentNrNetworkType');
        if (nrType && (nrType === '1' || nrType === '2')) nrActiveFromStatus = true;
      } catch {}
      const icon = num(tag(st, 'SignalIconNr'));
      if (icon !== undefined && icon > 0) nrAvailable = icon;
    } catch {}
    const nrBandRaw = tag(xml, 'nrband') || tag(xml, 'nrBand') || '';
    const nrFromBand = (tag(xml, 'band') ?? '').match(/\bn(\d+)/i);
    return {
      network,
      band: tag(xml, 'band'),
      cellId: tag(xml, 'cell_id'),
      tac: tag(xml, 'tac') || undefined,
      pci: tag(xml, 'pci'),
      earfcn: tag(xml, 'earfcn'),
      dlBandwidth: tag(xml, 'dlbandwidth'),
      ulBandwidth: tag(xml, 'ulbandwidth'),
      rsrp: num(tag(xml, 'rsrp')),
      rsrq: num(tag(xml, 'rsrq')),
      sinr: num(tag(xml, 'sinr')),
      rssi: num(tag(xml, 'rssi')),
      nrBand: nrBandRaw || (nrFromBand ? 'n' + nrFromBand[1] : undefined),
      nrPci: tag(xml, 'nrpci') || undefined,
      nrArfcn: tag(xml, 'nrarfcn') || tag(xml, 'nrearfcn') || undefined,
      nrDlBandwidth: tag(xml, 'nrdlbandwidth') || undefined,
      nrRsrp: num(tag(xml, 'nrrsrp')),
      nrRsrq: num(tag(xml, 'nrrsrq')),
      nrSinr: num(tag(xml, 'nrsinr')),
      nrAvailable,
      nrActiveFromStatus,
      cqi: num(tag(xml, 'cqi0')),
      dlMcs: parseDlMcs(tag(xml, 'dl_mcs')).mcs,
      dlStreams: parseDlMcs(tag(xml, 'dl_mcs')).streams,
      ulMcs: parseUlMcs(tag(xml, 'ul_mcs')),
      txPower: parseTxPower(tag(xml, 'txpower')),
      nrCqi: num(tag(xml, 'nrcqi0')),
      nrDlMcs: parseDlMcs(tag(xml, 'nrdlmcs')).mcs ?? num(tag(xml, 'nrdlmcs')),
      nrTxPower: parseTxPower(tag(xml, 'nrtxpower')),
      nrRank: num(tag(xml, 'nrrank')),
      enodebId: (tag(xml, 'enodeb_id') ?? '').replace(/^0+(?=\d)/, '') || undefined,
    };
  }
  async getCarriers(): Promise<Carrier[]> {
    const xml = await this.get('device/signal');
    const sig = await this.getSignal();
    // نفس مصدر صفحة "معلومات الخلية" في الراوتر
    let sec = '';
    try { sec = await this.get('device/seccellinfo'); } catch {}
    return carriersFrom(xml, sig, sec);
  }
  async getSnapshot(): Promise<SignalSnapshot> {
    let signal = await this.getSignal().catch(() => null);

    // ═══ لو الراوتر يقول 5G نشط لكن nrRsrp فاضي: نحمّل 3 ثواني ونقرأ مرة ثانية ═══
    // هواوي يكشف 5G في device/signal فقط وقت النشاط الفعلي (NSA)
    if (signal && signal.nrActiveFromStatus && signal.nrRsrp === undefined) {
      try {
        const burst = trafficBurst(3000, 8_000_000, () => false);
        await new Promise(r => setTimeout(r, 1500));
        const fresh = await this.getSignal().catch(() => null);
        await burst.catch(() => 0);
        if (fresh && fresh.nrRsrp !== undefined) {
          // دمج: ناخذ قيم 5G من القراءة الجديدة، والباقي من الأصلية
          signal = {
            ...signal,
            nrRsrp: fresh.nrRsrp,
            nrRsrq: fresh.nrRsrq ?? signal.nrRsrq,
            nrSinr: fresh.nrSinr ?? signal.nrSinr,
            nrBand: fresh.nrBand ?? signal.nrBand,
            nrPci: fresh.nrPci ?? signal.nrPci,
            nrArfcn: fresh.nrArfcn ?? signal.nrArfcn,
            nrDlBandwidth: fresh.nrDlBandwidth ?? signal.nrDlBandwidth,
          };
        }
      } catch { /* ما نجحنا نجيب قيم 5G — نكمل بالبيانات الحالية */ }
    }

    const carriers = await this.getCarriers().catch(() => [] as Carrier[]);
    const cells = await this.getCells().catch(() => [] as CellTower[]);
    return buildSnapshot(signal, carriers, cells, { driverId: this.id, driverName: this.name });
  }
  async isConnected() {
    const st = await this.get('monitoring/status');
    return tag(st, 'ConnectionStatus') === '901';
  }
  /**
   * هل الراوتر يدعم 5G؟ نرجع false فقط لما نكون متأكدين (عشان ما نخفي 5G عن راوتر يدعمه).
   *  - موديلات B### و E5### = راوترات 4G (B311, B535, B618, E5186...)
   *  - موديلات H### و E6### = راوترات 5G (5G CPE / Pro)
   *  - أو الراوتر يعرض وضع 5G (08) في قائمة الأوضاع، أو فيه حقول NR في الإشارة
   */
  private async nrCapable(): Promise<boolean | undefined> {
    if (this.nr5g !== null) return this.nr5g;
    let model = '';
    try { model = unesc(tag(await this.get('device/information'), 'DeviceName') ?? ''); } catch {}
    let modes: string[] = [];
    try { modes = tagsAll(tag(await this.get('net/net-mode-list'), 'AccessList') ?? '', 'Access'); } catch {}
    let sigXml = '';
    try { sigXml = await this.get('device/signal'); } catch {}
    let r: boolean | undefined;
    if (/^(B\d{3}|E5\d{3})/i.test(model)) r = false;
    else if (/^(H\d{3}|E6\d{3})/i.test(model)) r = true;
    else if (modes.some(m => m.includes('08'))) r = true;
    else if (/<nr(rsrp|earfcn|arfcn|pci)>/i.test(sigXml)) r = true;
    else if (modes.length && model) r = false;
    this.log('5G capable?', model, modes.join(','), r);
    this.nr5g = r;
    return r;
  }
  async getNetworkInfo(): Promise<NetworkInfo> {
    let operator: string | undefined;
    try {
      const plmn = await this.get('net/current-plmn');
      operator = unesc(tag(plmn, 'FullName') || tag(plmn, 'ShortName') || '') || undefined;
    } catch {}
    let connected: boolean | undefined;
    try { connected = await this.isConnected(); } catch {}
    let mode: string | undefined;
    try { mode = tag(await this.get('net/net-mode'), 'NetworkMode'); } catch {}
    const supports5g = await this.nrCapable().catch(() => undefined);
    return { operator, connected, mode, supports5g };
  }
  async getTraffic(): Promise<Traffic> {
    const xml = await this.get('monitoring/traffic-statistics');
    return {
      downBytesPerSec: num(tag(xml, 'CurrentDownloadRate')) ?? 0,
      upBytesPerSec: num(tag(xml, 'CurrentUploadRate')) ?? 0,
      connectedSecs: num(tag(xml, 'CurrentConnectTime')) ?? 0,
    };
  }
  async getDevices(): Promise<ConnectedDevice[]> {
    try {
      const xml = await this.get('wlan/host-list');
      return tagsAll(xml, 'Host').map(h => ({
        mac: (tag(h, 'MacAddress') ?? '').toUpperCase(),
        ip: tag(h, 'IpAddress')?.split(';')[0],
        name: unesc(tag(h, 'HostName')),
      })).filter(d => d.mac);
    } catch {
      const xml = await this.get('lan/HostInfo');
      return tagsAll(xml, 'Host')
        .filter(h => tag(h, 'Active') !== '0')
        .map(h => ({
          mac: (tag(h, 'MacAddress') ?? '').toUpperCase(),
          ip: tag(h, 'IpAddress')?.split(';')[0],
          name: unesc(tag(h, 'HostName') || tag(h, 'ActualName')),
        })).filter(d => d.mac);
    }
  }
  private async readMacFilter() {
    const xml = await this.get('wlan/multi-macfilter-settings');
    const ssids = tagsAll(xml, 'Ssid');
    if (!ssids.length) throw new Error('الراوتر ما يدعم حظر الأجهزة');
    const first = ssids[0];
    const entries: { mac: string; name: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const mac = (tag(first, `WifiMacFilterMac${i}`) ?? '').trim().toUpperCase();
      if (mac) entries.push({ mac, name: unesc(tag(first, `wifihostname${i}`) ?? '') });
    }
    return {
      status: tag(first, 'WifiMacFilterStatus') ?? '0',
      indexes: ssids.map((s, i) => tag(s, 'Index') ?? String(i)),
      entries,
    };
  }
  async getBlockedDevices(): Promise<ConnectedDevice[]> {
    const f = await this.readMacFilter();
    if (f.status !== '2') return [];
    return f.entries.map(e => ({ mac: e.mac, name: e.name, blocked: true }));
  }
  async blockDevice(mac: string, block: boolean, name = '') {
    const f = await this.readMacFilter();
    if (f.status === '1') {
      throw new Error('فلتر الأجهزة في الراوتر مضبوط على "السماح فقط" — غيّره من لوحة الراوتر أولاً');
    }
    const target = mac.toUpperCase();
    let entries = (f.status === '2' ? f.entries : []).filter(e => e.mac !== target);
    if (block) {
      if (entries.length >= 10) throw new Error('وصلت الحد الأقصى: 10 أجهزة محظورة');
      entries = [...entries, { mac: target, name }];
    }
    const status = entries.length ? '2' : '0';
    const slots = Array.from({ length: 10 }, (_, i) =>
      `<WifiMacFilterMac${i}>${entries[i]?.mac ?? ''}</WifiMacFilterMac${i}>` +
      `<wifihostname${i}>${esc(entries[i]?.name ?? '')}</wifihostname${i}>`).join('');
    const body = f.indexes
      .map(idx => `<Ssid><Index>${idx}</Index><WifiMacFilterStatus>${status}</WifiMacFilterStatus>${slots}</Ssid>`)
      .join('');
    await this.post('wlan/multi-macfilter-settings', `<Ssids>${body}</Ssids>`);
  }
  async getUsage(): Promise<Usage> {
    const xml = await this.get('monitoring/month_statistics');
    return {
      downloadBytes: num(tag(xml, 'CurrentMonthDownload')) ?? 0,
      uploadBytes: num(tag(xml, 'CurrentMonthUpload')) ?? 0,
    };
  }
  async getDataPlan(): Promise<DataPlan> {
    const xml = await this.get('monitoring/start_date');
    return {
      startDay: num(tag(xml, 'StartDay')) ?? 1,
      limitBytes: parseDataLimit(tag(xml, 'DataLimit')),
      monthThreshold: num(tag(xml, 'MonthThreshold')) ?? 90,
    };
  }
  async setDataPlan(plan: DataPlan) {
    const cur = await this.get('monitoring/start_date');
    const inner = cur.match(/<response>([\s\S]*?)<\/response>/)?.[1] ?? '';
    const fields = [...inner.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map(m => [m[1], m[2]] as [string, string]);
    const setF = (k: string, v: string) => {
      const x = fields.find(f => f[0] === k);
      if (x) x[1] = v; else fields.push([k, v]);
    };
    setF('StartDay', String(Math.min(31, Math.max(1, Math.round(plan.startDay)))));
    setF('DataLimit', formatDataLimit(plan.limitBytes));
    setF('MonthThreshold', String(Math.min(100, Math.max(1, Math.round(plan.monthThreshold)))));
    setF('SetMonthData', plan.limitBytes > 0 ? '1' : '0');
    const body = fields.map(([k, v]) => '<' + k + '>' + v + '</' + k + '>').join('');
    this.log('start_date sending', body);
    await this.post('monitoring/start_date', body);
    await new Promise(r => setTimeout(r, 1200));
    const after = await this.getDataPlan();
    this.log('start_date readback', JSON.stringify(after));
    if (plan.limitBytes > 0 && after.limitBytes === 0) {
      throw new Error('الراوتر ما حفظ حجم الباقة');
    }
  }
  async reboot() {
    await this.post('device/control', '<Control>1</Control>');
  }
  async reconnectData(opts?: { holdSecs?: number }) {
    // نطفي بيانات الجوال، نتأكد إن الجلسة انقطعت فعلاً، ونخليها مقطوعة شوي
    // (الشركة ما تفك الآي بي لو رجعنا بسرعة) — وبعدها نرجّعها
    const sleepMs = (ms: number) => new Promise(r => setTimeout(r, ms));
    const waitDown = async () => {
      for (let i = 0; i < 6; i++) {
        await sleepMs(2000);
        if (!(await this.isConnected().catch(() => true))) return true;
      }
      return false;
    };
    let via: 'switch' | 'dial' = 'switch';
    await this.post('dialup/mobile-dataswitch', '<dataswitch>0</dataswitch>');
    if (!(await waitDown())) {
      // بعض الموديلات تتجاهل مفتاح البيانات — نجرّب قطع الاتصال المباشر
      await this.post('dialup/mobile-dataswitch', '<dataswitch>1</dataswitch>').catch(() => '');
      await this.post('dialup/dial', '<Action>0</Action>');
      via = 'dial';
      await waitDown();
    }
    this.log('reconnect: down via', via);
    await sleepMs((opts?.holdSecs ?? 10) * 1000);
    if (via === 'dial') await this.post('dialup/dial', '<Action>1</Action>');
    else await this.post('dialup/mobile-dataswitch', '<dataswitch>1</dataswitch>');
  }
  /**
   * فصل كامل عن البرج: نحوّل وضع الشبكة مؤقتاً لـ 2G/3G (ما لها تغطية غالباً عندنا) → المودم ينفصل عن الشبكة
   * ويفك الشركة جلسته والآي بي — بعدها نرجّع الوضع الأصلي ويتسجّل من جديد. أسرع من إعادة التشغيل.
   */
  async reattach(holdSecs = 12) {
    const cur = await this.get('net/net-mode');
    const orig = tag(cur, 'NetworkMode') ?? '00';
    let modes: string[] = [];
    try { modes = tagsAll(tag(await this.get('net/net-mode-list'), 'AccessList') ?? '', 'Access'); } catch {}
    // وضع مؤقت ما فيه خدمة عندنا: 3G/2G، ولو الراوتر ما يدعمها (H155) فـ 5G SA فقط
    const temp = ['01', '02', '08'].find(m => modes.includes(m) && m !== orig);
    if (!temp) return this.reattachByBand(holdSecs);
    this.reattachOrig = orig;
    await this.writeNetMode({ mode: temp }).catch(() => {});
    try {
      await new Promise(r => setTimeout(r, holdSecs * 1000));
    } finally {
      // لازم نرجّع الوضع الأصلي مهما صار
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        try { await this.writeNetMode({ mode: orig }); ok = true; } catch { await new Promise(r => setTimeout(r, 3000)); }
      }
      if (!ok) throw new Error('ما قدرنا نرجّع وضع الشبكة — اضغط «رجّع الإشارة»');
      this.reattachOrig = '';
    }
  }
  /**
   * فصل بدون 2G/3G/SA (تقرير ٢٥ أكتوبر: هواوي 4G/5G قائمته فيها 4G و5G بس — كان يروح لإعادة التشغيل ويطوّل):
   * نثبّت 4G فقط على تردد «تنزيل بس» (SDL مثل B32) — المودم ما يقدر يتسجل عليه أبداً فينفصل عن البرج،
   * وإذا ما فيه، تردد ما تستخدمه الشركات عندنا. بعدها نرجّع اللقطة كما كانت بالضبط (ونتأكد بالقراءة).
   */
  private reattachSnap: LockSnapshot | null = null;
  private async reattachByBand(holdSecs: number) {
    const cfg = await this.getBandConfig();
    const PARK = [32, 75, 76, 29, 67, 13, 12, 17, 14, 66, 71, 2, 4, 25, 26, 18, 19, 21, 11];
    const park = PARK.find(b => cfg.supported.includes(b));
    if (!park) throw new Error('راوترك ما يسمح بالفصل عن البرج من التطبيق');
    const snap = await this.readLockState();
    this.reattachSnap = snap;
    this.log('reattach: park on B' + park);
    try {
      await this.writeNetMode({ mode: '03', bands: [park] }).catch(e => this.log('park write:', (e as any)?.message ?? e));
      await new Promise(r => setTimeout(r, holdSecs * 1000));
    } finally {
      let last: unknown;
      for (let i = 0; i < 3; i++) {
        try { await this.restoreLockState(snap); last = null; break; } catch (e) { last = e; await new Promise(r => setTimeout(r, 3000)); }
      }
      if (last) throw last instanceof Error ? last : new Error('ما قدرنا نرجّع إعدادك — اضغط «رجّع الإشارة»');
      this.reattachSnap = null;
    }
  }
  /** لو الفصل علق في النص: نرجّع وضع الشبكة الأصلي */
  async wakeRadio() {
    if (this.reattachSnap) {
      await this.restoreLockState(this.reattachSnap);
      this.reattachSnap = null;
      return;
    }
    if (!this.reattachOrig) return;
    const cur = tag(await this.get('net/net-mode'), 'NetworkMode');
    if (cur !== this.reattachOrig) await this.writeNetMode({ mode: this.reattachOrig });
    this.reattachOrig = '';
  }
  async getBandConfig(): Promise<BandConfig> {
    const cur = await this.get('net/net-mode');
    let supported: number[] = [];
    let modes: string[] = [];
    try {
      const list = await this.get('net/net-mode-list');
      modes = tagsAll(tag(list, 'AccessList') ?? '', 'Access');
      let union = 0n;
      for (const b of tagsAll(tag(list, 'LTEBandList') ?? '', 'LTEBand')) {
        const v = big(tag(b, 'Value') ?? '');
        if (v === big(ALL_LTE)) continue;
        union |= v;
      }
      if (union > 0n) {
        supported = bandsFromMask(union);
        this.allLte = union.toString(16).toUpperCase();
      }
    } catch (e) {
      this.log('net-mode-list failed:', (e as any)?.message ?? String(e));
    }
    if (!supported.length) supported = [1, 3, 7, 8, 20, 28, 38, 40, 41];
    if (!modes.length) modes = ['00', '03', '02'];
    try {
      const fsw = await this.get('net/net-feature-switch');
      this.lockFreq = (num(tag(fsw, 'lock_freq_switch')) ?? 0) > 0 || await this.devLockbandOn();
      this.log('feature lock_freq', tag(fsw, 'lock_freq_switch'), 'lteband', tag(fsw, 'lteband_switch'), 'dev lockband', this.devLockband);
    } catch {
      this.lockFreq = false;
    }
    let locked: number[] = [];
    let nrLocked: number[] = [];
    let lteScell: number[] = [];
    let nrScell: number[] = [];
    let lockKinds: BandConfig['lockKinds'];
    if (this.lockFreq) {
      const lf = await this.readLockFreq();
      locked = lf.lte;
      nrLocked = lf.nr;
      lteScell = lf.lteScell;
      nrScell = lf.nrScell;
      const raw = await this.readCellLockRaw();
      lockKinds = { lte: lockKindOf(raw.lte), nr: lockKindOf(raw.nr) };
    } else {
      const opt = tag(cur, 'LTEBandOption');
      const active = bandsFromMask(big(tag(cur, 'LTEBand') ?? ALL_LTE)).filter(b => supported.includes(b));
      locked = opt === '0' || active.length === 0 || active.length >= supported.length ? [] : active;
    }
    this.log('bands supported', supported.join(','), 'locked', locked.join(',') || 'auto', 'lockFreq', this.lockFreq);
    // ═══ ترددات 5G: نعرضها إلا إذا تأكدنا إن الراوتر 4G فقط (B535، B311...)
    const has5g = (await this.nrCapable().catch(() => undefined)) !== false;
    // بدون lock-freq ما فيه طريقة نثبّت فيها تردد 5G (net-mode فيه ترددات 4G بس) —
    // فما نعرض ترددات 5G للاختيار أصلاً، بدل ما المستخدم يختار والراوتر يتجاهلها بصمت
    const nrLockable = this.lockFreq && !this.lockFreqDead;
    const nrSupported = has5g && nrLockable ? DEFAULT_NR_BANDS : [];
    // جرّبنا وتأكدنا إن net-mode ما يثبّت تردد معيّن ← الشاشة تعرض «وضع الشبكة» بس (مثل OPPO)
    if (!nrLockable && netModeBandDead.has(this.host)) supported = [];
    return {
      supported,
      locked,
      nrSupported,
      nrLocked,
      ...(has5g && !nrLockable ? { nrLockable: false } : {}),
      // تثبيت ترددات 4G هنا يحوّل الراوتر لـ «4G فقط» (يطفي 5G) — الدمج مع 5G مستحيل على هالموديل
      ...(has5g && !nrLockable && tag(cur, 'LTEBandOption') !== undefined ? { lteLockKills5g: true } : {}),
      // lock-freq يدعم «ثانوي بس» (Scell) لكل تردد
      ...(this.lockFreq && !this.lockFreqDead ? { bandRoles: true, lteScell, nrScell, lockKinds } : {}),
      mode: tag(cur, 'NetworkMode') ?? '00',
      modes: modes.map(v => ({ value: v, label: modeLabel(v) })),
    };
  }
  private async readNetModeFields(): Promise<[string, string][]> {
    const cur = await this.get('net/net-mode');
    const inner = cur.match(/<response>([\s\S]*?)<\/response>/)?.[1] ?? '';
    return [...inner.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map(m => [m[1], m[2]] as [string, string]);
  }
  private async writeNetMode(patch: { mode?: string; bands?: number[] }) {
    const fields = await this.readNetModeFields();
    const has = (k: string) => fields.some(f => f[0] === k);
    const setF = (k: string, v: string) => {
      const x = fields.find(f => f[0] === k);
      if (x) x[1] = v; else fields.push([k, v]);
    };
    if (patch.mode !== undefined) {
      setF('NetworkMode', patch.mode);
    }
    if (patch.bands !== undefined) {
      const lock = patch.bands.length > 0;
      setF('LTEBand', lock ? maskFromBands(patch.bands) : this.allLte);
      // WebUI 4.0 (فيه networkOption — H155/H158 5G…): LTEBandOption مو «ترددات مخصصة»، معناه
      // 0 = كل 4G · 1 = 4G FDD فقط · 2 = 4G TDD فقط (networkmode.js في صفحة الراوتر).
      // كنا نرسل 1 مع القفل ← الراوتر يحوّل لـ «FDD فقط» ويرجّع LTEBand = كل ترددات FDD
      // (B1+B3+B5+B7+B8+B20+B28+B32) = «قبل الطلب لكن ما غيّر التردد» على كل تردد وتركيبة.
      const webui4 = has('networkOption');
      if (has('LTEBandOption')) setF('LTEBandOption', lock && !webui4 ? '1' : '0');
      if (lock && patch.mode === undefined && has('LTEBandOption')) {
        setF('NetworkMode', '03');
      }
    }
    const body = fields.map(([k, v]) => `<${k}>${v}</${k}>`).join('');
    this.log('net-mode sending', body);
    await this.post('net/net-mode', body);
    await new Promise(r => setTimeout(r, 1500));
    let after = await this.readNetModeFields();
    // بعض الموديلات تطبّق القفل بعد ثواني — نعيد القراءة قبل ما نحكم إنه «ما تغيّر» (تقرير ٢٧ أكتوبر: مرساة 5G
    // B1/B3/B20 كلها «قبل الطلب لكن ما غيّر» على آيفون). والمقارنة على الترددات اللي الراوتر يدعمها بس
    const supMask = big(this.allLte);
    const sameBands = (mask: string, want: number[]) => {
      const got = bandsFromMask(big(mask) & supMask).sort((a, b) => a - b).join(',');
      const w = bandsFromMask(big(maskFromBands(want)) & supMask).sort((a, b) => a - b).join(',');
      return got === w;
    };
    if (patch.bands && patch.bands.length) {
      for (const wait of [2500, 4000]) {
        if (sameBands(after.find(f => f[0] === 'LTEBand')?.[1] ?? '', patch.bands)) break;
        await new Promise(r => setTimeout(r, wait));
        after = await this.readNetModeFields();
      }
    }
    const getA = (k: string) => after.find(f => f[0] === k)?.[1];
    this.log('net-mode readback', after.map(([k, v]) => `${k}=${v}`).join(' '));
    if (patch.mode !== undefined && getA('NetworkMode') !== patch.mode) {
      throw new Error('الراوتر قبل الطلب لكن ما غيّر نوع الشبكة');
    }
    // فك القفل وهو على وضع غير «4G فقط»: بعض الموديلات ترجع «OK» وتخلي القفل — نفكه على 4G فقط ونرجّع الوضع
    if (patch.bands && !patch.bands.length && patch.mode === undefined && has('LTEBandOption')
        && getA('LTEBandOption') === '1' && getA('NetworkMode') && getA('NetworkMode') !== '03') {
      const back = getA('NetworkMode')!;
      const f2 = after.map(([k, v]) => [k, k === 'NetworkMode' ? '03' : k === 'LTEBand' ? this.allLte : k === 'LTEBandOption' ? '0' : v] as [string, string]);
      this.log('unlock via 4G-only', back);
      await this.post('net/net-mode', f2.map(([k, v]) => `<${k}>${v}</${k}>`).join(''));
      await new Promise(r => setTimeout(r, 1500));
      const f3 = f2.map(([k, v]) => [k, k === 'NetworkMode' ? back : v] as [string, string]);
      await this.post('net/net-mode', f3.map(([k, v]) => `<${k}>${v}</${k}>`).join(''));
      await new Promise(r => setTimeout(r, 1500));
      const fin = await this.readNetModeFields();
      if (fin.find(f => f[0] === 'LTEBandOption')?.[1] === '1') throw new Error('الراوتر ما فك قفل ترددات 4G — افتح صفحة الراوتر وحوّل الشبكة لـ 4G واختر كل الترددات');
    }
    if (patch.bands && patch.bands.length && !sameBands(getA('LTEBand') ?? '', patch.bands)) {
      // التفاصيل في الرسالة عشان توصلنا في التقرير: وش طلبنا ووش رجّع الراوتر
      const got = bandsFromMask(big(getA('LTEBand') ?? '0')).map(b => 'B' + b).join('+') || '—';
      const why = ` (طلبنا ${patch.bands.map(b => 'B' + b).join('+')} · الراوتر: ${got} · الشبكة ${getA('NetworkMode') ?? '؟'} · خيار ${getA('LTEBandOption') ?? '—'})`;
      if (has('networkOption')) {
        netModeBandDead.add(this.host);
        throw new Error('راوترك ما يقبل تثبيت تردد 4G معيّن من وضع الشبكة — صفحته تسمح بس بـ «4G FDD» أو «4G TDD» كامل. استخدم «وضع الشبكة» تحت.' + why);
      }
      throw new Error((getA('NetworkMode') === '00'
        ? 'الراوتر ما طبّق القفل — جرّب تحول نوع الشبكة إلى 4G ثم أعد القفل'
        : 'الراوتر قبل الطلب لكن ما غيّر التردد') + why);
    }
  }
  /**
   * قفل الترددات كما في صفحة «تحديد النطاق» بالراوتر:
   * all_bands = كل الترددات المسموحة، freq_infos = اللي تقدر تكون أساسي (Pcell+Scell).
   * اللي في all_bands وما هو في freq_infos = ثانوي بس (Scell).
   */
  private async readLockFreq(): Promise<{ lte: number[]; nr: number[]; lteScell: number[]; nrScell: number[] }> {
    const parse = (section: string) => {
      if (!section || (tag(section, 'lock_mode') ?? '0') !== '3') return { all: [] as number[], scell: [] as number[] };
      const num_ = (xs: string[]) => [...new Set(xs.map(x => parseInt(x, 10)).filter(n => Number.isFinite(n) && n > 0))];
      const prim = num_([...section.matchAll(/<band>(\d+)<\/band>/g)].map(m => m[1]));
      const allB = num_((tag(section, 'all_bands') ?? '').split(/[,;\s]+/));
      const all = allB.length ? [...new Set([...allB, ...prim])] : prim;
      return { all, scell: allB.length ? all.filter(b => !prim.includes(b)) : [] };
    };
    try {
      const xml = await this.get('net/lock-freq');
      this.log('lock-freq raw:', xml.replace(/\s+/g, ' ').slice(0, 300));
      const l = parse(tag(xml, 'lte_info') ?? '');
      const n = parse(tag(xml, 'nr_info') ?? '');
      return { lte: l.all, nr: n.all, lteScell: l.scell, nrScell: n.scell };
    } catch (e) {
      this.log('lock-freq read failed:', (e as any)?.message ?? String(e));
      return { lte: [], nr: [], lteScell: [], nrScell: [] };
    }
  }
  /** بعد أمر ما رد عليه: ننتظر الراوتر يرجع يرد (لين دقيقة) */
  private async waitRouterBack(maxMs = 60_000): Promise<boolean> {
    const until = Date.now() + maxMs;
    while (Date.now() < until) {
      await new Promise(r => setTimeout(r, 3000));
      if (await this.answers()) return true;
    }
    return false;
  }
  private async readLockedBands(): Promise<number[]> {
    return (await this.readLockFreq()).lte;
  }
  /** nrBands = 'keep': نرسل قسم 5G كما قرأناه (قفل خلية أو ترددات بأدوارها) — ما نلمسه */
  private async lockFreqBands(bands: number[] | 'keep', nrBands: number[] | 'keep', roles?: BandRoles) {
    if (bands === 'keep' && nrBands === 'keep') return;
    // نقرأ الأقسام الحالية مرة وحدة لو بنرجّع واحد منها كما هو
    const raw = bands === 'keep' || nrBands === 'keep' ? parseLockRaw(await this.get('net/lock-freq')) : null;
    let lteSection: string;
    if (bands === 'keep') {
      // 4G ما انطلب يتغير: نرسل قسمه مثل ما هو بالضبط (قفل برج أو قناة يبقى)
      lteSection = raw!.lte ? '<lte_info>' + raw!.lte + '</lte_info>' : bandLockSection('lte_info', []);
    } else {
      lteSection = bandLockSection('lte_info', bands, roles?.lteScell);
    }
    let nrSection: string;
    if (nrBands === 'keep') {
      nrSection = raw!.nr ? '<nr_info>' + raw!.nr + '</nr_info>' : bandLockSection('nr_info', []);
    } else {
      nrSection = bandLockSection('nr_info', nrBands, roles?.nrScell);
    }
    const body = await this.trimByMode(lteSection, nrSection);
    this.log('lock-freq sending', body);
    let noReply = false;
    try {
      await this.post('net/lock-freq', body);
    } catch (e) {
      if (e instanceof HuaweiError) throw e;
      // ما رد (مهلة/انقطاع) = غالباً قبل الأمر وهو يعيد اتصاله. ما نعيد الأمر بعمى — ننتظره ونتأكد بالقراءة
      noReply = true;
      this.queue = [];
      this.log('lock-freq: no reply — waiting for router, verifying by read (no resend)');
      await this.waitRouterBack();
    }
    await new Promise(r => setTimeout(r, 2500));
    if (noReply) {
      try { await this.get('net/lock-freq'); } catch (e) {
        const err = new Error('الراوتر استلم أمر الترددات وأعاد تشغيل اتصاله — ما نعيد الأمر بعمى، نرجّع إعدادك ونتأكد منه.');
        (err as any).afterWrite = true;
        throw err;
      }
    }
    const after = await this.readLockFreq();
    this.log('lock-freq readback lte', after.lte.join(',') || 'auto', 'nr', after.nr.join(',') || 'auto');
    const ok = (want: number[], got: number[]) => !want.length || want.every(b => got.includes(b));
    if ((bands !== 'keep' && !ok(bands, after.lte)) || (nrBands !== 'keep' && !ok(nrBands, after.nr))) {
      throw new Error('الراوتر قبل الطلب لكن ما طبّق القفل');
    }
    if (bands !== 'keep' && !bands.length && after.lte.length) throw new Error('ما قدرنا نرجع الوضع التلقائي');
    if (nrBands !== 'keep' && !nrBands.length && after.nr.length) throw new Error('ما قدرنا نرجع وضع 5G للتلقائي');
    // دور «ثانوي بس»: نتأكد إن الراوتر حفظه (لو ما يدعمه يخليها أساسي+ثانوي — مو خطر بس نبلّغ)
    const sc = (want: number[] | undefined, got: number[]) => !want?.length || want.every(b => got.includes(b));
    if (!sc(roles?.lteScell, after.lteScell) || !sc(roles?.nrScell, after.nrScell)) {
      throw new Error('الراوتر قفل الترددات بس ما حفظ «ثانوي بس» — كلها صارت تقدر تكون أساسي');
    }
  }
  async setBand(bands: number[] | 'keep', nrBands?: number[], roles?: BandRoles) {
    if (bands === 'keep' && nrBands === undefined) return;
    if (this.lockFreq === null) {
      try {
        const fsw = await this.get('net/net-feature-switch');
        this.lockFreq = (num(tag(fsw, 'lock_freq_switch')) ?? 0) > 0 || await this.devLockbandOn();
      } catch {
        this.lockFreq = false;
      }
    }
    if (this.lockFreq && !this.lockFreqDead) {
      try {
        // 5G ما انطلب يتغير: نرسل قسمه مثل ما هو بالضبط (حتى لو قفل خلية)
        return await this.lockFreqBands(bands, nrBands ?? 'keep', roles);
      } catch (e) {
        if (!(await this.lockFreqUnsupported(e))) throw e;
        // ما يدعم lock-freq → نثبّت ترددات 4G من وضع الشبكة
      }
    }
    // وضع الشبكة (net-mode) فيه ترددات 4G بس — ما فيه مكان لترددات 5G.
    // قبل كنا نتجاهل ترددات 5G بصمت ونطلّع النتيجة كأنها تطبّقت (مثل H158: «B28 + n40» يطبّق B28 بس).
    // الحين نوقف قبل أي أمر ونقول الحقيقة.
    if (nrBands && nrBands.length) {
      throw noChange('راوترك ما يسمح نثبّت ترددات 5G (يقبل تثبيت ترددات 4G بس) — ما غيّرنا أي شي. خلّ 5G على «تلقائي» وجرّب.');
    }
    if (bands === 'keep') return; // 5G بس (وفاضي) وما فيه شي 4G نغيّره
    if (bands.length && netModeBandDead.has(this.host)) {
      throw noChange('راوترك ما يقبل تثبيت تردد 4G معيّن (جرّبناه وما طبّقه) — ما غيّرنا شي. استخدم «وضع الشبكة»: 4G FDD أو TDD.');
    }
    await this.writeNetMode({ bands });
  }
  /** مثل صفحة الراوتر نفسها: وضع 4G فقط (03) ما يرسل قسم 5G، ووضع 5G فقط (08) ما يرسل قسم 4G */
  private async trimByMode(lte: string, nr: string): Promise<string> {
    let mode = '';
    try { mode = tag(await this.get('net/net-mode'), 'NetworkMode') ?? ''; } catch {}
    if (mode === '03') return lte;
    if (mode === '08') return nr;
    return lte + nr;
  }
  private async readCellLockRaw(): Promise<LockRaw> {
    try {
      return parseLockRaw(await this.get('net/lock-freq'));
    } catch {
      return { lte: '', nr: '' };
    }
  }
  /**
   * قراءة صارمة: ترمي لو القراءة فشلت (بدل ما ترجع «ما فيه قفل»).
   * نستخدمها داخل التثبيت عشان نفرّق بين «ما فيه قفل» و«ما قدرنا نقرأ».
   */
  private async readCellLockStrict(): Promise<LockRaw> {
    return parseLockRaw(await this.get('net/lock-freq'));
  }
  async getCellLocks(): Promise<CellLockState[]> {
    return parseCellLocks(await this.readCellLockRaw());
  }
  async getCellLock(): Promise<CellLockState | null> {
    return (await this.getCellLocks())[0] ?? null;
  }
  async getActiveLock(): Promise<ActiveLock | null> {
    const lf = await this.readLockFreq();
    const cell = await this.getCellLock();
    if (!lf.lte.length && !lf.nr.length && !cell) return null;
    return { bands: lf.lte, nrBands: lf.nr, pci: cell?.pci };
  }
  /**
   * لقطة إعدادات القفل قبل التجربة (قراءة فقط). ترمي لو ما قدرنا نقرأ كل شي —
   * والتجربة توقف قبل أي كتابة (ما نجرّب وإحنا ما نعرف وش نرجّع).
   */
  async readLockState(): Promise<LockSnapshot> {
    const netMode = parseNetModeFields(await this.get('net/net-mode'));
    if (!netMode.some(f => f[0] === 'NetworkMode')) throw new Error('ما قدرنا نقرأ وضع الشبكة من الراوتر');
    if (this.lockFreq === null) {
      // لازم نعرف أكيد هل فيه net/lock-freq. الراوتر رد بكود خطأ = الرابط مو موجود (موديل قديم بدون
      // lock-freq، الترددات كلها في net-mode اللي قرأناه). انقطاع/مهلة = ما نعرف ← نوقف التجربة
      try {
        const fsw = await this.get('net/net-feature-switch');
        this.lockFreq = (num(tag(fsw, 'lock_freq_switch')) ?? 0) > 0 || await this.devLockbandOn();
      } catch (e) {
        // 100003/12500x = جلسة انتهت (مو «غير موجود») — نرميه وطبقة الجلسات تدخل من جديد
        if (!(e instanceof HuaweiError) || ['100003', '125002', '125003'].includes(e.code)) throw e;
        this.lockFreq = false;
      }
    }
    let lockFreq: LockRaw | null = null;
    if (this.lockFreq && !this.lockFreqDead) {
      try {
        lockFreq = parseLockRaw(await this.get('net/lock-freq'));
      } catch (e) {
        if (!(await this.lockFreqUnsupported(e))) throw e;
      }
    }
    const data: HuaweiLockData = { netMode, lockFreq };
    return { driver: this.id, at: Date.now(), summary: huaweiSummary(data), data };
  }
  /**
   * يرجّع اللقطة كما هي: وضع الشبكة أول، بعدها أقسام القفل — ونكتب بس اللي تغيّر.
   * بعدها نقرأ ونقارن: لو بقى فرق نرمي restoreMismatch بقائمة اللي ما رجع.
   */
  async restoreLockState(snap: LockSnapshot): Promise<void> {
    if (snap.driver !== this.id) throw new Error('اللقطة من نوع راوتر ثاني — ما نرجّعها');
    const d = snap.data as HuaweiLockData;
    const mode = d.netMode.find(f => f[0] === 'NetworkMode')?.[1] ?? '';
    const curNet = parseNetModeFields(await this.get('net/net-mode'));
    if (netModeDiff(d.netMode, curNet).length) {
      this.log('restore net-mode', netModeBody(d.netMode));
      await this.post('net/net-mode', netModeBody(d.netMode));
      await new Promise(r => setTimeout(r, 2000));
      // بعض الموديلات (H158 بدون lock-freq) ما تقبل تغيير ترددات 4G إلا وهي على «4G فقط»:
      // ترجع نوع الشبكة وتخلي الترددات مقفلة. نرجّع الترددات على 4G فقط، وبعدها نوع الشبكة الأصلي
      const stuck = netModeDiff(d.netMode, parseNetModeFields(await this.get('net/net-mode')));
      if (mode && mode !== '03' && stuck.some(x => /4G/.test(x)) && d.netMode.some(f => f[0] === 'LTEBand')) {
        const via03 = d.netMode.map(([k, v]) => [k, k === 'NetworkMode' ? '03' : v] as [string, string]);
        this.log('restore net-mode via 4G-only', netModeBody(via03));
        await this.post('net/net-mode', netModeBody(via03));
        await new Promise(r => setTimeout(r, 2000));
        await this.post('net/net-mode', netModeBody(d.netMode));
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    // «نوع 5G (SA/NSA)» ما رجع (٦ تقارير std:*-revert، ٢٦ أكتوبر–١ نوفمبر، كلها بعد تجربة SA/NSA):
    // الجسم الكامل (كل حقول net-mode) يرجّع الوضع والترددات بس الراوتر يتجاهل networkOption فيه.
    // صفحة المطورين نفسها تغيّره بطلب حقلين بس (NetworkMode + networkOption) — ونفس setNetStandard اللي نجح بالتجربة.
    const opt = d.netMode.find(f => f[0] === 'networkOption')?.[1];
    const bOpt = d.netMode.find(f => f[0] === 'LTEBandOption')?.[1];
    const left0 = netModeDiff(d.netMode, parseNetModeFields(await this.get('net/net-mode')));
    if (mode === '00' && opt !== undefined && left0.includes('نوع 5G (SA/NSA)')) {
      const body = `<NetworkMode>00</NetworkMode><networkOption>${opt}</networkOption>`;
      diag(`[huawei] restore networkOption (حقلين): ${opt}`);
      await this.post('net/net-mode', body);
      await new Promise(r => setTimeout(r, 2000));
    } else if (mode === '03' && bOpt !== undefined && left0.includes('خيار ترددات 4G')) {
      diag(`[huawei] restore LTEBandOption (حقلين): ${bOpt}`);
      await this.post('net/net-mode', `<NetworkMode>03</NetworkMode><LTEBandOption>${bOpt}</LTEBandOption>`);
      await new Promise(r => setTimeout(r, 2000));
    }
    if (d.lockFreq) {
      const cur = parseLockRaw(await this.get('net/lock-freq'));
      if (lockDiffForMode(d.lockFreq, cur, mode).length) {
        const body = lockRestoreBody(d.lockFreq, mode);
        this.log('restore lock-freq', body);
        await this.post('net/lock-freq', body);
        await new Promise(r => setTimeout(r, 2500));
      }
    }
    // التحقق: نقرأ من الراوتر نفسه — ما نصدّق «OK» من الطلب
    // فيه lock-freq: هو المرجع لترددات 4G، وLTEBand في net-mode نسخة يكتبها الراوتر بنفسه بعد إرجاع
    // lock-freq (بصيغة «تلقائي» ثانية) — لو قفل 4G رجع مثل اللقطة ما نحاسب على LTEBand
    const lfNow = d.lockFreq ? parseLockRaw(await this.get('net/lock-freq')) : null;
    const lfLeft = d.lockFreq && lfNow ? lockDiffForMode(d.lockFreq, lfNow, mode) : [];
    const skip = d.lockFreq && !lfLeft.some(x => x.startsWith('قفل 4G')) ? ['LTEBand'] : [];
    const left = netModeDiff(d.netMode, parseNetModeFields(await this.get('net/net-mode')), skip);
    left.push(...lfLeft);
    this.log('restore verify', left.join(',') || 'match');
    // يوصل لتقارير الأعضاء (this.log في نسخة التطوير بس) — عشان نعرف وش ما رجع ومن وين
    if (left.length) {
      const now = parseNetModeFields(await this.get('net/net-mode').catch(() => ''));
      const pick = (f: [string, string][]) => f.filter(([k]) => /^(NetworkMode|networkOption|LTEBandOption|LTEBand)$/.test(k)).map(([k, v]) => `${k}=${v}`).join(' ');
      diag(`[huawei] restore verify ✗ ${left.join(',')} · اللقطة: ${pick(d.netMode)} · الحين: ${pick(now)}`);
    }
    if (left.length) throw restoreMismatch(left);
  }
  async lockCell(target: CellLockTarget) {
    const UNSUPPORTED = 'راوترك ما يدعم تثبيت البرج (قفل الخلية) — هالخاصية مو موجودة في هالموديل';
    const pci = (target.pci ?? '').trim();
    // كل الأخطاء قبل أول أمر POST تنرمي بعلامة noChange: ما أرسلنا شي، فما فيه شي نرجّعه
    if (!pci) throw noChange('ما عندنا رقم الخلية (PCI) لهذا البرج');
    const arfcn = arfcnOf(target.arfcn);
    const band = target.band;
    const tech: CellTech = target.tech === 'NR' ? 'NR' : 'LTE';
    const isNr = tech === 'NR';
    if (this.lockFreqDead) throw noChange(UNSUPPORTED);

    // لا تحاول قفل خلية NR عندما يكون الراوتر مضبوطًا على 4G فقط.
    let currentMode = '';
    try {
      currentMode = tag(await this.get('net/net-mode'), 'NetworkMode') ?? '';
    } catch {
      throw noChange(
        'تعذر قراءة وضع الشبكة. لم ننفذ قفل البرج؛ تحقق من اتصال الراوتر وحاول مجددًا.'
      );
    }

    if (isNr && currentMode === '03') {
      throw noChange(
        'تعذر تثبيت برج 5G لأن الراوتر مضبوط على 4G فقط. ' +
        'غيّر وضع الشبكة إلى 4G + 5G إذا كان مدعومًا، ثم أعد المحاولة. ' +
        'لم ننفذ قفل البرج.'
      );
    }
    if (!isNr && currentMode === '08') {
      throw noChange(
        'تعذر تثبيت برج 4G لأن الراوتر مضبوط على 5G فقط. ' +
        'غيّر وضع الشبكة إلى 4G + 5G، ثم أعد المحاولة. لم ننفذ قفل البرج.'
      );
    }

    // نقرأ الأقفال الحالية قبل أي أمر: عشان ما نمسح قفل التقنية الثانية،
    // ولو القراءة فشلت نوقف (ما نرسل أمر وإحنا ما نعرف وش على الراوتر)
    let current: LockRaw;
    try {
      current = await this.readCellLockStrict();
    } catch (e) {
      if (await this.lockFreqUnsupported(e)) throw noChange(UNSUPPORTED);
      throw noChange('ما قدرنا نقرأ تثبيت البرج الحالي من الراوتر، فما غيّرنا شي. جرّب مرة ثانية.');
    }
    const otherBefore = parseCellLocks(current).find(l => l.tech !== tech);

    const candidates = this.cellLockMode ? [this.cellLockMode] : ['2', '4', '1', '5'];
    let lastErr: unknown;
    let accepted = false;
    for (const mode of candidates) {
      const body = buildCellLockBody({ tech, pci, arfcn, band, mode, current, netMode: currentMode });
      this.log('cell-lock try mode', mode, body);
      try {
        await this.post('net/lock-freq', body);
      } catch (e) {
        // ما رد أبداً (مهلة/انقطاع): الراوتر غالباً قبل الأمر وأعاد تشغيل اتصاله (H155/H158 Pro يسوونها مع تثبيت البرج).
        // قبل: كنا نرسل الصيغة اللي بعدها بعمى، وبعدها طبقة الجلسات تعيد الأمر كله — ٨ أوامر وراوتر يطيح ويقوم،
        // وآخرها رسالة «تطبيق HUAWEI AI Life يطلّعك» وهو مو السبب. الحين: ننتظره يرجع ونوقف، والإرجاع يتأكد.
        if (!(e instanceof HuaweiError)) {
          this.log('cell-lock: no reply (router restarting?) — waiting, no resend');
          const until = Date.now() + 60_000;
          while (Date.now() < until) {
            await new Promise(r => setTimeout(r, 3000));
            if (await this.answers()) break;
          }
          const err = new Error('الراوتر استلم أمر تثبيت البرج وأعاد تشغيل اتصاله (عادي في موديلك) — ما نعيد الأمر بعمى، نرجّع إعدادك ونتأكد منه.');
          (err as any).afterWrite = true;
          throw err;
        }
        // الراوتر رد بخطأ صريح على هالصيغة — نجرّب الصيغة اللي بعدها
        if (!accepted && await this.lockFreqUnsupported(e)) throw noChange(UNSUPPORTED);
        lastErr = e;
        continue;
      }
      accepted = true;
      await new Promise(r => setTimeout(r, 2500));
      let locks: CellLockState[];
      try {
        locks = parseCellLocks(await this.readCellLockStrict());
      } catch {
        // الراوتر قبل الأمر وما نقدر نتأكد وش صار — ما نعيد أوامر بعمى.
        // (بدون noChange: safeApply يرجّع الإعداد السابق)
        throw new Error('الراوتر قبل أمر التثبيت لكن ما قدرنا نتأكد من النتيجة — وقّفنا بدل ما نعيد الأمر.');
      }
      this.log('cell-lock readback', JSON.stringify(locks));
      if (lockMatches(locks, tech, pci, arfcn)) {
        this.cellLockMode = mode;
        if (otherBefore && !locks.some(l => l.tech === otherBefore.tech && l.pci === otherBefore.pci)) {
          this.log('cell-lock: other tech lock was dropped by the router', JSON.stringify(otherBefore));
        }
        return;
      }
    }
    // لا تمسح الأقفال السابقة عند فشل محاولة تثبيت خلية جديدة.
    if (lastErr) throw lastErr;
    throw new Error('الراوتر ما قبل قفل الخلية على هذا البرج؛ أبقينا الأقفال السابقة دون مسحها.');
  }
  async lockChannel(target: { tech: 'LTE' | 'NR'; band?: number; arfcn: string }) {
    const UNSUPPORTED = 'راوترك ما يدعم قفل القناة';
    const arfcn = arfcnOf(target.arfcn);
    if (!arfcn) throw noChange('اكتب رقم القناة (EARFCN / NR-ARFCN)');
    const tech: CellTech = target.tech === 'NR' ? 'NR' : 'LTE';
    if (this.lockFreqDead) throw noChange(UNSUPPORTED);
    let netMode = '';
    try {
      netMode = tag(await this.get('net/net-mode'), 'NetworkMode') ?? '';
    } catch {
      throw noChange('تعذر قراءة وضع الشبكة. لم ننفذ قفل القناة؛ تحقق من اتصال الراوتر وحاول مجددًا.');
    }
    if (tech === 'NR' && netMode === '03') throw noChange('الراوتر على 4G فقط — حوّله لـ 4G + 5G قبل قفل قناة 5G. لم ننفذ شي.');
    if (tech === 'LTE' && netMode === '08') throw noChange('الراوتر على 5G فقط — حوّله لـ 4G + 5G قبل قفل قناة 4G. لم ننفذ شي.');
    let current: LockRaw;
    try {
      current = await this.readCellLockStrict();
    } catch (e) {
      if (await this.lockFreqUnsupported(e)) throw noChange(UNSUPPORTED);
      throw noChange('ما قدرنا نقرأ القفل الحالي من الراوتر، فما غيّرنا شي. جرّب مرة ثانية.');
    }
    const body = buildChannelLockBody({ tech, band: target.band, arfcn, current, netMode });
    this.log('channel-lock', body);
    try {
      await this.post('net/lock-freq', body);
    } catch (e) {
      if (await this.lockFreqUnsupported(e)) throw noChange(UNSUPPORTED);
      throw e;
    }
    await new Promise(r => setTimeout(r, 2500));
    let after: LockRaw;
    try {
      after = await this.readCellLockStrict();
    } catch {
      throw new Error('الراوتر قبل أمر قفل القناة لكن ما قدرنا نتأكد من النتيجة.');
    }
    if (!channelMatches(after, tech, arfcn)) throw new Error('الراوتر ما ثبّت القناة المطلوبة');
  }
  async unlockCell(tech?: 'LTE' | 'NR') {
    if (this.lockFreqDead) return; // الموديل ما يدعم قفل الخلية
    const body = buildUnlockBody(tech);
    this.log('cell-lock clearing', tech ?? 'all');
    try {
      await this.post('net/lock-freq', body);
    } catch (e) {
      if (await this.lockFreqUnsupported(e)) return;
      throw e;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  async getNetStandard(): Promise<NetStandard | null> {
    try { return standardOf(await this.get('net/net-mode')); } catch { return null; }
  }
  /** نفس طلب صفحة المطورين بالضبط (حقلين)، وبعدها نتأكد من القراءة */
  async setNetStandard(s: NetStandard) {
    let cur: NetStandard | null;
    try {
      cur = standardOf(await this.get('net/net-mode'));
    } catch {
      throw noChange('تعذر قراءة وضع الشبكة — ما غيّرنا شي. جرّب مرة ثانية.');
    }
    if (cur === null) throw noChange('راوترك ما يدعم هالخيارات في وضع الشبكة');
    if (cur === s) return;
    await this.post('net/net-mode', standardBody(s));
    await new Promise(r => setTimeout(r, 2000));
    let after: NetStandard | null = null;
    try { after = standardOf(await this.get('net/net-mode')); } catch {}
    if (after !== s) throw new Error('الراوتر قبل الطلب لكن ما غيّر وضع الشبكة');
  }
  async setNetworkMode(mode: string) {
    await this.writeNetMode({ mode });
  }
  // ───── APN و DNS (منفصلة في apn-dns.ts) ─────
  private io() {
    return {
      get: (p: string) => this.get(p),
      post: (p: string, b: string) => this.post(p, b),
      log: (...a: unknown[]) => this.log(...a),
      page: async (p: string) => (await this.http(`${this.base()}/${p.replace(/^\//, '')}`, { headers: this.headers() }, 10000)).text(),
    };
  }
  getApnProfiles() { return getApnProfiles(this.io()); }
  setApn(p: { index: string; name: string; apn: string; username?: string; password?: string; authMode?: string }) {
    return setApn(this.io(), p);
  }
  selectApn(index: string) { return selectApn(this.io(), index); }
  getDns() { return getDns(this.io()); }
  getWifiRadios() { return getWifiRadios(this.io()); }
  setWifiChannel(band: '2.4' | '5', channel: string) { return setWifiChannel(this.io(), band, channel); }
  wifiDebug() { return wifiDebug(this.io()); }
  // ───── مركز التحكم (extras.ts) ─────
  getExtras() { return extras.getExtras(this.io()); }
  /** الموديل من device/basic_information (بدون دخول في أغلب الموديلات) */
  async identify(): Promise<ModelProfile | null> {
    try {
      const r = await this.http(this.url('device/basic_information'), { headers: this.headers() });
      const x = await r.text();
      if (x.includes('<error>')) return identifyHuawei('');
      return identifyHuawei(tag(x, 'devicename') ?? tag(x, 'DeviceName') ?? '');
    } catch { return null; }
  }
  getAntenna() { return more.getAntenna(this.io()); }
  setAntenna(mode: number) { return more.setAntenna(this.io(), mode); }
  ussd(code: string) { return more.ussd(this.io(), code); }
  routerPing(host: string) { return more.routerPing(this.io(), host); }
  setNat(t: 'cone' | 'symmetric') { return extras.setNat(this.io(), t); }
  setUpnp(on: boolean) { return extras.setUpnp(this.io(), on); }
  setDmz(on: boolean, ip: string, mac?: string) { return extras.setDmz(this.io(), on, ip, mac); }
  setLedNight(on: boolean, start: string, end: string) { return extras.setLedNight(this.io(), on, start, end); }
  setAutoReboot(on: boolean) { return extras.setAutoReboot(this.io(), on); }
  setGuest(on: boolean, offHours: number) { return extras.setGuest(this.io(), on, offHours); }
  setBandOn(band: '2.4' | '5', on: boolean) { return extras.setBandOn(this.io(), band, on); }
  setWifiNames(names: { index: string; name: string }[], password?: string) { return extras.setWifiNames(this.io(), names, password); }
  /** ضبط المصنع — نفس أمر صفحة «الاستعادة» (Control 2) — مقروء من صفحة 5G CPE Pro 5 */
  async factoryReset() {
    await this.post('device/control', '<Control>2</Control>');
  }
  addTimeRule(r: { mac: string; name: string; days: string; start: string; end: string }) { return extras.addTimeRule(this.io(), r); }
  updateTimeRule(r: TimeRule, action: 'update' | 'delete', on?: boolean) { return extras.updateTimeRule(this.io(), r, action, on); }
  setUrlBlocks(list: { url: string; macs: string[] }[]) { return extras.setUrlBlocks(this.io(), list); }
  setDns(cfg: DnsConfig) { return setDns(this.io(), cfg); }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const out: DeviceDetails = {};
    try {
      const xml = await this.get('device/information');
      out.model = unesc(tag(xml, 'DeviceName')) || undefined;
      out.imei = tag(xml, 'Imei');
      out.software = tag(xml, 'SoftwareVersion');
      out.hardware = tag(xml, 'HardwareVersion');
      out.wanIp = tag(xml, 'WanIPAddress');
    } catch (e) {
      this.log('device/information failed');
    }
    try {
      const st = await this.get('monitoring/status');
      out.wanIp = out.wanIp || tag(st, 'WanIPAddress');
      const dns = [tag(st, 'PrimaryDns'), tag(st, 'SecondaryDns')].filter(Boolean);
      if (dns.length) out.dns = dns.join('  ·  ');
      const sim = tag(st, 'SimStatus');
      if (sim) out.simStatus = sim === '1' ? 'جاهزة' : `الحالة ${sim}`;
    } catch (e) {
      this.log('monitoring/status failed');
    }
    try {
      const plmn = await this.get('net/current-plmn');
      out.operator = unesc(tag(plmn, 'FullName') || tag(plmn, 'ShortName') || '') || undefined;
    } catch (e) {
      this.log('net/current-plmn failed');
    }
    return out;
  }
  private parseCellList(raw: string, tech: 'LTE' | 'NR', kind: 'neighbor' | 'secondary'): CellTower[] {
    const out: CellTower[] = [];
    for (const rec of raw.split(';')) {
      const f = rec.trim().split(',').map(x => x.trim());
      if (f.length < 5) continue;
      const off = f.length >= 8 ? 1 : 0;
      const bandDigits = (f[1] ?? '').replace(/[^0-9]/g, '');
      const t: CellTower = {
        kind,
        tech,
        arfcn: f[0] || undefined,
        band: bandDigits ? parseInt(bandDigits, 10) : undefined,
        pci: f[2 + off] || undefined,
        rsrp: num(f[3 + off]),
        rsrq: num(f[4 + off]),
        rssi: num(f[5 + off]),
        sinr: num(f[6 + off]),
      };
      if (t.rsrp === undefined && t.pci === undefined) continue;
      out.push(t);
    }
    return out;
  }
  private scanCellXml(xml: string, kind: 'neighbor' | 'secondary'): CellTower[] {
    const out: CellTower[] = [];
    for (const m of xml.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) {
      const name = m[1];
      const val = (m[2] ?? '').trim();
      if (!val.includes(',') || !/cell|list/i.test(name)) continue;
      const tech: 'LTE' | 'NR' = /nr|5g/i.test(name) ? 'NR' : 'LTE';
      out.push(...this.parseCellList(val, tech, kind));
    }
    return out;
  }
  async getCells(): Promise<CellTower[]> {
    const out: CellTower[] = [];
    try {
      const sig = await this.getSignal();
      if (sig.nrRsrp !== undefined || sig.nrBand) {
        const nb = (sig.nrBand ?? '').match(/(\d+)/);
        out.push({
          kind: 'serving',
          tech: 'NR',
          arfcn: sig.nrArfcn,
          band: nb ? parseInt(nb[1], 10) : undefined,
          pci: sig.nrPci,
          rsrp: sig.nrRsrp,
          rsrq: sig.nrRsrq,
          sinr: sig.nrSinr,
        });
      }
      const bm = (sig.band ?? '').match(/B(\d+)/i);
      out.push({
        kind: 'serving',
        tech: 'LTE',
        arfcn: arfcnOf(sig.earfcn) || undefined,
        band: bm ? parseInt(bm[1], 10) : undefined,
        pci: sig.pci,
        cellId: sig.cellId,
        rsrp: sig.rsrp,
        rsrq: sig.rsrq,
        sinr: sig.sinr,
        rssi: sig.rssi,
      });
    } catch (e) {
      this.log('serving cell failed');
    }
    const sources: [string, 'secondary' | 'neighbor'][] = [
      ['device/seccellinfo', 'secondary'],
      ['device/nbrcellinfo', 'neighbor'],
    ];
    for (const [path, kind] of sources) {
      try {
        const xml = await this.get(path);
        this.log(path, 'raw:', xml.replace(/\s+/g, ' ').slice(0, 700));
        out.push(...this.scanCellXml(xml, kind));
      } catch (e) {
        this.log(path, 'failed:', (e as any)?.message ?? String(e));
      }
    }
    return out;
  }
  async listSms(box: 'inbox' | 'sent' = 'inbox'): Promise<SmsMessage[]> {
    const xml = await this.post('sms/sms-list',
      `<PageIndex>1</PageIndex><ReadCount>50</ReadCount><BoxType>${box === 'inbox' ? 1 : 2}</BoxType>` +
      `<SortType>0</SortType><Ascending>0</Ascending><UnreadPreferred>0</UnreadPreferred>`);
    return tagsAll(xml, 'Message').map(m => ({
      index: tag(m, 'Index') ?? '',
      phone: unesc(tag(m, 'Phone') ?? ''),
      content: unesc(tag(m, 'Content') ?? ''),
      date: tag(m, 'Date') ?? '',
      unread: tag(m, 'Smstat') === '0',
    })).filter(m => m.index);
  }
  async markSmsRead(index: string) {
    await this.post('sms/set-read', `<Index>${esc(index)}</Index>`);
  }
  async deleteSms(index: string) {
    await this.post('sms/delete-sms', `<Index>${esc(index)}</Index>`);
  }
  async sendSms(phone: string, text: string) {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    await this.post('sms/send-sms',
      `<Index>-1</Index><Phones><Phone>${esc(phone)}</Phone></Phones><Sca></Sca>` +
      `<Content>${esc(text)}</Content><Length>${text.length}</Length><Reserved>1</Reserved><Date>${date}</Date>`);
  }
}
