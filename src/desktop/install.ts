/**
 * في نسخة الويندوز: نوجّه طلبات fetch عبر البرنامج نفسه (عملية Electron الرئيسية)
 * بدل المتصفح — عشان ما يمنعنا CORS من صفحة الراوتر، وعشان الكوكيز وهيدر Referer
 * تشتغل مثل الجوال تماماً.
 * اختبار السرعة (Cloudflare) يبقى من المتصفح مباشرة عشان القياس يكون دقيق.
 * في الجوال: ما يسوي شي.
 */
import { Alert, Linking, Share } from 'react-native';
import { desktop } from './bridge';

const DIRECT_HOSTS = new Set(['speed.cloudflare.com']);

let nextId = 1;

async function bodyToBytes(body: any, headers: Headers): Promise<Uint8Array | string | undefined> {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) {
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
    }
    return body.toString();
  }
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    if (body.type && !headers.has('content-type')) headers.set('content-type', body.type);
    return new Uint8Array(await body.arrayBuffer());
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    // نخلي المتصفح يرمّز الـ multipart ثم ناخذ البايتات والهيدر الصحيح
    const r = new Request('http://x/', { method: 'POST', body });
    const ct = r.headers.get('content-type');
    if (ct) headers.set('content-type', ct);
    return new Uint8Array(await r.arrayBuffer());
  }
  return String(body);
}

function abortError() {
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    const e = new Error('The operation was aborted.');
    e.name = 'AbortError';
    return e;
  }
}

if (desktop && typeof globalThis.fetch === 'function') {
  const bridge = desktop;
  const original = globalThis.fetch.bind(globalThis);

  const desktopFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    let url: string;
    let method = init.method;
    let headers: Headers;
    let body: any = init.body;
    let signal = init.signal ?? undefined;

    if (typeof Request !== 'undefined' && input instanceof Request) {
      url = input.url;
      method = method ?? input.method;
      headers = new Headers(init.headers ?? input.headers);
      if (body == null && input.method !== 'GET' && input.method !== 'HEAD') {
        body = await input.clone().arrayBuffer();
      }
      signal = signal ?? input.signal;
    } else {
      url = String(input);
      headers = new Headers(init.headers);
    }

    let parsed: URL;
    try {
      parsed = new URL(url, location.href);
    } catch {
      return original(input as any, init);
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || DIRECT_HOSTS.has(parsed.hostname)) {
      return original(input as any, init);
    }

    if (signal?.aborted) throw abortError();

    const id = nextId++;
    const bytes = await bodyToBytes(body, headers);
    const hdrs: [string, string][] = [];
    headers.forEach((v, k) => hdrs.push([k, v]));

    const work = bridge.fetch(id, {
      url: parsed.toString(),
      method: (method || 'GET').toUpperCase(),
      headers: hdrs,
      body: bytes,
    });

    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      if (!signal) return;
      onAbort = () => {
        bridge.abort(id);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });

    try {
      const r = await Promise.race([work, aborted]);
      const noBody = r.status === 204 || r.status === 304 || method?.toUpperCase() === 'HEAD';
      const res = new Response(noBody ? null : (r.body as any), {
        status: r.status < 200 || r.status > 599 ? 200 : r.status,
        statusText: r.statusText,
        headers: r.headers,
      });
      Object.defineProperty(res, 'url', { value: r.url });
      return res;
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      throw new TypeError('Network request failed');
    } finally {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
  };

  (globalThis as any).fetch = desktopFetch;

  // Alert في react-native-web ما يسوي شي — نخليه نافذة ويندوز أصلية بنفس الأزرار
  (Alert as any).alert = (title: string, message?: string, buttons?: any[]) => {
    const list = buttons && buttons.length ? buttons : [{ text: 'حسناً' }];
    let cancelId = list.findIndex(b => b?.style === 'cancel');
    if (cancelId < 0) cancelId = list.length - 1;
    bridge
      .dialog(String(title ?? ''), String(message ?? ''), list.map(b => String(b?.text ?? 'حسناً')), cancelId)
      .then(i => list[i]?.onPress?.())
      .catch(() => {});
  };

  // المشاركة: ما فيه قائمة مشاركة في الويندوز — ننسخ النص للحافظة
  (Share as any).share = async (content: { message?: string; url?: string; title?: string }) => {
    const text = content?.message || content?.url || '';
    if (!text) return { action: 'dismissedAction' };
    try { await navigator.clipboard.writeText(text); } catch {}
    await bridge.dialog('تم النسخ', 'انتسخ للحافظة — الصقه في واتساب أو أي مكان (Ctrl+V).', ['حسناً'], 0);
    return { action: 'sharedAction' };
  };

  // روابط واتساب/تيليجرام/الإيميل تنفتح في برامج الجهاز
  const openURL = Linking.openURL.bind(Linking);
  (Linking as any).openURL = async (url: string) => {
    if (/^(https?|mailto|tel|tg|whatsapp):/i.test(url)) {
      bridge.openExternal(url);
      return true;
    }
    return openURL(url);
  };
}

export {};
