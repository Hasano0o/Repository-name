/**
 * عنوان الراوتر بدون ما يكون مضاف في التطبيق (عدّة الألياف — بدون دخول):
 * نسأل العناوين الشائعة كلها مع بعض، والأول اللي يرد هو الراوتر اللي الجوال متصل فيه.
 * لو فيه راوتر مضاف نستخدم عنوانه مباشرة.
 */
import { ROUTER_HOSTS } from '../utils/routerHosts';
import { wifiOnce } from '../utils/latency';
import { getRouter } from '../store/routers';

let cached: { host: string; at: number } | null = null;

export async function findGateway(routerId?: string): Promise<string | undefined> {
  if (routerId && routerId !== 'none') {
    const r = await getRouter(routerId).catch(() => null);
    if (r?.host) return r.host.replace(/^https?:\/\//, '').split('/')[0];
  }
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.host;
  const host = await new Promise<string | undefined>(resolve => {
    let left = ROUTER_HOSTS.length;
    let done = false;
    for (const h of ROUTER_HOSTS) {
      wifiOnce(h, 1500).then(ms => {
        if (!done && ms !== null) { done = true; resolve(h); }
      }).catch(() => {}).finally(() => {
        left -= 1;
        if (!done && left === 0) resolve(undefined);
      });
    }
  });
  if (host) cached = { host, at: Date.now() };
  return host;
}
