/** يمنع إرسال كلمة مرور الراوتر لأي عنوان خارج الشبكة المحلية */

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

export function hostOnly(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, '').split(/[/?#]/)[0].split(':')[0];
}

export function isLanHost(raw: string): boolean {
  const h = hostOnly(raw).toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home')) return true;
  if (/^[\d.]+$/.test(h)) return PRIVATE_V4.some(re => re.test(h));
  // أسماء بدون نقطة (مثل routerlogin) تعتبر محلية
  return !h.includes('.');
}

export function assertLanHost(raw: string): void {
  if (!isLanHost(raw)) {
    throw new Error('عنوان الراوتر لازم يكون داخل شبكتك المحلية (مثل 192.168.8.1) — ما نرسل كلمة المرور لأي عنوان خارجي.');
  }
}
