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

async function locate(io: Io): Promise<Loc[]> {
  const found: Loc[] = [];
  for (const src of SOURCES) {
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

export async function setWifiChannel(io: Io, band: '2.4' | '5', channel: string): Promise<void> {
  const loc = (await locate(io)).find(l => l.band === band);
  if (!loc) throw new Error('ما لقينا إعداد القناة في هذا الراوتر');
  const body = inner(await io.get(loc.src));
  const put = (block: string) => block.replace(
    new RegExp(`<${loc.tag}>[^<]*</${loc.tag}>`), `<${loc.tag}>${channel}</${loc.tag}>`);

  let full: string;
  if (loc.block !== null) {
    const blocks = blocksOf(body);
    // نفس القناة لكل الشبكات اللي على نفس الراديو (الضيف وغيره)
    const out = blocks.map((b, i) => {
      if (i === loc.block) return put(b);
      const own = channelsIn(loc.src, b);
      return own.some(o => o.band === band && o.tag === loc.tag) ? put(b) : b;
    });
    full = `<Ssids>${out.map(b => `<Ssid>${b}</Ssid>`).join('')}</Ssids><WifiRestart>1</WifiRestart>`;
  } else {
    const f = fieldsOf(body).map(([k, v]) => [k, k === loc.tag ? channel : k === 'WifiRestart' ? '1' : v] as [string, string]);
    if (!f.some(([k]) => k === 'WifiRestart')) f.push(['WifiRestart', '1']);
    full = f.map(([k, v]) => `<${k}>${v}</${k}>`).join('');
  }
  try {
    await io.post(loc.src, full);
  } catch (e) {
    io.log('wifi full set failed', loc.src, e);
    // بعض الفيرمويرات ترفض الحقول للقراءة فقط — نرسل المختصر
    await io.post(loc.src, `<${loc.tag}>${channel}</${loc.tag}><WifiRestart>1</WifiRestart>`);
  }
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
  return parts.join('\n\n');
}
