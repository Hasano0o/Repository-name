/**
 * رسائل ZTE الجيل الجديد (zwrt_wms عبر ubus) — من service_rpc.js في ملفات FULL أعضاء (١٨ و٢٠ نوفمبر ٢٠٢٦):
 *   القراءة: zwrt_wms.zte_libwms_get_sms_data {page, data_per_page, mem_store, tags, order_by} ← messages[]
 *            كل رسالة: id · number · content (UTF-16BE hex) · date ("26,11,21,14,30,00,+12") · tag · received_all_concat_sms
 *   الإرسال: zwrt_wms.zte_libwms_send_sms {number, sms_time, message_body, id:"-1", encode_type}
 *   الحذف:   zwrt_wms.zwrt_wms_delete_sms {id:"5;6;"}
 *   مقروءة:  zwrt_wms.zwrt_wms_modify_tag {id:"5;", tag:0}
 *   بعد الإرسال/الحذف الصفحة تسأل zwrt_wms.zwrt_wms_get_cmd_status {sms_cmd: 4 إرسال | 6 حذف} كل ثانية:
 *            sms_cmd_status_result 3 = تم · 2 = فشل · غيره = لسا.
 * دوال صافية هنا (بدون شبكة) عشان تنختبر.
 */

export const ucs2Hex = (t: string): string => {
  let out = '';
  for (let i = 0; i < t.length; i++) out += t.charCodeAt(i).toString(16).padStart(4, '0');
  return out.toUpperCase();
};

export const fromUcs2Hex = (h: string): string => {
  if (!h || h.length % 4 !== 0 || !/^[0-9a-fA-F]+$/.test(h)) return h ?? '';
  let out = '';
  for (let i = 0; i < h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
  return out;
};

/** "26,11,21,14,30,00,+12" (أو بفواصل ;) ← "2026-11-21 14:30" */
export const ngSmsDate = (d: string): string => {
  const f = String(d ?? '').split(/[,;]/).map(x => x.trim());
  if (f.length < 5 || !f.slice(0, 5).every(x => /^\d+$/.test(x))) return d ?? '';
  const p = (x: string) => x.padStart(2, '0');
  return `20${p(f[0])}-${p(f[1])}-${p(f[2])} ${p(f[3])}:${p(f[4])}`;
};

/** وقت الإرسال بصيغة صفحة ZTE (getCurrentTimeString): yy;MM;dd;HH;mm;ss;+3 */
export const ngSmsNow = (d = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  const tz = -d.getTimezoneOffset() / 60;
  return [p(d.getFullYear() % 100), p(d.getMonth() + 1), p(d.getDate()), p(d.getHours()), p(d.getMinutes()), p(d.getSeconds())]
    .join(';') + ';' + (tz >= 0 ? '+' : '') + tz;
};

/** قائمة الأرقام بصيغة الصفحة: "5;6;" */
export const idList = (ids: string[]): string => ids.filter(Boolean).map(x => x + ';').join('');

export interface NgSms { index: string; phone: string; content: string; date: string; unread: boolean; }

/** tag: 0 مقروءة · 1 جديدة · 2 مرسلة · 3 مسودة/مرسلة (نفس تقسيم درايفر ZTE القديم) */
export function parseNgSms(raw: unknown, box: 'inbox' | 'sent'): NgSms[] {
  const msgs = Array.isArray((raw as any)?.messages) ? (raw as any).messages as Record<string, unknown>[] : [];
  const want = box === 'inbox' ? ['0', '1'] : ['2', '3'];
  const out: NgSms[] = [];
  for (const m of msgs) {
    const tag = String(m?.tag ?? '');
    const index = String(m?.id ?? '').trim();
    if (!index || !want.includes(tag)) continue;
    out.push({
      index,
      // الرقم يجي نص عادي — ما نفكّه (رقم ١٢ خانة يطابق شكل hex ويتخرّب)
      phone: String(m.number ?? '').trim(),
      content: fromUcs2Hex(String(m.content ?? '')),
      date: ngSmsDate(String(m.date ?? '')),
      unread: tag === '1',
    });
  }
  // الأحدث أول (الراوتر يرتّب بـ order_by بس نضمنها)
  return out.sort((a, b) => (Number(b.index) || 0) - (Number(a.index) || 0));
}

/** نتيجة zwrt_wms_get_cmd_status: 'ok' | 'fail' | 'wait' */
export function cmdState(r: unknown): 'ok' | 'fail' | 'wait' {
  const v = String((r as any)?.sms_cmd_status_result ?? '');
  return v === '3' ? 'ok' : v === '2' ? 'fail' : 'wait';
}
