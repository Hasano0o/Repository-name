/**
 * وضع التشخيص: سجل دائري لآخر ما صار بين التطبيق والراوتر — يوصل للمطوّر كملف
 * (تلقائي مع الأخطاء المهمة، أو بزر «أرسل تشخيص» في الإعدادات).
 *
 * ═══ الخصوصية ═══
 * ما نسجّل أي جسم طلب (كلمات السر، أسماء الشبكات، الأرقام…) ولا محتوى الردود —
 * بس: المسار، اسم الأمر، حالة الرد، المدة، وكود الخطأ/النتيجة.
 */
const MAX = 400;
const buf: string[] = [];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
function ts() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function diag(line: string) {
  buf.push(`${ts()} ${line.replace(/\s+/g, ' ').slice(0, 240)}`);
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
}

/** الأوامر اللي فيها أسرار — ما نسجّل عنها إلا إنها صارت */
const SECRET_PATH = /login|authentication|challenge|password|wlan|wifi|sms|pin|ussd/i;

/** وصف مختصر لطلب HTTP — المسار واسم الأمر بس */
export function describeReq(url: string, init?: RequestInit): string {
  let path = url;
  try {
    const u = new URL(url);
    path = u.pathname;
    const cmd = u.searchParams.get('cmd');
    if (cmd) path += `?cmd=${cmd.split(',').slice(0, 6).join(',')}${cmd.split(',').length > 6 ? ',…' : ''}`;
  } catch {}
  const method = (init?.method || 'GET').toUpperCase();
  let extra = '';
  const body = typeof init?.body === 'string' ? init.body : '';
  const gf = body.match(/goformId=([A-Za-z0-9_]+)/)?.[1];
  if (gf) extra = ` goformId=${gf}`;
  // قيم آمنة نحتاجها للتشخيص (وضع الشبكة/التشغيل) — بدون أي شي ثاني
  for (const k of ['BearerPreference', 'operate_mode', 'NetworkMode', 'dataswitch', 'Action']) {
    const v = body.match(new RegExp(`(?:${k}=|<${k}>)([A-Za-z0-9_]{1,24})`))?.[1];
    if (v) extra += ` ${k}=${v}`;
  }
  return `${method} ${path}${extra}`;
}

/** من الرد: كود الخطأ أو النتيجة بس */
export function describeRes(url: string, text: string): string {
  const code = text.match(/<code>(\d+)<\/code>/)?.[1];
  if (code) return `err ${code}`;
  const result = text.match(/"result"\s*:\s*"([^"]{0,20})"/)?.[1];
  if (result !== undefined) return `result=${result}`;
  const st = text.match(/<State>(-?\d+)<\/State>/)?.[1];
  if (st !== undefined) return `State=${st}`;
  if (/<response>OK<\/response>/.test(text)) return 'OK';
  // حقول تشخيص آمنة من ZTE (حالة الشبكة والاتصال)
  if (!SECRET_PATH.test(url)) {
    const keys = ['ppp_status', 'network_type', 'modem_main_state', 'operate_mode', 'net_select'];
    const got = keys.map(k => {
      const v = text.match(new RegExp(`"${k}"\\s*:\\s*"([^"]{0,24})"`))?.[1];
      return v !== undefined ? `${k}=${v}` : '';
    }).filter(Boolean);
    if (got.length) return got.join(' ');
  }
  return `len=${text.length}`;
}

export function diagDump(header: string): string {
  return `${header}\n${'─'.repeat(40)}\n${buf.join('\n') || '(السجل فاضي)'}\n`;
}
