import { RouterDriver, Capability, SignalSnapshot, DeviceDetails, Signal, NetworkInfo } from '../types';
import { http } from '../http';
import { isLanHost } from '../../utils/host';
import { buildSnapshot } from '../../utils/snapshot';
import { pro7Signal, pro7Network, Pro7Status } from './pro7';

/**
 * راوترات OpenWrt بواجهة LuCI القديمة (Lua) — أول واحد: «5G CPE Pro 7» (موبايلي، ١ نوفمبر ٢٠٢٦، ثيم bigtmt).
 *
 * من ملفات صفحة العضو:
 *  • "/" = صفحة OpenWrt الافتراضية ← <meta refresh> لـ /cgi-bin/luci
 *  • /cgi-bin/luci بدون جلسة = صفحة الدخول بحالة 403: <form method="post" action="/cgi-bin/luci">
 *    بخانتين luci_username / luci_password (الملصق: admin/admin)
 *  • بعد الدخول: كوكي sysauth، وأحياناً ;stok=… في الرابط (LuCI 15+)
 *
 * للحين: الدخول بس (وإعادة التشغيل؟ لا — ما شفنا صفحتها). صفحات الإشارة والترددات تختلف حسب المصنّع
 * وما نعرفها لين توصل ملفات FULL (كرت «أرسل ملفات راوتري» يطلع لأن الراوتر مو مؤكد) — afterLoginPages
 * يعطي الجامع صفحات القائمة بعد الدخول، والقائمة في LuCI القديم مكتوبة في الصفحة نفسها فيلحق كل الروابط.
 * لا نرسل أي أمر تخميني.
 */
export class LuciDriver implements RouterDriver {
  readonly id = 'luci';
  name = 'OpenWrt (LuCI)';
  readonly capabilities: Capability[] = ['signal'];
  private host = '';
  /** ;stok=… لو الفيرموير يحطه في الروابط بعد الدخول */
  private stok = '';

