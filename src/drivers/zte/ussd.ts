/**
 * USSD لراوترات ZTE (goform) — من كود صفحة الراوتر نفسها (js/service.js، ملفات أعضاء ١٦ و٢١ نوفمبر):
 *  إرسال ... POST USSD_PROCESS  USSD_operator=ussd_send  USSD_send_number=<الكود>  notCallback=true
 *  رد ...... POST USSD_PROCESS  USSD_operator=ussd_reply USSD_reply_number=<رقم>
 *  إلغاء ... POST USSD_PROCESS  USSD_operator=ussd_cancel
 *  الحالة .. GET ussd_write_flag:  15 ينتظر · 16 وصل الرد · 1 ما فيه خدمة · 3/4/unknown مهلة
 *            10 أعد المحاولة · 99 ما يدعم · 41 العملية مو مدعومة · 2 الشبكة قطعت
 *  الرد .... GET ussd_data_info ← ussd_data (hex UCS2 غالباً) · ussd_action (1 = يبي رد) · ussd_dcs
 */

export type UssdFlag = 'wait' | 'ready' | { error: string };

export function ussdFlag(v: string | undefined): UssdFlag {
  switch ((v ?? '').trim()) {
    case '15': return 'wait';
    case '16': return 'ready';
    case '1': return { error: 'الشريحة ما عليها خدمة الحين — جرّب بعد شوي' };
    case '3': case '4': case 'unknown': return { error: 'الشبكة ما ردّت على الكود (انتهت المهلة)' };
    case '10': return { error: 'الشبكة مشغولة — جرّب مرة ثانية' };
    case '99': case '41': return { error: 'راوترك ما يدعم أكواد USSD' };
    case '2': return { error: 'الشبكة قطعت الجلسة' };
    case '': case '0': return 'wait';
    default: return { error: `الراوتر رفض الكود (${v})` };
  }
}

/** ussd_data: الصفحة تفكه كـ UCS2 hex (كل ٤ خانات حرف). لو مو hex نرجّعه كما هو. */
export function decodeUssd(data: string | undefined): string {
  const s = (data ?? '').trim();
  if (!s) return '';
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 4 === 0) {
    let out = '';
    for (let i = 0; i < s.length; i += 4) out += String.fromCharCode(parseInt(s.slice(i, i + 4), 16));
    return out.replace(/\u0000/g, '').trim();
  }
  return s;
}

export interface UssdIo {
  get(fields: string[]): Promise<Record<string, string>>;
  getRaw(field: string): Promise<Record<string, unknown> | null>;
  act(body: Record<string, string>): Promise<string>;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function zteUssd(io: UssdIo, code: string, timeoutMs = 30_000): Promise<string> {
  const c = code.trim();
  if (!/^[*#0-9]{2,40}$/.test(c)) throw new Error('الكود لازم يكون أرقام و * و # بس');
  const out = await io.act({ goformId: 'USSD_PROCESS', USSD_operator: 'ussd_send', USSD_send_number: c, notCallback: 'true' });
  if (!/success/i.test(out)) throw new Error('الراوتر رفض إرسال الكود');
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await sleep(1500);
    const f = await io.get(['ussd_write_flag']).catch(() => ({} as Record<string, string>));
    const st = ussdFlag(f.ussd_write_flag);
    if (st === 'wait') continue;
    if (st !== 'ready') throw new Error(st.error);
    // نفس طلب الصفحة: cmd=ussd_data_info (بدون multi_data)
    const d = (await io.getRaw('ussd_data_info').catch(() => null)) ?? {};
    const text = decodeUssd(typeof d.ussd_data === 'string' ? d.ussd_data : '');
    // الجلسة تبي رد (قائمة) — نقفلها عشان ما تعلّق الشريحة؛ الكود الجاي يبدأ جلسة جديدة
    if (String(d.ussd_action ?? '') === '1') await io.act({ goformId: 'USSD_PROCESS', USSD_operator: 'ussd_cancel' }).catch(() => {});
    return text || 'الشركة ما رجّعت نص.';
  }
  await io.act({ goformId: 'USSD_PROCESS', USSD_operator: 'ussd_cancel' }).catch(() => {});
  throw new Error('الشبكة ما ردّت على الكود خلال ٣٠ ثانية');
}
