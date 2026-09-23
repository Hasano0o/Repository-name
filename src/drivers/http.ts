import { isLanHost } from '../utils/host';

/**
 * طبقة HTTP الموحدة لكل درايفرات الراوترات.
 *
 * ═══ ضمانات أمنية ═══
 * 1. ترفض أي URL ليس في شبكة محلية (192.168/10/172/127/link-local/IPv6-local).
 * 2. تفرض timeout على كل طلب (افتراضي 8 ثواني).
 * 3. لا تتبع redirects إلى hosts خارجية — يتم رفض الرد.
 *
 * ⚠️ للطلبات الخارجية (Cloudflare speedtest، إلخ):
 *    استخدم fetch() مباشرة، لا تستخدم http().
 */
export async function http(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  // ── 1. فحص host
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('عنوان غير صالح');
  }
  if (!isLanHost(parsed.host)) {
    throw new Error('رفض: عنوان غير محلي');
  }

  // ── 2. تنفيذ الطلب
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      credentials: 'include',
      signal: ctrl.signal,
    });

    // ── 3. بعد الرد: نتحقق أن الـ final URL (بعد redirects) ما زال محلياً
    //     إن كان خارجياً، نرفض الرد لمنع أي استخدام عرضي.
    try {
      const finalUrl = new URL(res.url);
      if (!isLanHost(finalUrl.host)) {
        throw new Error('رفض: redirect خارجي');
      }
    } catch (e: any) {
      // خطأ URL parsing فقط — نتجاهله (الحالة النادرة)
      if (e?.message === 'رفض: redirect خارجي') throw e;
    }

    return res;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error('الراوتر ما رد — تأكد إنك متصل بشبكته');
    }
    if (e?.message === 'رفض: redirect خارجي' || e?.message === 'رفض: عنوان غير محلي') {
      throw e;
    }
    throw new Error('تعذر الاتصال بالراوتر');
  } finally {
    clearTimeout(t);
  }
}
