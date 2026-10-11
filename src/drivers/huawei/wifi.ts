/**
 * قنوات الواي فاي في هواوي.
 * الفيرموير يختلف بين الموديلات: القناة ممكن تكون في basic-settings (WifiChannel)
 * أو داخل كل <Ssid> في multi-basic-settings — فنقرأ كل المصادر ونطلع أي حقل اسمه فيه «channel».
 * عند الكتابة: نرجّع نفس الإعدادات اللي قريناها بالقناة الجديدة (عشان ما نخرب شي ثاني)،
 * ولو رفض نجرب الطلب المختصر. والشاشة تتأكد بالقراءة بعدها.
 */
import { WifiRadio } from '../types';
import type { Io } from './apn-dns';

const SOURCES = [
  'wlan/basic-settings',
  'wlan/multi-basic-settings',
  'wlan/wifi-advanced-settings',
  'wlan/multi-wifi-advanced-settings',
];

const SKIP = /width|list|enable|switch|support|auto.*(match|sel)|count|num/i;
const SECRET = /psk|key|pass|wep/i;

interface Loc { src: string; block: number | null; tag: string; band: '2.4' | '5'; value: string }

const inner = (xml: string) => xml.match(/<response>([\s\S]*)<\/response>/)?.[1] ?? '';
const fieldsOf = (block: string): [string, string][] =>
  [...block.matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(m => [m[1], m[2]] as [string, string]);
const blocksOf = (body: string) => [...body.matchAll(/<Ssid>([\s\S]*?)<\/Ssid>/g)].map(m => m[1]);

function bandOf(tagName: string, value: string, block: string): '2.4' | '5' {
  const n = Number(value);
  if (n >= 36) return '5';
  if (/5g|5ghz|_a$|wlan1/i.test(tagName)) return '5';
  const freq = fieldsOf(block).find(([k]) => /frequency|radio(type|band)?$|wifiband/i.test(k))?.[1] ?? '';
  if (/^5|5g/i.test(freq.trim())) return '5';
  return '2.4';
}

function channelsIn(src: string, body: string): Loc[] {
  const out: Loc[] = [];
  const scan = (block: string, idx: number | null) => {
    for (const [k, v] of fieldsOf(block)) {
      if (!/channel/i.test(k) || SKIP.test(k)) continue;
      const val = v.trim();
      if (!/^(\d{1,3}|auto)$/i.test(val)) continue;
      out.push({ src, block: idx, tag: k, band: bandOf(k, val, block), value: /auto/i.test(val) ? '0' : val });
    }
  };
  const blocks = blocksOf(body);
  if (blocks.length) blocks.forEach((b, i) => scan(b, i));
  else scan(body, null);
  return out;
}

/* ═══ اكتشاف المسارات من واجهة الراوتر نفسها ═══
 * كل موديل يحفظ القناة في مسار مختلف. نقرأ ملفات الـJS اللي تفتحها صفحة الراوتر
 * ونطلع منها كل مسارات wlan/… — مرة وحدة لكل تشغيل. */
let discovered: string[] | null = null;
let discoverLog: string[] = [];

async function discover(io: Io): Promise<string[]> {
  if (discovered) return discovered;
  discoverLog = [];
  const found = new Set<string>();
  if (!io.page) return (discovered = []);
  const scripts = new Set<string>();
  for (const pg of ['', 'html/index.html', 'html/home.html', 'html/wlanadvanced.html', 'html/wifiadvanced.html']) {
    try {
      const html = await io.page(pg);
      for (const m of html.matchAll(/<script[^>]+src=["']([^"']+\.js)[^"']*["']/gi)) {
        let src = m[1].replace(/^\.\//, '');
        if (/^https?:/i.test(src)) continue;
        if (!src.startsWith('/')) src = (pg.includes('/') ? pg.replace(/[^/]*$/, '') : '') + src;
        scripts.add(src.replace(/^\//, '').replace(/[^/]+\/\.\.\//g, ''));
      }
      for (const m of html.matchAll(/wlan\/[a-z0-9_\-]+/gi)) found.add(m[0]);
    } catch {}
  }
  discoverLog.push(`ملفات js: ${scripts.size}`);
  for (const js of [...scripts].slice(0, 40)) {
    try {
      const code = await io.page(js);
      let n = 0;
      for (const m of code.matchAll(/wlan\/[a-z0-9_\-]+/gi)) { found.add(m[0]); n++; }
      if (n) discoverLog.push(`${js}: ${n}`);
    } catch {}
  }
  discovered = [...found].filter(p => !SOURCES.includes(p));
  return discovered;
}

async function locate(io: Io): Promise<Loc[]> {
  const found: Loc[] = [];
  const extra = await discover(io).catch(() => [] as string[]);
  // المسارات المكتشفة اللي اسمها يوحي بإعدادات الراديو أول — basic-settings في بعض الموديلات للقراءة بس
  const radioish = extra.filter(p => /adv|radio|channel|wifi-?mode|feature|basic|band/i.test(p) && !/host|mac|wps|guest|statistic|pin|switch$/i.test(p));
  for (const src of [...radioish, ...SOURCES]) {
    try {
      const body = inner(await io.get(src));
      if (body) found.push(...channelsIn(src, body));
    } catch {}
  }
  // راديو واحد لكل نطاق — أول مصدر لقيناه فيه
  const seen = new Set<string>();
  return found.filter(l => (seen.has(l.band) ? false : (seen.add(l.band), true)));
}

export async function getWifiRadios(io: Io): Promise<WifiRadio[]> {
  const locs = await locate(io);
  return locs.map(l => ({ band: l.band, channel: l.value, writable: true }));
}

/** آخر محاولات الكتابة — تطلع في تقرير الدعم */
let attempts: string[] = [];
const winner: Record<string, string> = {};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const decode = (v: string) => v
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
/** حقول الراديو اللي صفحة الإعدادات المتقدمة ترسلها مع القناة */
const RADIO = /^(wifichannel|wifimode|wifibandwidth|wificode|wificountry|wifiautocountryswitch|wifirate|wifitxpwrpcnt|wifi5g\w*channel)$/i;

export async function setWifiChannel(io: Io, band: '2.4' | '5', channel: string): Promise<void> {
  attempts = [];
  const loc = (await locate(io)).find(l => l.band === band);
  if (!loc) throw new Error('ما لقينا إعداد القناة في هذا الراوتر');
  const body = inner(await io.get(loc.src));
  const put = (block: string) => block.replace(
    new RegExp(`<${loc.tag}>[^<]*</${loc.tag}>`), `<${loc.tag}>${channel}</${loc.tag}>`);
  const tags = (f: [string, string][]) => f.map(([k, v]) => `<${k}>${v}</${k}>`).join('');

  const tries: [string, string][] = [];
  if (loc.block !== null) {
    const blocks = blocksOf(body);
    const out = blocks.map((b, i) => {
      if (i === loc.block) return put(b);
      return channelsIn(loc.src, b).some(o => o.band === band && o.tag === loc.tag) ? put(b) : b;
    });
    tries.push(['ssids', `<Ssids>${out.map(b => `<Ssid>${b}</Ssid>`).join('')}</Ssids><WifiRestart>1</WifiRestart>`]);
  } else {
    const all = fieldsOf(body).map(([k, v]) => [k, k === loc.tag ? channel : decode(v)] as [string, string])
      .filter(([k]) => k !== 'WifiRestart');
    const full = (f: [string, string][]) => tags(f) + '<WifiRestart>1</WifiRestart>';
    // الكامل أول (H138 يرفض الناقص بخطأ 9003)، وبعده نفس الشي مع إيقاف «الدولة التلقائية» اللي تجبر القناة على تلقائي
    tries.push(['full', full(all)]);
    if (all.some(([k, v]) => /^wifiautocountryswitch$/i.test(k) && v === '1') && channel !== '0') {
      tries.push(['full-noauto', full(all.map(([k, v]) => [k, /^wifiautocountryswitch$/i.test(k) ? '0' : v] as [string, string]))]);
    }
    tries.push(['short', `<${loc.tag}>${channel}</${loc.tag}><WifiRestart>1</WifiRestart>`]);
    tries.push(['radio', full(all.filter(([k]) => RADIO.test(k)))]);
  }
  // اللي نجحت قبل نبدأ فيها على طول (التجربة الذكية تغيّر القناة كذا مرة)
  const w = winner[loc.src];
  if (w) tries.sort((a, b) => (a[0] === w ? -1 : b[0] === w ? 1 : 0));

  for (const [name, req] of tries) {
    try {
      const res = await io.post(loc.src, req);
      attempts.push(`${name}: ${res.replace(/<\?xml[^>]*>/, '').slice(0, 60)}`);
    } catch (e: any) {
      const code = e?.code ?? String(e?.message ?? e);
      attempts.push(`${name}: خطأ ${code}`);
      // الواي فاي طفى وهو يطبّق = غالباً انقبل
      if (/network|abort|timeout|مهلة/i.test(String(e?.message ?? e))) return;
      continue;
    }
    // الراوتر ممكن يطبّق بعد ثواني (مع إعادة تشغيل الواي فاي) — ننتظر لين ١٠ ثواني
    let now: string | undefined;
    for (let i = 0; i < 5; i++) {
      await sleep(i === 0 ? 1000 : 2000);
      try {
        now = channelsIn(loc.src, inner(await io.get(loc.src))).find(l => l.tag === loc.tag)?.value;
      } catch {
        attempts.push(`${name}: الواي فاي يعيد التشغيل`);
        winner[loc.src] = name;
        return; // ما نقدر نقرا = الواي فاي يعيد التشغيل — الشاشة تتأكد بعده
      }
      if (now === undefined || now === channel) { attempts.push(`${name}: ✓ ${now ?? '?'}`); winner[loc.src] = name; return; }
    }
    attempts.push(`${name}: بعدها ${now ?? '?'}`);
  }
  throw new Error(`الراوتر ما قبل تغيير القناة (${attempts.join(' | ').slice(0, 120)})`);
}

export async function wifiDebug(io: Io): Promise<string> {
  const parts: string[] = [];
  for (const src of SOURCES) {
    try {
      const body = inner(await io.get(src))
        .replace(/<(\w+)>([^<]*)<\/\1>/g, (m, k) => (SECRET.test(k) ? `<${k}>***</${k}>` : m));
      parts.push(`[${src}]\n${body.slice(0, 1500) || '(فاضي)'}`);
    } catch (e: any) {
      parts.push(`[${src}] خطأ ${e?.code ?? e?.message ?? e}`);
    }
  }
  if (attempts.length) parts.unshift(`[آخر محاولة]\n${attempts.join('\n')}`);
  // المسارات المكتشفة: نقرأ كل وحدة ونعرض اللي فيها قناة كاملة
  const extra = await discover(io).catch(() => [] as string[]);
  const withCh: string[] = [];
  const other: string[] = [];
  for (const src of extra.slice(0, 60)) {
    try {
      const body = inner(await io.get(src));
      if (/channel/i.test(body)) withCh.push(`[${src}] ★\n${body.replace(/<(\w+)>([^<]*)<\/\1>/g, (m, k) => (SECRET.test(k) ? `<${k}>***</${k}>` : m)).slice(0, 1200)}`);
      else other.push(`${src} ✓`);
    } catch (e: any) {
      other.push(`${src} ✗${e?.code ?? ''}`);
    }
  }
  parts.push(`[اكتشاف] ${discoverLog.join(' · ')}\n${other.join(' ، ')}`);
  parts.push(...withCh);
  return parts.join('\n\n');
}
