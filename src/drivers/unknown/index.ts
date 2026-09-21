import { RouterDriver, Capability, Signal, SignalSnapshot } from '../types';
import { http } from '../http';
import { isLanHost } from '../../utils/host';
import {
  detectSignatureScheme, tryStrategies, LoginStrategy,
} from '../../utils/authStrategy';
import { buildSnapshot } from '../../utils/snapshot';

/**
 * درايفر احتياطي لأي راوتر لم يتعرّف عليه الريجستري.
 *  - detect: صحيح فقط إذا فيه صفحة HTML فيها حقل كلمة مرور.
 *  - login: يجرّب LOGIN_STRATEGIES (Basic / ZTE SHA256+LD / Form Post) — محاولة واحدة لكل واحدة.
 *  - لا قدرات قراءة إشارة (غير معروفة) — getSignal/getCarriers غير معرّفة.
 */
export class UnknownDriver implements RouterDriver {
  id = 'unknown';
  name = 'راوتر غير معروف';
  capabilities: Capability[] = ['signal'];

  private host = '';

  /** يفتح الصفحة الرئيسية ويبحث عن حقل كلمة مرور — مؤشر موثوق لصفحة دخول. */
  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    try {
      const base = host.startsWith('http') ? host.replace(/\/+$/, '') : 'http://' + host.replace(/\/+$/, '');
      const res = await http(base + '/', {}, 4000);
      if (res.status >= 400) return false;
      const txt = await res.text();
      return /<input[^>]*type\s*=\s*["']password/i.test(txt);
    } catch {
      return false;
    }
  }

  async login(host: string, username: string, password: string): Promise<void> {
    if (!isLanHost(host)) {
      throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    }
    this.host = host;
    const base = host.startsWith('http') ? host.replace(/\/+$/, '') : 'http://' + host.replace(/\/+$/, '');
    let homeHtml = '';
    try {
      const res = await http(base + '/', {}, 5000);
      if (res.status >= 400) throw new Error('صفحة الراوتر ما رجعت محتوى');
      homeHtml = await res.text();
    } catch {
      throw new Error('تعذّر الوصول إلى صفحة الراوتر');
    }
    const scheme = detectSignatureScheme(homeHtml);
    const result = await tryStrategies({
      host: base, user: username, pass: password, homeHtml, scheme,
    });
    if (!result.ok) {
      throw new Error('ما نجحنا ندخل على هذا الراوتر — جرّب من لوحة الراوتر مباشرة');
    }
  }

  async logout(): Promise<void> {
    // ما نعرف نمط تسجيل الخروج لهذا الراوتر
  }

  /** Snapshot فارغ — هذا الدرايفر لا يقرأ إشارة، فقط يصادق. */
  async getSnapshot(): Promise<SignalSnapshot> {
    return buildSnapshot(null, [], [], { driverId: this.id, driverName: this.name });
  }
}

// إشارة للـ TypeScript أن الاستراتيجيات متاحة للاستيراد من الخارج إن لزم
export type { LoginStrategy };
