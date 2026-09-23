/**
 * حماية: يمنع إرسال كلمة مرور الراوتر لأي عنوان خارج الشبكة المحلية.
 * يعتمد على RFC 1918 (v4) و RFC 4193 (v6 unique local).
 */

// عناوين IPv4 مرفوضة صراحةً (خطيرة)
const REJECTED_V4 = [
  /^0\.0\.0\.0$/,
  /^255\.255\.255\.255$/,
];

// عناوين IPv4 محلية (RFC 1918 + loopback + link-local)
const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

// عناوين IPv6 مرفوضة صراحةً
const REJECTED_V6 = [
  /^::$/i,             // unspecified
  /^::1$/i,            // loopback — نرفضه لأن بعض المنصات تسربه للخارج
  /^::ffff:/i,         // IPv4-mapped — قد يتجاوز فحوصات أخرى
];

// عناوين IPv6 محلية (link-local + unique local)
const PRIVATE_V6 = [
  /^fe80:/i,           // link-local
  /^f[cd][0-9a-f]{2}:/i, // fc00::/7 unique local
];

const LOCAL_SUFFIXES = ['.local', '.lan', '.home', '.internal'];

export function hostOnly(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^\/+/, '')
    .split(/[/?#]/)[0]
    .split(':')[0] || raw.trim().split(':')[0];
}

export function isLanHost(raw: string): boolean {
  const h = hostOnly(raw).toLowerCase();
  if (!h) return false;

  // رفض العناوين الخطيرة
  if (REJECTED_V4.some(re => re.test(h))) return false;
  if (REJECTED_V6.some(re => re.test(h))) return false;

  // IPv4 خاص
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    return PRIVATE_V4.some(re => re.test(h));
  }

  // IPv6 عام: يبدأ بـ `[` أو فيه `:` — نرفض كل ما ليس في القوائم الخاصة
  if (h.includes(':')) {
    return PRIVATE_V6.some(re => re.test(h));
  }

  // localhost وأسماء شائعة
  if (h === 'localhost') return true;
  if (LOCAL_SUFFIXES.some(s => h.endsWith(s))) return true;

  // أسماء بدون نقطة (مثل `routerlogin`) — مقصود لدعم بعض الراوترات
  // لكنها خطر إن كان هناك DNS search domain. نبقيها لأن الميزة تحتاجها.
  return !h.includes('.');
}

export function assertLanHost(raw: string): void {
  if (!isLanHost(raw)) {
    throw new Error(
      'عنوان الراوتر لازم يكون داخل شبكتك المحلية (مثل 192.168.8.1) — ما نرسل كلمة المرور لأي عنوان خارجي.',
    );
  }
}
