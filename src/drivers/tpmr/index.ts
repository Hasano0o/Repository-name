/**
 * TP-Link 4G القديمة — TL-MR100 (وعائلتها MR6400/MR200 بنفس الفيرموير). العنوان 192.168.1.1 (tplinkmodem.net)، المستخدم admin.
 * المرحلة ١ (٢١ نوفمبر ٢٠٢٦، من ملف «مو مدعوم؟» عضو): التعرّف + الدخول + القراءة + كرت FULL (ردود أوامر القراءة). بدون أي أمر كتابة.
 *
 * من lib.js + encrypt.js + tpEncrypt.js في صفحة الراوتر:
 *  • POST /cgi/getParm ← var ee/nn/seq (مفتاح RSA-512 عام) — نفس NX200
 *  • INCLUDE_LOGIN_GDPR_ENCRYPT = 1 (الافتراضي — tpEncrypt.js و cryptoJS موجودة):
 *      hash = md5("admin"+كلمة) · مفتاح AES عشوائي · data = AES("admin\nكلمة")
 *      sign = RSA_nopad("key=K&iv=I&h=hash&s=" + (seq + طول data))   ← Encryptor.getSignature(seq+len, isLogin=1)
 *      POST /cgi/login?data=<data>&sign=<sign>&Action=1&LoginStatus=0
 *    = 0: POST /cgi/login?UserName=RSA("admin")&Passwd=RSA(base64(كلمة))&Action=1&LoginStatus=0
 *  • بعد الدخول: TokenID من «/» (var token="…")، والأوامر POST /cgi_gdpr «sign=h=…&s=…\r\ndata=AES(الطلب)» (أو /cgi?… بدون تشفير)
 *  • الطلب بالصيغة القديمة (mrReq) والرد كتل key=value + [error]N
 *  • أوامر الراديو في الصفحة: LTE_NET_STATUS · LTE_BAND_SEL · LTE_SEARCH_BAND · LTE_CELL_LOCK · LTE_NET_SEL · LTE_SMS_* · LTE_USSD
 *    ⚠️ أسماء حقول الإشارة ما شفناها (صفحة الحالة بعد الدخول) — mrSignal يطابق بالاسم، والتشخيص يسجّل الحقول كلها مرة.
 */
import { RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, DeviceDetails } from '../types';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { http } from '../http';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import { buildSnapshot } from '../../utils/snapshot';
import { scrubLive } from '../../services/routerDump';
import { isBadPassword, markBadPassword } from '../zte/formulaStore';
import type { ModelProfile } from '../models';
import { TpState, tpGenKeys, tpHash, tpBody, tpAesEncrypt, tpAesDecrypt, tpSign, tpParm, tpRsa, tpB64 } from '../tplink/crypto';
import { tpPageVars } from '../tplink/parse';
import { mrIsLoginPage, mrGdprFlag, mrReq, mrParse, mrRet, mrToken, mrSignal, mrOperator, MR_ERR_PWD, MR_READ_OIDS, ACT, MrAct } from './parse';

/** صفحات تغيّر شي — ما تنفتح */
const MR_DANGER = /reboot|reset|restore|factory|upgrade|firmware|logout|backup|config\.bin/i;

export class TplinkMrDriver implements RouterDriver {
  readonly id = 'tplink-mr';
  name = 'TP-Link MR';
  readonly capabilities: Capability[] = ['signal'];

  private host = '';
  private model = '';
  private gdpr = true;
  private st: TpState | null = null;
  private token = '';
  private creds: { password: string } | null = null;
  private reloginAt = 0;
  private logged = false;
  private last: { at: number; f: Record<string, string> } | null = null;

