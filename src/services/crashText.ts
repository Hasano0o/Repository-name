/** نص الانهيار (دالة صافية — تنختبر بدون react-native): النوع والرسالة + الشاشة + أول ٣ سطور من مكان الخطأ */
export function crashText(error: unknown, screen: string): string {
  const e: any = error;
  const isObj = e !== null && typeof e === 'object';
  const name = String((isObj && e.name) || 'Error');
  const msg = String(isObj ? (e.message ?? '') : (e ?? '')).replace(/\s+/g, ' ').trim();
  const frames = String((isObj && e.stack) || '')
    .split('\n').map(s => s.trim()).filter(Boolean)
    .filter(s => !s.startsWith(name + ':') && s !== msg)
    .slice(0, 3)
    .map(s => s.replace(/https?:\/\/[^\s)]+\//g, '').replace(/\s+/g, ' ').slice(0, 70));
  const out = `${name}: ${msg || '—'} · شاشة ${screen || 'الرئيسية'}${frames.length ? ' · ' + frames.join(' ← ') : ''}`;
  return out.slice(0, 280);
}
