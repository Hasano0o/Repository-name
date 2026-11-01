/**
 * نموذج LuCI القديم (CBI) — نقرأه من صفحة الراوتر الحية ونرسله **مثل المتصفح بالضبط**.
 *
 * ليش كذا: صفحات Pro7 (modem/band · modem/network · modem/cell) نماذج CBI عادية (form name="cbi"، multipart).
 * LuCI يمسح أي خانة ما وصلت في الإرسال (rmempty) — فلازم نرسل كل خانات النموذج بقيمها الحالية ونغيّر اللي نبيه بس.
 * القيم نفسها (قيمة كل مربع تردد، cbi.submit، الرمز لو فيه) ناخذها من الصفحة الحية — ما نخمّن ولا وحدة.
 *
 * قواعد المتصفح اللي نطبقها:
 *  • text/hidden/password ← الاسم=القيمة · checkbox ← بس لو مؤشّر (القيمة أو "on") · select ← المختار (أو أول خيار)
 *  • disabled ما ينرسل · button/submit ما ينرسل إلا زر الحفظ (cbi.apply) · بدون اسم ما ينرسل
 *  • cbi_d_add (خانات مشروطة): لو الشرط ما تحقق، cbi.js يشيلها من الصفحة ← ما تنرسل
 *
 * ملف صافي بدون react-native — عشان الاختبارات تشتغل في Node.
 */

export interface CbiField {
  name: string;
  type: 'text' | 'hidden' | 'password' | 'checkbox' | 'select' | 'submit' | 'other';
  value: string;
  checked: boolean;
  disabled: boolean;
  id: string;
  /** select بس */
  options?: { value: string; label: string }[];
  /** نص <label for=id> (أرقام الترددات في المربعات) */
  label: string;
  /** مكانه في الصفحة (للخانات المشروطة) */
  pos: number;
}

export interface CbiForm {
  action: string;
  fields: CbiField[];
  /** أسماء خانات مشيلة لأن شرطها (cbi_d_add) ما تحقق */
  dropped: string[];
}

/** الحالة القابلة للتغيير: مربعات مفردة (تشغيل/إطفاء) · قوائم مربعات · قيم نص/اختيار */
export interface CbiState {
  flags: Record<string, boolean>;
  multi: Record<string, string[]>;
  vals: Record<string, string>;
}

