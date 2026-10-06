import { sha256 } from '@noble/hashes/sha2';
import { md5 } from '@noble/hashes/legacy';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import {
  RouterDriver, Capability, Signal, NetworkInfo, Traffic, ConnectedDevice,
  Usage, DeviceDetails, CellTower, BandConfig, ActiveLock, Carrier,
  SignalSnapshot, CellLockState, CellLockTarget,
} from '../types';
import { http } from '../http';
import {
  parsePci, decodeBandMask, encodeBandMask, parseZteCa, bandLabel,
} from '../../utils/normalize';
import { buildSnapshot } from '../../utils/snapshot';

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

/** صيغة كلمة المرور اللي نجحت مع كل راوتر — عشان المرة الجاية نحاول مرة وحدة بس
 *  (كل محاولة غلط تنقص عداد الراوتر، وبعد ٥ غلطات يقفل الدخول دقائق) */
const GOOD_FORMULA = new Map<string, string>();

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
  capabilities: Capability[] = ['signal', 'devices', 'traffic', 'usage', 'reboot', 'cells', 'bandLock'];
  // تجربة حقيقية (MU5001، ٤ أكتوبر ٢٠٢٦): التثبيت على برج ما يمسكه يطيّح الخدمة (LIMITED_SERVICE)
  // بس الراوتر يبقى حي، وفك التثبيت + إعادة التشغيل يرجّعه — فالميزة شغالة مع الإرجاع التلقائي.
  // لو احتجنا نوقفها مرة ثانية: cellLockRisk = '...'
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
  private static readonly AD_FORMULAS = ['wa+cr', 'wa', 'wa+cr+web', 'wa+web', 'concat'] as const;
  private adFormula: string | null = null;
  private adProbed = false;

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
        default: return undefined;
      }
    } catch {
      return undefined;
    }
  }

  /** يختبر الصيغ على SET_WEB_LANGUAGE (بلا تأثير جانبي — نفس اللغة). */
  private async probeAdFormula(): Promise<void> {
    if (this.adProbed) return;
    this.adProbed = true;
    try {
      const v = await this.get(['wa_inner_version', 'cr_version', 'web_version']);
      const rd = (await this.get(['RD'])).RD;
      if (!rd) return;
      const wa = v.wa_inner_version ?? '';
      const cr = v.cr_version ?? '';
      const web = v.web_version ?? '';
      const formulas: Array<[string, string]> = [
        ['wa+cr', md5Hex(md5Hex(wa + cr) + rd)],
        ['wa', md5Hex(md5Hex(wa) + rd)],
        ['wa+cr+web', md5Hex(md5Hex(wa + cr + web) + rd)],
        ['wa+web', md5Hex(md5Hex(wa + web) + rd)],
        ['concat', md5Hex(wa + cr + rd)],
      ];
      for (const [name, ad] of formulas) {
        try {
          const form = `isTest=false&goformId=SET_WEB_LANGUAGE&Language=en&AD=${encodeURIComponent(ad)}`;
          const res = await http(this.base() + '/goform/goform_set_cmd_process', {
            method: 'POST',
            headers: this.headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
            body: form,
          });
          const out = await res.text();
          if (/"result"\s*:\s*"?0"?/.test(out) || /success/i.test(out)) {
            this.adFormula = name;
            return;
          }
        } catch {}
      }
      this.adFormula = 'wa+cr';
    } catch {}
  }

  private async signAd(): Promise<string | undefined> {
    if (!this.adProbed) await this.probeAdFormula();
    return this.computeAd(this.adFormula ?? 'wa+cr');
  }

  private async post(body: Record<string, string>): Promise<string> {
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
  async login(host: string, _username: string, password: string): Promise<void> {
    this.host = host;
    this.password = password;

    // ═══ لو جلستنا شغالة أصلاً ما نصرف أي محاولة ═══
    if (await this.verifyLogin()) { this.log('login: already ok'); return; }

    // ═══ هل الراوتر قافل الدخول بسبب محاولات غلط؟ ═══
    const lockMsg = await this.lockState();
    if (lockMsg) throw new Error(lockMsg);

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

    // ═══ من service.js: WEB_ATTR_IF_SUPPORT_SHA256 له 3 حالات ═══
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

    const isOk = (s: string) =>
      /"result"\s*:\s*"?0"?/.test(s) || /"result"\s*:\s*"?success"?/i.test(s);

    let sawBusy = false;

    // الصيغة اللي نجحت قبل تنجرب أول
    const known = GOOD_FORMULA.get(host);
    if (known) candidates.sort((a, b) => (a.name === known ? -1 : b.name === known ? 1 : 0));

    for (const c of candidates) {
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
        await new Promise(r => setTimeout(r, 400));
        return;
      }
      // 2 = duplicateUser (مستخدم آخر داخل) — نتذكره ونكمل
      if (/"result"\s*:\s*"?2"?/.test(out)) { sawBusy = true; continue; }
      // نوقف قبل ما يقفل الراوتر الدخول — نخلي محاولة احتياط
      const left = await this.attemptsLeft();
      if (left !== undefined && left <= 1) {
        const lock = await this.lockState();
        throw new Error(lock ?? 'تعذّر تسجيل الدخول — كلمة المرور غالباً غلط، والراوتر باقي له محاولة وحدة قبل ما يقفل الدخول. تأكد منها من الإعدادات.');
      }
      // غير ذلك: نجرّب الصيغة التالية (1 أو 3 ما نوقف)
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
    if (/success/i.test(out) || !this.password) return out;
    try { await this.login(this.host, '', this.password); } catch {}
    out = await this.post(body);
    return out;
  }

  private rejected(what: string, out: string): Error {
    const raw = (out || '').replace(/\s+/g, ' ').slice(0, 80);
    return new Error(`الراوتر رفض ${what}. لو صفحة الراوتر مفتوحة في متصفح، سكّرها وجرّب (${raw || 'بدون رد'})`);
  }

  async logout(): Promise<void> {
    try { await this.post({ goformId: 'LOGOUT' }); } catch {}
    this.password = '';
  }

  private async ensure(): Promise<void> {
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
    ]);
    // نأخذ أول قيمة غير فاضية من قائمة بدائل (5G SA يسمي الحقول بشكل مختلف)
    const pickAny = (...keys: string[]): string | undefined => pick(r, ...keys);
    const nrRsrpVal = pickAny('Z5g_rsrp', 'nr5g_rsrp', 'nr5g_sa_rsrp');
    const nrSinrVal = pickAny('Z5g_SINR', 'nr5g_sinr', 'nr5g_sa_sinr', 'Z5g_snr', 'nr5g_snr');
    const nrRsrqVal = pickAny('Z5g_rsrq', 'nr5g_rsrq', 'nr5g_sa_rsrq');
    const nrBandVal = pickAny('nr5g_action_band', 'nr5g_band', 'nr5g_sa_band', 'nr_band');
    const nrPciVal = pickAny('nr5g_pci', 'nr5g_sa_pci', 'nr_pci', 'nr5g_cell_pci');
    const nrArfcnVal = pickAny('Z5g_dlEarfcn', 'nr5g_action_channel', 'nr5g_dlEarfcn', 'nr5g_dl_earfcn', 'nr5g_sa_arfcn', 'nr5g_arfcn');
    const nrCellIdVal = pickAny('nr5g_cell_id', 'nr5g_sa_cell_id', 'nr_cell_id');
    const nrBwVal = pickAny('nr5g_dlbandwidth', 'nr5g_bandwidth', 'nr5g_sa_bandwidth', 'nr5g_dl_bandwidth');
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
    const ok: string[] = [];
    const step = async (name: string, fn: () => Promise<string>) => {
      try { if (/success/i.test(await fn())) ok.push(name); } catch (e) { this.log('restore', name, 'failed', (e as any)?.message); }
    };
    // ١. فك التثبيت على الأبراج
    await step('lte-cell', () => this.clearLteCell());
    await step('nr-cell', () => this.clearNrCell());
    // ٢. ترددات 4G: الأصلية لو نعرفها، وإلا قائمة واسعة، وإلا الافتراضية
    const lteTries = [
      this.baseLte(),
      [...new Set([...DEFAULT_LTE, ...WIDE_LTE])].sort((a, b) => a - b),
      DEFAULT_LTE,
    ].filter((x): x is number[] => !!x && x.length > 0);
    for (const bands of lteTries) {
      const before = ok.length;
      await step('lte-bands', () => this.act({
        goformId: 'BAND_SELECT', is_gw_band: '0', gw_band_mask: '0',
        is_lte_band: '1', lte_band_mask: maskFromBands(bands),
      }));
      if (ok.length > before) break;
    }
    // ٣. ترددات 5G
    for (const nr of [this.baseNr(), DEFAULT_NR, SAFE_NR].filter((x): x is number[] => !!x && x.length > 0)) {
      const before = ok.length;
      await step('nr-bands', () => this.act({ goformId: 'WAN_PERFORM_NR5G_BAND_LOCK', nr5g_band_mask: nr.join(',') }));
      if (ok.length > before) break;
    }
    // ٤. وضع الشبكة: الأصلي أو تلقائي
    const mode = (this.orig?.net_select || '').trim() || CODE_TO_ZTE['00'];
    await step('mode', () => this.act({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: mode }));
    this.log('restoreAll ok:', ok.join(','));
    if (!ok.length) throw new Error('الراوتر ما قبل أي أمر — تأكد إنك متصل بالواي فاي حقه وجرّب مرة ثانية');
    // ٥. إعادة تشغيل عشان كل شي يتطبّق
    try { await this.post({ goformId: 'REBOOT_DEVICE' }); } catch {}
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
    return { supported, locked, nrSupported, nrLocked, mode, modes };
  }

  /** وضع الشبكة: 00 تلقائي، 0803 = 4G+5G، 03 = 4G فقط، 08 = 5G فقط (SA) — أو القيمة الأصلية كما هي */
  async setNetworkMode(mode: string): Promise<void> {
    await this.ensure();
    const v = CODE_TO_ZTE[mode] ?? mode;
    const out = await this.act({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: v });
    if (!/success/i.test(out)) throw this.rejected('تغيير وضع الشبكة', out);
  }

  async setBand(bands: number[], nrBands?: number[]): Promise<void> {
    await this.ensure();
    // «فك التثبيت» = الترددات الأصلية للراوتر لو نعرفها (مو قائمة تخمينية — كانت تشيل ترددات زي B38 ويطيح الراوتر بدون خدمة)
    const all = this.baseLte() ?? [...new Set([...DEFAULT_LTE, ...(await this.readLocks()).lte])];
    const lte = bands.length ? bands : all;
    const out = await this.act({
      goformId: 'BAND_SELECT',
      is_gw_band: '0', gw_band_mask: '0',
      is_lte_band: '1', lte_band_mask: maskFromBands(lte),
    });
    if (!/success/i.test(out)) throw this.rejected('تثبيت الترددات', out);
    if (nrBands) {
      const nr = nrBands.length ? nrBands : (this.baseNr() ?? DEFAULT_NR);
      const cur = (await this.readLocks()).nr;
      const same = cur.length === nr.length && nr.every(b => cur.includes(b));
      if (!same) {
        let o2 = await this.act({ goformId: 'WAN_PERFORM_NR5G_BAND_LOCK', nr5g_band_mask: nr.join(',') });
        if (!/success/i.test(o2) && !nrBands.length) {
          o2 = await this.act({ goformId: 'WAN_PERFORM_NR5G_BAND_LOCK', nr5g_band_mask: SAFE_NR.join(',') });
        }
        if (!/success/i.test(o2)) throw this.rejected('تثبيت ترددات 5G', o2);
      }
    }
  }

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
    const nrBand = pick(r, 'nr5g_action_band', 'nr5g_band', 'nr5g_sa_band');
    const nrRsrpV = pick(r, 'Z5g_rsrp', 'nr5g_rsrp');
    const nb = bandNum(nrBand);
    if (nb && nrRsrpV) {
      out.push({
        tech: 'NR', role: out.length ? 'SCC' : 'PCC', band: nb,
        arfcn: pick(r, 'Z5g_dlEarfcn', 'nr5g_action_channel', 'nr5g_dlEarfcn', 'nr5g_sa_arfcn') || undefined,
        pci: pciDec(pick(r, 'nr5g_pci', 'nr5g_sa_pci')),
        bandwidth: num(pick(r, 'nr5g_bandwidth', 'nr5g_dlbandwidth', 'nr5g_sa_bandwidth')),
        rsrp: num(nrRsrpV),
        rsrq: num(pick(r, 'Z5g_rsrq', 'nr5g_rsrq')),
        sinr: num(pick(r, 'Z5g_SINR', 'nr5g_sinr')),
      });
    }
    return out;
  }

  // ─── التثبيت على برج (Cell Lock) ───

  async getCellLocks(): Promise<CellLockState[]> {
    await this.ensure();
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

  async lockCell(t: CellLockTarget): Promise<void> {
    await this.ensure();
    const pci = String(parsePci(t.pci) ?? t.pci ?? '').trim();
    const arfcn = (t.arfcn ?? '').trim();
    if (!pci) throw new Error('ما عندنا رقم البرج (PCI) — ما نقدر نثبّت عليه');
    if (!arfcn) throw new Error('الراوتر ما أعطانا رقم تردد هذا البرج (EARFCN) — ثبّت التردد بدلاً منه');
    let out: string;
    if (t.tech === 'NR') {
      if (!t.band) throw new Error('ما نعرف تردد 5G لهذا البرج');
      out = await this.act({ goformId: 'NR5G_LOCK_CELL_SET', nr5g_cell_lock: `${pci},${arfcn},${t.band},${nrScs(t.band)}` });
    } else {
      out = await this.act({ goformId: 'LTE_LOCK_CELL_SET', lte_pci_lock: pci, lte_earfcn_lock: arfcn });
    }
    if (!/success/i.test(out)) throw this.rejected('التثبيت على البرج', out);
    this.log('cell-lock set', t.tech, pci, arfcn);
    // بعض الإصدارات تطبّقه فوراً — وأغلبها تحتاج إعادة تشغيل
    if (!rebootToApply.has(this.host) && await this.waitServing(t.tech, pci, 12000)) return;
    rebootToApply.add(this.host);
    this.log('cell-lock needs reboot');
    await this.rebootAndWait();
  }

  /**
   * فك تثبيت برج 4G. الراوتر النظيف قيمه **فاضية** ("") — كنا نرسل 0 و0، والصفر رقم برج صالح (PCI 0)،
   * فالراوتر يعتبرها تثبيت على برج غير موجود ويطيح بدون خدمة لين ضبط المصنع.
   * نرسل فاضي أول، وصفر بس لو الراوتر رفض الفاضي.
   */
  private async clearLteCell(): Promise<string> {
    const o = await this.act({ goformId: 'LTE_LOCK_CELL_SET', lte_pci_lock: '', lte_earfcn_lock: '' });
    if (/success/i.test(o)) return o;
    return this.act({ goformId: 'LTE_LOCK_CELL_SET', lte_pci_lock: '0', lte_earfcn_lock: '0' });
  }
  private async clearNrCell(): Promise<string> {
    const o = await this.act({ goformId: 'NR5G_LOCK_CELL_SET', nr5g_cell_lock: '' });
    if (/success/i.test(o)) return o;
    return this.act({ goformId: 'NR5G_LOCK_CELL_SET', nr5g_cell_lock: '0,0,0,0' });
  }

  async unlockCell(tech?: 'LTE' | 'NR'): Promise<void> {
    await this.ensure();
    const had = (await this.getCellLocks().catch(() => [] as CellLockState[])).filter(h => !tech || h.tech === tech);
    let o1 = '', o2 = '';
    if (!tech || tech === 'LTE') o1 = await this.clearLteCell();
    if (!tech || tech === 'NR') o2 = await this.clearNrCell().catch(() => '');
    if (!/success/i.test(o1) && !/success/i.test(o2)) throw this.rejected('فك التثبيت', o1 || o2);
    if (had.length && rebootToApply.has(this.host)) await this.rebootAndWait();
  }

  async reboot(): Promise<void> {
    await this.ensure();
    await this.post({ goformId: 'REBOOT_DEVICE' });
  }
}
