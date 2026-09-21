// استراتيجيات مصادقة للأجهزة المجهولة.
// محاولة واحدة فقط لكل استراتيجية — بدون أي brute-force.
import { http } from '../drivers/http';
import { md5 } from '@noble/hashes/legacy';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { isLanHost } from './host';

export type SignatureScheme =
  | 'basic'
  | 'md5'
  | 'sha256'
  | 'sha256-upper'
  | 'sha256-ld'
  | 'sha256-upper-ld'
  | 'unknown';

const sha256Upper = (s: string) => bytesToHex(sha256(utf8ToBytes(s))).toUpperCase();

/** يستنتج نمط التشفير المحتمل من محتوى JS/HTML. أفضل-جهد، مو ضمانة. */
export function detectSignatureScheme(js: string): SignatureScheme {
  if (!js) return 'unknown';
  if (/sha256\s*\(\s*sha256/i.test(js)) return 'sha256-upper-ld';
  if (/sha256Upper\s*\(\s*sha256Upper/i.test(js)) return 'sha256-upper-ld';
  if (/sha256[^\n]{0,80}?toUpperCase\s*\(\s*\)\s*\+\s*[A-Za-z_$]/i.test(js)) return 'sha256-upper';
  if (/sha256\s*\([^)]*\bLD\b/i.test(js) || /\bLD\b[^)]*?sha256/i.test(js)) return 'sha256-ld';
  if (/sha256/i.test(js)) return 'sha256';
  if (/\bmd5\b/i.test(js)) return 'md5';
  if (/btoa\s*\(/.test(js) && /password|passwd|pass\b/i.test(js)) return 'basic';
  return 'unknown';
}

export interface FormInfo {
  action: string;
  method: 'get' | 'post';
  userField?: string;
  passField?: string;
  extraHidden: Record<string, string>;
}

/** يستخرج كل الفورمات التي فيها حقل كلمة مرور، مع action/حقول. */
export function discoverFormFields(html: string): FormInfo[] {
  const out: FormInfo[] = [];
  if (!html) return out;
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  for (const fm of html.matchAll(formRe)) {
    const attrs = fm[1] ?? '';
    const inner = fm[2] ?? '';
    const action = attrs.match(/\baction\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    const methodRaw = (attrs.match(/\bmethod\s*=\s*["']([^"']*)["']/i)?.[1] ?? 'get').toLowerCase();
    const method: 'get' | 'post' = methodRaw === 'post' ? 'post' : 'get';
    let userField: string | undefined;
    let passField: string | undefined;
    const extraHidden: Record<string, string> = {};
    for (const im of inner.matchAll(/<input\b([^>]*)\/?>/gi)) {
      const ia = im[1] ?? '';
      const name = ia.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!name) continue;
      const type = (ia.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] ?? 'text').toLowerCase();
      const value = ia.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
      if (type === 'password') passField = name;
      else if ((type === 'text' || type === 'email') && !userField) userField = name;
      else if (type === 'hidden') extraHidden[name] = value;
    }
    if (passField) out.push({ action, method, userField, passField, extraHidden });
  }
  return out;
}

export interface LoginContext {
  /** العنوان المحلي (بدون scheme إن أمكن). */
  host: string;
  user: string;
  pass: string;
  /** محتوى الصفحة الرئيسية — للتحليل الداخلي فقط، لا يُعرض ولا يُحفظ. */
  homeHtml: string;
  scheme: SignatureScheme;
  /** معرّف استراتيجية نجحت سابقاً (من ذاكرة الاستكشاف) — تُجرَّب أولاً. */
  preferredStrategyId?: string;
}

export interface LoginStrategy {
  id: string;
  label: string;
  /** محاولة واحدة فقط. ترجع true عند النجاح، false عند الفشل، ولا ترمي أبداً. */
  tryLogin(ctx: LoginContext): Promise<boolean>;
}

function baseOf(h: string): string {
  const s = h.replace(/\/+$/, '');
  return s.startsWith('http') ? s : 'http://' + s;
}

/** يمنع تحويل action إلى عنوان خارجي حتى لو جاء من HTML غير موثوق. */
function resolveLocal(base: string, action: string): string | null {
  const a = (action ?? '').trim();
  if (!a) return base + '/';
  if (/^https?:\/\//i.test(a)) return a.startsWith(base) ? a : null;
  if (a.startsWith('//')) return null;
  if (a.startsWith('/')) return base + a;
  return base + '/' + a.replace(/^\.\//, '');
}

const basicStrategy: LoginStrategy = {
  id: 'basic',
  label: 'Basic Auth',
  async tryLogin(ctx) {
    try {
      const token = btoa(`${ctx.user}:${ctx.pass}`);
      const res = await http(baseOf(ctx.host) + '/', {
        headers: { Authorization: `Basic ${token}` },
      });
      if (res.status !== 200) return false;
      const www = (res.headers.get('www-authenticate') ?? '').toLowerCase();
      return !www.startsWith('basic');
    } catch { return false; }
  },
};

const zteShaStrategy: LoginStrategy = {
  id: 'zte-sha256-ld',
  label: 'SHA256 + LD',
  async tryLogin(ctx) {
    try {
      const base = baseOf(ctx.host);
      const ldRes = await http(base + '/goform/goform_get_cmd_process?isTest=false&cmd=LD', {}, 5000);
      if (!ldRes.ok) return false;
      const txt = await ldRes.text();
      let ld = '';
      try {
        const j = JSON.parse(txt) as Record<string, unknown>;
        ld = typeof j.LD === 'string' ? j.LD : '';
      } catch { return false; }
      if (!ld) return false;
      const p1 = sha256Upper(ctx.pass);
      const p2 = sha256Upper(p1 + ld.toUpperCase());
      const body = `isTest=false&goformId=LOGIN&password=${encodeURIComponent(p2)}`;
      const res = await http(base + '/goform/goform_set_cmd_process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const out = await res.text();
      return /"result"\s*:\s*"?0"?/.test(out);
    } catch { return false; }
  },
};

const formPostStrategy: LoginStrategy = {
  id: 'form-post',
  label: 'Form Post',
  async tryLogin(ctx) {
    const forms = discoverFormFields(ctx.homeHtml);
    if (!forms.length) return false;
    const form = forms[0];
    if (!form.passField) return false;
    const base = baseOf(ctx.host);
    const url = resolveLocal(base, form.action);
    if (!url) return false;

    const variants: string[] = [];
    switch (ctx.scheme) {
      case 'md5':
        variants.push(bytesToHex(md5(utf8ToBytes(ctx.pass))));
        break;
      case 'sha256':
        variants.push(bytesToHex(sha256(utf8ToBytes(ctx.pass))));
        break;
      case 'sha256-upper':
        variants.push(sha256Upper(ctx.pass));
        break;
      case 'basic':
        try { variants.push(btoa(ctx.pass)); } catch {}
        break;
      default:
        break;
    }
    variants.push(ctx.pass);

    for (const candidate of variants) {
      try {
        const fields: Record<string, string> = { ...form.extraHidden };
        if (form.userField) fields[form.userField] = ctx.user;
        fields[form.passField] = candidate;
        const body = Object.entries(fields)
          .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
          .join('&');
        const res = await http(url, {
          method: form.method === 'post' ? 'POST' : 'GET',
          headers: form.method === 'post'
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : undefined,
          body: form.method === 'post' ? body : undefined,
        });
        if (res.status >= 400) continue;
        const out = await res.text();
        if (/<input[^>]*type\s*=\s*["']password/i.test(out)) continue;
        if (/incorrect|invalid|wrong\s+password|كلمة المرور غير صحيحة/i.test(out)) continue;
        return true;
      } catch { /* جرّب النسخة التالية */ }
    }
    return false;
  },
};

/** الاستراتيجيات بترتيب الأولوية. */
export const LOGIN_STRATEGIES: LoginStrategy[] = [
  zteShaStrategy,
  formPostStrategy,
  basicStrategy,
];

/**
 * يجرّب الاستراتيجيات بترتيبها، محاولة واحدة لكل واحدة، ويرجع أول نجاح.
 * إذا كان فيه preferredStrategyId (من ذاكرة الاستكشاف) → يُجرَّب أولاً.
 * لا يخزّن أي شي — كلمة المرور تبقى في الذاكرة العابرة فقط.
 */
export async function tryStrategies(
  ctx: LoginContext,
): Promise<{ ok: boolean; strategyId?: string }> {
  if (!isLanHost(ctx.host)) return { ok: false };

  const ordered = [...LOGIN_STRATEGIES];
  if (ctx.preferredStrategyId) {
    const idx = ordered.findIndex(s => s.id === ctx.preferredStrategyId);
    if (idx > 0) {
      const [pref] = ordered.splice(idx, 1);
      ordered.unshift(pref);
    }
  }

  for (const s of ordered) {
    try {
      const ok = await s.tryLogin(ctx);
      if (ok) return { ok: true, strategyId: s.id };
    } catch { /* تجاهل — نجرّب التالية */ }
  }
  return { ok: false };
}