  private base(h = this.host) { return 'http://' + h.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  private async raw(path: string, init: RequestInit = {}, timeout = 8000) {
    const r = await http(this.base() + path, { ...init, headers: { Referer: this.base() + '/', ...(init.headers as Record<string, string> | undefined) } }, timeout);
    return { status: r.status, text: await r.text() };
  }
  private setModel(m: string) { this.model = m; this.name = /tp-?link/i.test(m) ? m : `TP-Link ${m}`; }

  private async parm() {
    for (const method of ['POST', 'GET']) {
      try {
        const r = await this.raw('/cgi/getParm', { method }, 6000);
        const p = tpParm(r.text);
        diag(`[tpmr] getParm ${method} → ${r.status} · ${p ? '✓' : r.text.replace(/\s+/g, ' ').slice(0, 60)}`);
        if (p) return p;
      } catch (e: any) { diag(`[tpmr] getParm ${method} ✗ ${String(e?.message ?? e).slice(0, 60)}`); }
    }
    return null;
  }

  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    this.host = host;
    try {
      const t = (await this.raw('/', {}, 4000)).text;
      if (!mrIsLoginPage(t)) return false;
      const v = tpPageVars(t);
      if (v.model) this.setModel(v.model);
      return !!(await this.parm());
    } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    const key = this.model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      id: 'tplink-mr' + (key ? '-' + key : ''), label: this.name, brand: 'tplink', tech: '4G',
      writeUnverified: true,
      note: 'TP-Link 4G (MR). الدعم للحين: الدخول والإشارة. أرسل ملفات راوترك (الكرت تحت) عشان نضيف الترددات والبرج — صفحته فيها LTE_BAND_SEL و LTE_CELL_LOCK.',
    };
  }

  /** خيار التشفير من كود الصفحة (lib.js / oid_str.js) — ما لقيناه ← مشفّر (tpEncrypt.js موجود) */
  private async readFlag(page: string) {
    let f = mrGdprFlag(page);
    for (const p of ['/js/oid_str.js', '/js/lib.js']) {
      if (f !== null) break;
      try { f = mrGdprFlag((await this.raw(p, {}, 8000)).text); } catch {}
    }
    this.gdpr = f ?? /tpEncrypt\.js/.test(page);
    diag(`[tpmr] INCLUDE_LOGIN_GDPR_ENCRYPT = ${f === null ? `ما لقيناه ← ${this.gdpr ? 'مشفّر' : 'RSA بس'}` : f ? '1' : '0'}`);
  }

  async login(host: string, _username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    this.host = host;
    const fp = bytesToHex(sha256(utf8ToBytes(`tpmr:admin:${password}`)));
    const key = 'tpmr:' + host;
    if (!opts?.fresh && !opts?.lastTry && await isBadPassword(key, fp)) {
      throw new Error('كلمة المرور المحفوظة رفضها الراوتر قبل — ما جرّبناها مرة ثانية عشان ما ينقفل. عدّلها من إعدادات الراوتر.');
    }
    this.st = null; this.token = ''; this.logged = false;
    const page = (await this.raw('/', {}, 10000)).text;
    const v = tpPageVars(page);
    if (v.model) this.setModel(v.model);
    if ((v.forbidTime ?? 0) > 0) throw new Error(`الراوتر قافل الدخول بعد محاولات غلط — انتظر ${Math.ceil((v.forbidTime ?? 0) / 60) || 1} دقيقة وجرّب مرة وحدة.`);
    await this.readFlag(page);
    const p = await this.parm();
    if (!p) throw new Error('الراوتر ما أعطى مفتاح الدخول (getParm) — اضغط «أرسل الخطأ للمطوّر»');

    let url: string;
    if (this.gdpr) {
      this.st = { keys: tpGenKeys(), hash: tpHash('admin', password), seq: p.seq, nn: p.nn, ee: p.ee };
      const data = tpAesEncrypt('admin\n' + password, this.st.keys);
      const sign = tpSign(this.st, data.length, true);
      url = `/cgi/login?data=${encodeURIComponent(data)}&sign=${sign}&Action=1&LoginStatus=0`;
    } else {
      url = `/cgi/login?UserName=${tpRsa('admin', p.nn, p.ee)}&Passwd=${tpRsa(tpB64(password), p.nn, p.ee)}&Action=1&LoginStatus=0`;
    }
    let r: { status: number; text: string };
    try { r = await this.raw(url, { method: 'POST' }, 15000); }
    catch (e: any) { throw new Error(`الراوتر ما رد على الدخول — ${String(e?.message ?? e).slice(0, 60)}`); }
    let ret = mrRet(r.text);
    if (ret === null && this.st && r.text.trim()) { try { ret = mrRet(tpAesDecrypt(r.text, this.st.keys)); } catch {} }
    diag(`[tpmr] login (${this.gdpr ? 'مشفّر' : 'RSA'}، طول الكلمة ${password.length}) → ${r.status} · ret=${ret ?? '—'} · ${r.text.length}B`);
    if (ret === MR_ERR_PWD || (ret !== null && ret !== 0)) {
      await markBadPassword(key, fp);
      const after = tpPageVars((await this.raw('/', {}, 6000).catch(() => ({ text: '' }))).text);
      const left = after.maxAuthTimes !== undefined && after.authTimes !== undefined ? after.maxAuthTimes - after.authTimes : undefined;
      throw new Error(ret === MR_ERR_PWD
        ? `كلمة المرور غلط — اكتب كلمة دخول صفحة الراوتر (الافتراضية admin أو اللي غيّرتها أول مرة)${left !== undefined && left >= 0 ? ` · باقي ${left} محاولات` : ''}`
        : `الراوتر رفض الدخول (رمز ${ret}) — اضغط «أرسل الخطأ للمطوّر»`);
    }
    // TokenID من الصفحة بعد الدخول
    try { this.token = mrToken((await this.raw('/', {}, 10000)).text) ?? ''; } catch {}
    diag(`[tpmr] TokenID ${this.token ? '✓' : '✗'}`);
    this.creds = { password };
    this.logged = true;
    // نتأكد بقراءة
    const f = await this.read().catch(() => null);
    if (!f) {
      if (r.status >= 400) { this.logged = false; throw new Error(`الدخول فشل (HTTP ${r.status}) — اضغط «أرسل الخطأ للمطوّر»`); }
      diag('[tpmr] بعد الدخول: القراءة ما ردت (نكمّل — الأسماء تنشاف في FULL)');
    }
    await markBadPassword(key, null);
  }

  async logout(): Promise<void> { /* ما نرسل خروج — الصفحة نفسها تتعامل مع جلسة وحدة */ }

  /** طلب أوامر — مشفّر على /cgi_gdpr أو عادي على /cgi?… · الجلسة انتهت ← دخول جديد مرة كل دقيقتين بالكثير */
  private async exe(acts: MrAct[], again = true): Promise<{ text: string; parsed: ReturnType<typeof mrParse> }> {
    if (!this.logged) {
      if (!this.creds) throw new Error('ما دخلنا الراوتر');
      await this.login(this.host, 'admin', this.creds.password);
    }
    const plain = mrReq(acts);
    const headers: Record<string, string> = { 'Content-Type': 'text/plain', ...(this.token ? { TokenID: this.token } : {}) };
    let text = '', status = 0;
    if (this.gdpr && this.st) {
      const r = await this.raw('/cgi_gdpr', { method: 'POST', headers, body: tpBody(plain, this.st, false) }, 10000);
      status = r.status;
      try { text = tpAesDecrypt(r.text, this.st.keys); } catch { text = ''; }
    } else {
      const r = await this.raw('/cgi?' + acts.map(a => a.type).join('&'), { method: 'POST', headers, body: plain.replace(/^[^\r\n]*\r\n/, '') }, 10000);
      status = r.status; text = r.text;
    }
    const parsed = mrParse(text);
    if ((status === 403 || status === 401 || !parsed.blocks.length && parsed.error === null) && again && this.creds && Date.now() - this.reloginAt > 120_000) {
      this.reloginAt = Date.now();
      diag(`[tpmr] الأمر رجع ${status} بدون بيانات — الجلسة انتهت؟ دخول جديد`);
      this.logged = false;
      await this.login(this.host, 'admin', this.creds.password, { fresh: true });
      return this.exe(acts, false);
    }
    return { text, parsed };
  }

  /** LTE_NET_STATUS + WAN_LTE_LINK_CFG (كل الحقول) — مرة كل ٣ ثواني بالكثير */
  private logged1 = false;
  private async read(): Promise<Record<string, string> | null> {
    if (this.last && Date.now() - this.last.at < 3000) return this.last.f;
    const { parsed } = await this.exe([
      { type: ACT.GET, oid: 'LTE_NET_STATUS', stack: '2,1,0,0,0,0' },
      { type: ACT.GET, oid: 'WAN_LTE_LINK_CFG', stack: '2,1,0,0,0,0' },
    ]);
    if (!parsed.blocks.length) { diag(`[tpmr] القراءة: بدون كتل (error ${parsed.error ?? '—'})`); return null; }
    const f: Record<string, string> = {};
    for (const b of parsed.blocks) Object.assign(f, b.f);
    if (!this.logged1) {
      this.logged1 = true;
      diag(`[tpmr] الحقول: ${scrubLive(Object.entries(f).map(([k, x]) => `${k}=${String(x).slice(0, 20)}`).join(' · ')).slice(0, 1200)}`);
    }
    this.last = { at: Date.now(), f };
    return f;
  }

  async isConnected(): Promise<boolean> {
    try { await this.raw('/', {}, 4000); return true; } catch { return false; }
  }

  async getSignal(): Promise<Signal> {
    const f = await this.read();
    if (!f) throw new Error('الراوتر ما رد على قراءة الإشارة');
    return mrSignal(f);
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const f = (await this.read().catch(() => null)) ?? {};
    const cs = Object.entries(f).find(([k]) => /connect_?stat/i.test(k))?.[1];
    return { operator: mrOperator(f), mode: '4G', supports5g: false, connected: cs === undefined ? undefined : /^(1|2|connected)$/i.test(cs) };
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const sig = await this.getSignal();
    return buildSnapshot(sig, [], cellsOf(sig), { driverId: this.id, driverName: this.name });
  }
  async getCells(): Promise<CellTower[]> { return cellsOf(await this.getSignal()); }

  async getDeviceDetails(): Promise<DeviceDetails> {
    let sw = '';
    try {
      const { parsed } = await this.exe([{ type: ACT.GET, oid: 'IGD_DEV_INFO', stack: '0,0,0,0,0,0', attrs: ['modelName', 'softwareVersion', 'hardwareVersion'] }]);
      const f = parsed.blocks[0]?.f ?? {};
      if (f.modelName) this.setModel(f.modelName);
      sw = f.softwareVersion ?? '';
    } catch {}
    return { model: this.name, software: `${sw || 'mr'}|tpmr-pages-1` };
  }

  /** FULL: ردود أوامر القراءة (/_bandly/oid/…) + «/» بعد الدخول */
  afterLoginPages(): string[] {
    const v: string[] = ['/'];
    for (const o of MR_READ_OIDS) for (const s of o.stacks) v.push(`/_bandly/oid/get/${o.oid}/${s.replace(/,/g, '-')}.txt`);
    return v;
  }
  async fetchAuthPage(path: string): Promise<{ ok: boolean; status: number; text: string; type: string }> {
    const m = path.match(/^\/_bandly\/oid\/get\/([A-Z0-9_]+)\/([\d-]+)\.txt$/);
    if (m) {
      try {
        const { text, parsed } = await this.exe([{ type: ACT.GET, oid: m[1], stack: m[2].replace(/-/g, ',') }]);
        return { ok: true, status: 200, text: scrubLive(text) || `(فاضي · error ${parsed.error ?? '—'})`, type: 'text/plain' };
      } catch (e: any) {
        return { ok: true, status: 200, text: `خطأ: ${String(e?.message ?? e).slice(0, 120)}`, type: 'text/plain' };
      }
    }
    if (MR_DANGER.test(path)) return { ok: false, status: 0, text: '', type: '' };
    try {
      const r = await this.raw(path, this.token ? { headers: { TokenID: this.token } } : {}, 10000);
      const type = /\.js(\?|$)/i.test(path) ? 'application/javascript' : /\.css(\?|$)/i.test(path) ? 'text/css' : 'text/html';
      return { ok: r.status >= 200 && r.status < 400, status: r.status, text: r.text.replace(/(\bvar\s+token\s*=\s*")[^"]*"/, '$1«محذوف»"'), type };
    } catch { return { ok: false, status: 0, text: '', type: '' }; }
  }
}

function cellsOf(s: Signal): CellTower[] {
  if (s.rsrp === undefined) return [];
  const b = s.band ? Number(String(s.band).replace(/\D/g, '')) : undefined;
  return [{ kind: 'serving', tech: 'LTE', band: b || undefined, pci: s.pci, cellId: s.cellId, arfcn: s.earfcn, rsrp: s.rsrp, rsrq: s.rsrq, sinr: s.sinr, rssi: s.rssi }];
}
