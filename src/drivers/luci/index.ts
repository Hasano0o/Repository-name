import { RouterDriver, Capability, SignalSnapshot } from '../types';
import { http } from '../http';
import { isLanHost } from '../../utils/host';
import { buildSnapshot } from '../../utils/snapshot';

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
  readonly capabilities: Capability[] = [];
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

  /** صفحات بعد الدخول للجامع (FULL): الرئيسية والحالة والشبكة — ومنها يلحق روابط القائمة */
  afterLoginPages(): string[] {
    const r = this.root();
    return [`${r}/`, `${r}/admin`, `${r}/admin/status/overview`, `${r}/admin/network`];
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

  /** ما نقرأ إشارة للحين (صفحاتها تختلف حسب المصنّع) */
  async getSnapshot(): Promise<SignalSnapshot> {
    return buildSnapshot(null, [], [], { driverId: this.id, driverName: this.name });
  }
}
