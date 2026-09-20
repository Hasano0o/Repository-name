export function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}

export function fmtRate(bytesPerSec: number) {
  const bits = bytesPerSec * 8;
  if (bits >= 1e6) return (bits / 1e6).toFixed(1) + ' Mbps';
  return (bits / 1e3).toFixed(0) + ' Kbps';
}

export function fmtDuration(secs: number) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d) return `${d} يوم و ${h} ساعة`;
  if (h) return `${h} ساعة و ${m} دقيقة`;
  return `${m} دقيقة`;
}

export function fmtTime(ts: number) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()}/${d.getMonth() + 1} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