export function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = tag.replace(/^<\w+/, '').replace(/\/?>$/, '');
  const re = /([\w.:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out[m[1].toLowerCase()] = decodeHtml(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/** يقرأ نموذج CBI من الصفحة. null لو ما فيه نموذج */
export function parseCbiForm(html: string): CbiForm | null {
  const fm = html.match(/<form\b[^>]*\bname=["']?cbi["']?[^>]*>/i) ?? html.match(/<form\b[^>]*>/i);
  if (!fm || fm.index === undefined) return null;
  const start = fm.index;
  const endI = html.indexOf('</form>', start);
  const src = html.slice(start, endI > 0 ? endI : undefined);
  const action = attrs(fm[0]).action ?? '';

  const labels: Record<string, string> = {};
  for (const m of src.matchAll(/<label\b([^>]*)>([^<]*)/gi)) {
    const f = attrs('<label' + m[1] + '>').for;
    if (f) labels[f] = decodeHtml(m[2]).trim();
  }

  const fields: CbiField[] = [];
  const re = /<(input|select|textarea)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const tag = m[1].toLowerCase();
    const a = attrs(m[0]);
    const base = { name: a.name ?? '', id: a.id ?? '', disabled: 'disabled' in a, label: labels[a.id ?? ''] ?? '', pos: m.index };
    if (tag === 'select') {
      const close = src.indexOf('</select>', m.index);
      const inner = src.slice(m.index, close > 0 ? close : undefined);
      const options: { value: string; label: string }[] = [];
      let sel = '';
      for (const o of inner.matchAll(/<option\b([^>]*)>([^<]*)/gi)) {
        const oa = attrs('<option' + o[1] + '>');
        const label = decodeHtml(o[2]).trim();
        const value = 'value' in oa ? oa.value : label;
        options.push({ value, label });
        if ('selected' in oa) sel = value;
      }
      fields.push({ ...base, type: 'select', value: sel || options[0]?.value || '', checked: false, options });
    } else if (tag === 'textarea') {
      const close = src.indexOf('</textarea>', m.index);
      const value = decodeHtml(src.slice(m.index + m[0].length, close > 0 ? close : undefined));
      fields.push({ ...base, type: 'text', value, checked: false });
    } else {
      const t = (a.type ?? 'text').toLowerCase();
      const type: CbiField['type'] = t === 'text' || t === 'hidden' || t === 'password' || t === 'checkbox' || t === 'submit'
        ? t : t === 'number' || t === 'email' || t === 'tel' ? 'text' : 'other';
      fields.push({ ...base, type, value: 'value' in a ? a.value : (type === 'checkbox' ? 'on' : ''), checked: 'checked' in a });
    }
  }

  // الخانات المشروطة: cbi_d_add("cbi-…", {"cbid.x.y.z":"v"}, …)
  const dropped: string[] = [];
  const valueOf = (name: string) => {
    const f = fields.filter(x => x.name === name);
    if (!f.length) return undefined;
    if (f[0].type === 'checkbox') return f.some(x => x.checked) ? (f.find(x => x.checked)!.value) : '';
    return f[0].value;
  };
  for (const d of src.matchAll(/cbi_d_add\(\s*["']([^"']+)["']\s*,\s*(\{[^}]*\})/g)) {
    let deps: Record<string, string>;
    try { deps = JSON.parse(d[2]); } catch { throw new Error('خانات مشروطة ما نفهمها في صفحة الراوتر'); }
    const ok = Object.entries(deps).every(([k, v]) => valueOf(k) === String(v));
    if (ok) continue;
    const from = src.indexOf(`id="${d[1]}"`);
    const to = d.index ?? from;
    if (from < 0) continue;
    for (let i = fields.length - 1; i >= 0; i--) {
      const f = fields[i];
      if (f.pos > from && f.pos < to) { if (f.name) dropped.push(f.name); fields.splice(i, 1); }
    }
  }
  return { action, fields, dropped };
}

/** الخانات اللي تنرسل (cbid.* و cbi.cbe.* و cbi.submit والرمز…) */
const sendable = (f: CbiField) => !!f.name && !f.disabled && f.type !== 'submit' && f.type !== 'other';

/** المربعات المفردة (معها cbi.cbe.<name>) = تشغيل/إطفاء · الباقي قوائم */
export function cbiState(form: CbiForm): CbiState {
  const st: CbiState = { flags: {}, multi: {}, vals: {} };
  // LuCI: cbi.cbe.<config.section.option> يرافق cbid.<config.section.option>
  const cbe = new Set(form.fields.filter(f => f.name.startsWith('cbi.cbe.')).map(f => 'cbid.' + f.name.slice(8)));
  const groups: Record<string, CbiField[]> = {};
  for (const f of form.fields) {
    if (!f.name.startsWith('cbid.') || !sendable(f)) continue;
    if (f.type === 'checkbox') (groups[f.name] ??= []).push(f);
    else st.vals[f.name] = f.value.trim();
  }
  for (const [n, g] of Object.entries(groups)) {
    if (g.length === 1 && cbe.has(n)) st.flags[n] = g[0].checked;
    else st.multi[n] = g.filter(x => x.checked).map(x => x.value);
  }
  return st;
}

/** المربعات في قائمة ← {الرقم المكتوب جنبها، قيمتها، مؤشّر؟} */
export function cbiChoices(form: CbiForm, name: string): { label: string; value: string; checked: boolean }[] {
  return form.fields.filter(f => f.name === name && f.type === 'checkbox').map(f => ({ label: f.label, value: f.value, checked: f.checked }));
}

/** يطبّق تغييرات على نسخة من النموذج — يرمي لو خانة أو قيمة مو موجودة في الصفحة (ما نرسل شي) */
export function cbiApply(form: CbiForm, ch: Partial<CbiState>): CbiForm {
  const fields = form.fields.map(f => ({ ...f }));
  for (const [n, on] of Object.entries(ch.flags ?? {})) {
    const f = fields.filter(x => x.name === n && x.type === 'checkbox');
    if (f.length !== 1) throw new Error(`الخانة ${n} مو موجودة في صفحة الراوتر`);
    f[0].checked = on;
  }
  for (const [n, vals] of Object.entries(ch.multi ?? {})) {
    const f = fields.filter(x => x.name === n && x.type === 'checkbox');
    if (!f.length) throw new Error(`القائمة ${n} مو موجودة في صفحة الراوتر`);
    for (const v of vals) if (!f.some(x => x.value === v)) throw new Error(`القيمة ${v} مو موجودة في ${n}`);
    for (const x of f) x.checked = vals.includes(x.value);
  }
  for (const [n, v] of Object.entries(ch.vals ?? {})) {
    const f = fields.find(x => x.name === n && sendable(x) && x.type !== 'checkbox');
    if (!f) throw new Error(`الخانة ${n} مو موجودة في صفحة الراوتر`);
    if (f.type === 'select' && !f.options?.some(o => o.value === v)) throw new Error(`الخيار ${v} مو موجود في ${n}`);
    f.value = v;
  }
  return { ...form, fields };
}

/** وش ينرسل بالضبط (بالترتيب) — مع زر «حفظ وتطبيق» (cbi.apply) من الصفحة نفسها */
export function cbiPairs(form: CbiForm): [string, string][] {
  const out: [string, string][] = [];
  for (const f of form.fields) {
    if (!sendable(f)) continue;
    if (f.type === 'checkbox') { if (f.checked) out.push([f.name, f.value]); continue; }
    out.push([f.name, f.value]);
  }
  const apply = form.fields.find(f => f.type === 'submit' && f.name === 'cbi.apply' && !f.disabled);
  if (!apply) throw new Error('ما لقينا زر الحفظ (cbi.apply) في صفحة الراوتر');
  out.push([apply.name, apply.value]);
  return out;
}

/** multipart/form-data مثل المتصفح (enctype النموذج) */
export function multipart(pairs: [string, string][], boundary = '----BandlyLuci' + Math.random().toString(16).slice(2, 12)): { body: string; type: string } {
  const esc = (s: string) => s.replace(/"/g, '%22').replace(/\r?\n/g, ' ');
  let body = '';
  for (const [n, v] of pairs) body += `--${boundary}\r\nContent-Disposition: form-data; name="${esc(n)}"\r\n\r\n${v}\r\n`;
  body += `--${boundary}--\r\n`;
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}

/** الفرق بين حالتين (بس الخانات اللي في want) — فاضي = متطابق */
export function cbiDiff(cur: CbiState, want: Partial<CbiState>): string[] {
  const bad: string[] = [];
  for (const [n, on] of Object.entries(want.flags ?? {})) if (!!cur.flags[n] !== on) bad.push(n);
  for (const [n, v] of Object.entries(want.multi ?? {})) {
    const c = cur.multi[n] ?? [];
    if (c.length !== v.length || !v.every(x => c.includes(x))) bad.push(n);
  }
  for (const [n, v] of Object.entries(want.vals ?? {})) if ((cur.vals[n] ?? '').trim() !== String(v).trim()) bad.push(n);
  return bad;
}