  private base(host = this.host) {
    return 'http://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
  private root() {
    return this.stok ? `/cgi-bin/luci/;stok=${this.stok}` : '/cgi-bin/luci';
  }
  /** اسم الجهاز من <title> صفحة الدخول (Pro7) */
  private nameFrom(html: string) {
    // بعد الدخول العنوان «Pro7 - System Status» — ناخذ اسم الجهاز بس
    const t = html.match(/<title>\s*([^<]{2,60}?)\s*<\/title>/i)?.[1]?.split(/\s+[-|–]\s+/)[0]?.trim();
    if (t && !/^(LuCI|OpenWrt|Authorization)/i.test(t)) this.name = `${t} (OpenWrt)`;
  }

  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    try {
      const r = await http(`${this.base(host)}/cgi-bin/luci`, {}, 4000);
      const t = await r.text();
      // بدون جلسة: صفحة الدخول (403 عادةً، أو 200 في بعض النسخ)
      if (!/name=["']?luci_password/i.test(t)) return false;
      this.nameFrom(t);
      return true;
    } catch {
      return false;
    }
  }

  async login(host: string, username: string, password: string): Promise<void> {
    if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    this.host = host;
    this.stok = '';
    const body = `luci_username=${encodeURIComponent(username || 'admin')}&luci_password=${encodeURIComponent(password)}`;
    // الفورم يرسل لنفس الرابط — نجاح = 302 لصفحة الإدارة (fetch يلحقه) + كوكي sysauth في الجرة
    const r = await http(`${this.base()}/cgi-bin/luci`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${this.base()}/cgi-bin/luci` },
      body,
    }, 12000);
    const t = await r.text();
    const st = (r.url || '').match(/;stok=([0-9a-f]{8,64})/i)?.[1] ?? t.match(/;stok=([0-9a-f]{8,64})/i)?.[1] ?? '';
    // رجع لنا فورم الدخول نفسه = الكلمة غلط (LuCI ما يعطي رمز خطأ، يعيد الصفحة)
    if (/name=["']?luci_password/i.test(t) && !st) {
      throw new Error('اسم المستخدم أو كلمة المرور غلط — جرّب اللي على الملصق تحت الراوتر (admin / admin)');
    }
    this.stok = st;
    this.nameFrom(t);
  }

  async logout(): Promise<void> {
    if (!this.host) return;
    try { await http(`${this.base()}${this.root()}/admin/logout`, {}, 5000); } catch {}
  }

  /**
   * صفحات بعد الدخول للجامع (FULL). الجامع ما يلحق روابط القائمة (بدون امتداد) — فنعطيه صفحات المودم بالاسم.
   * من قائمة Pro7 (ملف FULL الأول، ١ نوفمبر): admin/status/{nr,wan,overview,system} · admin/modem/{band,cell,network,connect,apn}
   * كلها عرض (GET بدون قيم) — ما فيها أي أمر.
   */
  afterLoginPages(): string[] {
    const r = this.root();
    return [
      `${r}/`,
      ...['status/nr', 'status/wan', 'status/overview', 'status/system', 'status/lan',
        'modem/band', 'modem/cell', 'modem/network', 'modem/connect', 'modem/apn',
        'system/device', 'network/setting', 'sms/inbox'].map(x => `${r}/admin/${x}`),
    ];
  }

  async isConnected(): Promise<boolean> {
    try {
      const r = await http(`${this.base()}${this.root()}/admin`, {}, 5000);
      const t = await r.text();
      return !/name=["']?luci_password/i.test(t);
    } catch {
      return false;
    }
  }

  /**
   * software = رقم «نسخة الصفحات اللي نطلبها» — ملفات FULL تنرسل مرة لكل بصمة (الموديل|software)،
   * فلما نضيف صفحات جديدة للجامع نرفع الرقم ويرجع الكرت مرة وحدة. (2 = صفحات المودم بالاسم، 3 = بعد إصلاح تصادم الأسماء — ١ نوفمبر)
   */
  async getDeviceDetails(): Promise<DeviceDetails> {
    return { model: this.name.replace(/ \(OpenWrt\)$/, ''), software: 'luci-pages-3' };
  }

  /**
   * Pro7 (ثيم bigtmt): أيقونات الهيدر من XHR.poll(5, '<root>/admin/status/nr_icons') ← JSON
   * {mode: "LTE" | "NR5G-NSA" | "NR5G-SA" | "WCDMA" | "5G", signal: "0"…"5", status, sms_num} — من كود الصفحة نفسها.
   * ما فيه أرقام (RSRP/SINR/تردد/برج) — هذي في admin/status/nr، نضيفها لما توصل صفحتها. ما نخترع أرقام من الشرطات.
   */
  private async icons(): Promise<{ mode?: string; signal?: string; status?: string; sms_num?: string } | null> {
    try {
      const r = await http(`${this.base()}${this.root()}/admin/status/nr_icons`, {}, 8000);
      const t = await r.text();
      if (/name=["']?luci_password/i.test(t)) throw new Error('انتهت الجلسة');
      const j = JSON.parse(t);
      return j && typeof j === 'object' ? j : null;
    } catch (e) {
      if (String((e as any)?.message ?? '').includes('انتهت الجلسة')) throw e;
      return null;
    }
  }

  /** Pro7: admin/status/nr?status=1 ← JSON بالأرقام (pro7.ts). null لو الراوتر ما عنده هالصفحة (LuCI ثاني) */
  private async status(): Promise<Pro7Status | null> {
    try {
      const r = await http(`${this.base()}${this.root()}/admin/status/nr?status=1`, {}, 12000);
      const t = await r.text();
      if (/name=["']?luci_password/i.test(t)) throw new Error('انتهت الجلسة');
      const j = JSON.parse(t);
      return j && typeof j === 'object' ? j as Pro7Status : null;
    } catch (e) {
      if (String((e as any)?.message ?? '').includes('انتهت الجلسة')) throw e;
      return null;
    }
  }

  async getSignal(): Promise<Signal> {
    const j = await this.status();
    if (j) return pro7Signal(j);
    // احتياط: نوع الشبكة بس من أيقونات الهيدر
    const st = await this.icons();
    return { network: pro7Network(st?.mode), nrActiveFromStatus: /NR5G|^5G$/i.test(String(st?.mode ?? '')) || undefined };
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const j = await this.status();
    if (j) {
      const ds = String(j.data_status ?? '').toUpperCase();
      return {
        operator: String(j.name ?? '').trim() || undefined,
        connected: ds === 'CONNECT' ? true : ds === 'DISCONNECT' ? false : undefined,
        mode: pro7Network(j.mode), supports5g: true,
      };
    }
    const st = await this.icons();
    return { mode: pro7Network(st?.mode), supports5g: true };
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const sig = await this.getSignal();
    return buildSnapshot(sig, [], [], { driverId: this.id, driverName: this.name });
  }
}
