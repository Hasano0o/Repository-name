export async function http(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, credentials: 'include', signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('الراوتر ما رد — تأكد إنك متصل بشبكته');
    throw new Error('تعذر الاتصال بالراوتر');
  } finally {
    clearTimeout(t);
  }
}
