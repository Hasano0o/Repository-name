import { RouterDriver, Capability, SignalSnapshot } from '../types';
import { http } from '../http';
import { isLanHost } from '../../utils/host';
import {
  detectSignatureScheme, tryStrategies, LoginStrategy,
} from '../../utils/authStrategy';
import { buildSnapshot } from '../../utils/snapshot';
import { markSuccess, getDiscovery } from '../../store/discovery';

/**
 * درايفر احتياطي لأي راوتر لم يتعرّف عليه الريجستري.
 *  - detect: صحيح فقط إذا فيه صفحة HTML فيها حقل كلمة مرور.
 *  - login: يستشير ذاكرة الاستكشاف أولاً، ثم يجرّب LOGIN_STRATEGIES.
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

    // ذاكرة الاستكشاف: لو نعرف استراتيجية ناجحة سابقاً لهذا الراوتر، جرّبها أولاً
    let knownStrategy: string | undefined;
    try {
      const memo = await getDiscovery(host);
      if (memo?.loginStrategy) knownStrategy = memo.loginStrategy;
    } catch { /* ذاكرة غير متوفرة — نكمل عادي */ }

    const result = await tryStrategies({
      host: base, user: username, pass: password, homeHtml, scheme,
      preferredStrategyId: knownStrategy,
    });

    if (!result.ok) {
      throw new Error('ما نجحنا ندخل على هذا الراوتر — جرّب من لوحة الراوتر مباشرة');
    }

    // سجّل نجاح الاتصال + معرّف الاستراتيجية (أسماء فقط — لا أسرار)
    try {
      await markSuccess(host, {
        loginStrategy: result.strategyId,
        apiStyle: 'unknown',
      });
    } catch { /* فشل التخزين لا يكسر الدخول */ }
  }

  async logout(): Promise<void> {
    // ما نعرف نمط تسجيل الخروج لهذا الراوتر
  }

  /** Snapshot فارغ — هذا الدرايفر لا يقرأ إشارة، فقط يصادق. */
  async getSnapshot(): Promise<SignalSnapshot> {
    return buildSnapshot(null, [], [], { driverId: this.id, driverName: this.name });
  }
}

export type { LoginStrategy };
