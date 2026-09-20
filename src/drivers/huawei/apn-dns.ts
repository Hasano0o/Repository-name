import { ApnProfile, DnsConfig } from '../types';

/** الوصول لواجهة الراوتر — يمرّره السائق */
export interface Io {
  get(path: string): Promise<string>;
  post(path: string, body: string): Promise<string>;
  log(...a: unknown[]): void;
}

const tag = (xml: string, t: string) =>
  xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1];
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s = '') =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** حقول العنصر الجذري كأزواج، للحفاظ على ما لا نعدّله */
const fieldsOf = (block: string): [string, string][] =>
  [...block.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map(m => [m[1], m[2]] as [string, string]);

const render = (fields: [string, string][]) =>
  fields.map(([k, v]) => `<${k}>${v}</${k}>`).join('');

// ───────────────────────── APN ─────────────────────────

async function readProfiles(io: Io) {
  const xml = await io.get('dialup/profiles');
  const current = (tag(xml, 'CurrentProfile') ?? '').trim();
  const blocks = [...xml.matchAll(/<Profile>([\s\S]*?)<\/Profile>/g)].map(m => m[1]);
  return { current, blocks };
}

export async function getApnProfiles(io: Io): Promise<ApnProfile[]> {
  const { current, blocks } = await readProfiles(io);
  return blocks.map(b => {
    const index = (tag(b, 'Index') ?? '').trim();
    return {
      index,
      name: unesc(tag(b, 'Name') ?? '') || 'بدون اسم',
      apn: unesc(tag(b, 'ApnName') ?? ''),
      username: unesc(tag(b, 'Username') ?? '') || undefined,
      authMode: (tag(b, 'AuthMode') ?? '').trim() || undefined,
      ipType: (tag(b, 'IpType') ?? '').trim() || undefined,
      readOnly: (tag(b, 'ReadOnly') ?? '0').trim() === '1',
      current: !!index && index === current,
    };
  });
}

/** يعيد بناء الملف مع تعديل الحقول المطلوبة فقط */
function patchProfile(block: string, patch: Record<string, string>): string {
  const fields = fieldsOf(block);
  for (const [k, v] of Object.entries(patch)) {
    const f = fields.find(x => x[0] === k);
    if (f) f[1] = v; else fields.push([k, v]);
  }
  return '<Profile>' + render(fields) + '</Profile>';
}

export async function setApn(
  io: Io,
  p: { index: string; name: string; apn: string; username?: string; password?: string; authMode?: string },
): Promise<void> {
  const { current, blocks } = await readProfiles(io);
  const target = blocks.find(b => (tag(b, 'Index') ?? '').trim() === p.index);
  if (!target) throw new Error('ملف الاتصال غير موجود على الراوتر');
  if ((tag(target, 'ReadOnly') ?? '0').trim() === '1') {
    throw new Error('هذا الملف محمي من التعديل في الراوتر — أنشئ ملفاً آخر من واجهة الراوتر');
  }

  const patch: Record<string, string> = {
    Name: esc(p.name),
    ApnName: esc(p.apn),
    ApnIsStatic: '1',
    IsValid: '1',
  };
  if (p.username !== undefined) patch.Username = esc(p.username);
  if (p.password) patch.Password = esc(p.password);
  if (p.authMode !== undefined) patch.AuthMode = p.authMode;

  const rebuilt = blocks
    .map(b => ((tag(b, 'Index') ?? '').trim() === p.index
      ? patchProfile(b, patch)
      : '<Profile>' + b + '</Profile>'))
    .join('');

  const body = '<Delete>0</Delete>' +
    '<SetDefault>' + (current || p.index) + '</SetDefault>' +
    '<Modify>2</Modify>' + rebuilt;
  io.log('apn write', p.index, p.apn);
  await io.post('dialup/profiles', body);
}

export async function selectApn(io: Io, index: string): Promise<void> {
  const { blocks } = await readProfiles(io);
  if (!blocks.some(b => (tag(b, 'Index') ?? '').trim() === index)) {
    throw new Error('ملف الاتصال غير موجود على الراوتر');
  }
  const body = '<Delete>0</Delete><SetDefault>' + index + '</SetDefault><Modify>0</Modify>' +
    blocks.map(b => '<Profile>' + b + '</Profile>').join('');
  io.log('apn select', index);
  await io.post('dialup/profiles', body);
}

// ───────────────────────── DNS ─────────────────────────

async function readDhcp(io: Io): Promise<[string, string][]> {
  const xml = await io.get('dhcp/settings');
  const inner = xml.match(/<response>([\s\S]*?)<\/response>/)?.[1] ?? '';
  return fieldsOf(inner);
}

export async function getDns(io: Io): Promise<DnsConfig> {
  const fields = await readDhcp(io);
  const v = (k: string) => fields.find(f => f[0] === k)?.[1]?.trim() ?? '';
  return {
    manual: v('DnsStatus') === '1',
    primary: v('PrimaryDns') || undefined,
    secondary: v('SecondaryDns') || undefined,
  };
}

export async function setDns(io: Io, cfg: DnsConfig): Promise<void> {
  const fields = await readDhcp(io);
  if (!fields.length) throw new Error('الراوتر ما رجّع إعدادات الشبكة المحلية');
  if (!fields.some(f => f[0] === 'DnsStatus')) {
    throw new Error('هذا الراوتر ما يدعم تغيير DNS من التطبيق');
  }
  const setF = (k: string, val: string) => {
    const f = fields.find(x => x[0] === k);
    if (f) f[1] = val; else fields.push([k, val]);
  };
  setF('DnsStatus', cfg.manual ? '1' : '0');
  setF('PrimaryDns', cfg.manual ? esc((cfg.primary ?? '').trim()) : '');
  setF('SecondaryDns', cfg.manual ? esc((cfg.secondary ?? '').trim()) : '');
  io.log('dns write', cfg.manual ? 'manual' : 'auto');
  await io.post('dhcp/settings', render(fields));
}
