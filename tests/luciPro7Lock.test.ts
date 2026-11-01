/**
 * Pro7 (LuCI) — تثبيت الترددات ووضع الشبكة والبرج من صفحات المودم الحقيقية (ملف FULL ٢ نوفمبر ٢٠٢٦).
 * الصفحات في tests/fixtures/pro7-modem-*.html = نموذج الصفحة نفسه، والقيم اللي كانت مخفية في الملف معبّاة بقيم تجربة.
 * الراوتر المحاكى يتصرف مثل LuCI: يحفظ اللي وصل، المربع المفرد (cbi.cbe) بدون قيمة = مطفي، والخانة الناقصة تنمسح.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuciDriver } from '../src/drivers/luci';
import { parseCbiForm, cbiState, cbiPairs, cbiApply } from '../src/drivers/luci/cbi';

(globalThis as any).__DEV__ = false;
// انتظار الحفظ (4 ثواني) يصير فوري — مهلات الطلبات تبقى كما هي
const realST = globalThis.setTimeout;
(globalThis as any).setTimeout = (f: any, ms?: number, ...a: any[]) => realST(f, ms === 4000 ? 0 : ms, ...a);

const STOK = 'a1b2c3d4e5f60718';
const fx = (n: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', `pro7-modem-${n}.html`), 'utf8').replace(/;stok=STOK/g, `;stok=${STOK}`);
type Page = 'band' | 'network' | 'cell';
type State = Record<string, string | string[]>;

/** حالة uci من الصفحة نفسها (بدون كود الدرايفر) */
function initState(html: string): State {
  const st: State = {};
  const groups: Record<string, { v: string; c: boolean }[]> = {};
  for (const m of html.matchAll(/<input\b[^>]*>/g)) {
    const t = m[0];
    const name = t.match(/name="([^"]+)"/)?.[1];
    if (!name?.startsWith('cbid.')) continue;
    const v = t.match(/value="([^"]*)"/)?.[1] ?? '';
    if (/type="checkbox"/.test(t)) (groups[name] ??= []).push({ v, c: /checked="checked"/.test(t) });
    else st[name] = v;
  }
  for (const [n, g] of Object.entries(groups)) {
    if (html.includes(`name="cbi.cbe.${n.slice(5)}"`)) st[n] = g[0].c ? '1' : '0';
    else st[n] = g.filter(x => x.c).map(x => x.v);
  }
  for (const m of html.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) st[m[1]] = m[2].match(/value="([^"]*)" selected/)?.[1] ?? '';
  return st;
}

function render(tpl: string, st: State): string {
  let h = tpl.replace(/<input\b[^>]*>/g, t => {
    const name = t.match(/name="([^"]+)"/)?.[1];
    if (!name || !(name in st)) return t;
    const s = st[name];
    if (/type="checkbox"/.test(t)) {
      const v = t.match(/value="([^"]*)"/)?.[1] ?? '';
      const on = Array.isArray(s) ? s.includes(v) : s === '1';
      t = t.replace(/\s*checked="checked"/, '');
      return on ? t.replace(/\s*\/>$/, ' checked="checked" />') : t;
    }
    return t.replace(/value="[^"]*"/, `value="${s}"`);
  });
  h = h.replace(/(<select\b[^>]*name="([^"]+)"[^>]*>)([\s\S]*?)(<\/select>)/g, (_, a, n, inner, z) =>
    a + inner.replace(/ selected="selected"/g, '').replace(new RegExp(`value="${st[n]}"`), `value="${st[n]}" selected="selected"`) + z);
  return h;
}

function parseMultipart(body: string, type: string): [string, string][] {
  const b = type.match(/boundary=(.+)$/)![1];
  return body.split(`--${b}`).slice(1, -1).map(p => {
    const name = p.match(/name="([^"]+)"/)![1];
    return [name, p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '')] as [string, string];
  });
}

function router(opts: { ignoreWrites?: boolean; tpl?: Partial<Record<Page, string>>; status?: object } = {}) {
  const tpl: Record<Page, string> = { band: opts.tpl?.band ?? fx('band'), network: opts.tpl?.network ?? fx('network'), cell: opts.tpl?.cell ?? fx('cell') };
  const st: Record<Page, State> = { band: initState(tpl.band), network: initState(tpl.network), cell: initState(tpl.cell) };
  const posts: { page: Page; pairs: [string, string][] }[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const res = (status: number, body: string, finalUrl = url) => ({ ok: status < 400, status, url: finalUrl, headers: { get: () => 'text/html' }, text: async () => body } as any);
    if (u.pathname === '/cgi-bin/luci' && init?.method === 'POST') return res(200, '<html><body>ok</body></html>', `http://${u.host}/cgi-bin/luci/;stok=${STOK}/`);
    if (u.pathname.endsWith('/admin/status/nr')) return res(200, JSON.stringify(opts.status ?? { mode: 'NR5G-NSA', band: 'LTE BAND 3', PCI: '210', arfcn: '1850', signal: '-90', nsa_band: '78', nsa_pci: '300', nsa_earfcn: '627264', nsa_rsrp: '-95' }));
    const m = u.pathname.match(/\/admin\/modem\/(band|network|cell)$/);
    if (m && u.pathname.includes(`;stok=${STOK}`)) {
      const page = m[1] as Page;
      if (init?.method === 'POST') {
        const pairs = parseMultipart(String(init.body), init.headers['Content-Type']);
        posts.push({ page, pairs });
        const got = (n: string) => pairs.filter(p => p[0] === n).map(p => p[1]);
        assert.deepEqual(got('cbi.submit'), ['1'], 'cbi.submit من الصفحة');
        assert.equal(got('cbi.apply').length, 1, 'زر الحفظ');
        if (!opts.ignoreWrites) {
          const s = st[page];
          for (const n of Object.keys(s)) {
            if (Array.isArray(s[n])) s[n] = got(n);
            else if (tpl[page].includes(`name="cbi.cbe.${n.slice(5)}"`)) s[n] = got(n).length ? '1' : '0';
            else s[n] = got(n)[0] ?? ''; // LuCI: الخانة اللي ما وصلت تنمسح
          }
        }
        return res(200, '<html><body>' + render(tpl[page], st[page]) + '</body></html>');
      }
      return res(200, '<html><head><title>Pro7 - Band Lock</title></head><body>' + render(tpl[page], st[page]) + '</body></html>');
    }
    return res(404, '');
  };
  return { st, posts };
}

async function driver() {
  const d = new LuciDriver();
  await d.login('192.168.1.1', 'admin', 'admin');
  return d;
}

test('Pro7: قراءة الترددات من الصفحة — 4G تلقائي، 5G مثبّت n78 (NSA)، الوضع «5G NSA بس»', async () => {
  router();
  const d = await driver();
  const c = await d.getBandConfig();
  assert.deepEqual(c.supported, [1, 3, 5, 7, 8, 20, 28, 32, 38, 40, 41, 42, 43, 71]);
  assert.deepEqual(c.locked, []);
  assert.deepEqual(c.nrLocked, [78]);
  assert.ok(c.nrSupported.includes(78) && c.nrSupported.includes(41));
  assert.equal(c.mode, '4');
  assert.equal(c.modes.find(m => m.value === '4')?.label, '5G NSA بس');
  assert.equal(c.modes.length, 7);
});

test('Pro7: تثبيت 4G على B1+B3 — يرسل كل خانات النموذج، و5G والبرج ما يتغيّرون', async () => {
  const r = router();
  const d = await driver();
  await d.setBand([1, 3]);
  assert.equal(r.posts.length, 1);
  assert.equal(r.posts[0].page, 'band');
  const names = r.posts[0].pairs.map(p => p[0]);
  for (const n of ['cbi.cbe.modem_info.band.gwenable', 'cbi.cbe.modem_info.band.lteenable', 'cbi.cbe.modem_info.band.nsanr5genable', 'cbi.cbe.modem_info.band.nr5genable']) assert.ok(names.includes(n), n);
  assert.equal(r.st.band['cbid.modem_info.band.lteenable'], '1');
  assert.deepEqual(r.st.band['cbid.modem_info.band.set_lteband'], ['1', '3']);
  assert.equal(r.st.band['cbid.modem_info.band.nsanr5genable'], '1', 'NSA يبقى');
  assert.deepEqual(r.st.band['cbid.modem_info.band.set_nsanr5gband'], ['78']);
  assert.equal(r.st.band['cbid.modem_info.band.nr5genable'], '0');
  assert.deepEqual((await d.getBandConfig()).locked, [1, 3]);
  // نفس الطلب مرة ثانية ← ما يرسل شي
  await d.setBand([3, 1]);
  assert.equal(r.posts.length, 1);
});

test('Pro7: قيم المربعات من الصفحة نفسها (مو رقم التردد) — ما نخمّن', async () => {
  const band = fx('band').replace(/(id="cbid\.modem_info\.band\.set_lteband(\d+)"[^>]*?value=")\d+"/g, (_, a, i) => `${a}opt${i}"`);
  const r = router({ tpl: { band } });
  const d = await driver();
  await d.setBand([3, 71]);
  assert.deepEqual(r.st.band['cbid.modem_info.band.set_lteband'], ['opt2', 'opt14']);
  assert.deepEqual((await d.getBandConfig()).locked, [3, 71]);
});

test('Pro7: 5G — يثبّت NSA و SA مع بعض · [] يطفي التثبيت ويخلي المربعات', async () => {
  const r = router();
  const d = await driver();
  await d.setBand('keep', [78]);
  assert.equal(r.st.band['cbid.modem_info.band.nr5genable'], '1');
  assert.deepEqual(r.st.band['cbid.modem_info.band.set_nr5gband'], ['78']);
  assert.equal(r.st.band['cbid.modem_info.band.lteenable'], '0', '4G ما انلمس');
  await d.setBand('keep', []);
  assert.equal(r.st.band['cbid.modem_info.band.nsanr5genable'], '0');
  assert.equal(r.st.band['cbid.modem_info.band.nr5genable'], '0');
  assert.deepEqual(r.st.band['cbid.modem_info.band.set_nsanr5gband'], ['78'], 'المربعات تبقى');
  assert.deepEqual((await d.getBandConfig()).nrLocked, []);
});

test('Pro7: تردد مو في القائمة ← noChange بدون أي إرسال', async () => {
  const r = router();
  const d = await driver();
  await assert.rejects(d.setBand([66]), (e: any) => e.noChange === true);
  await assert.rejects(d.setBand('keep', [79]), (e: any) => e.noChange === true);
  await assert.rejects(d.setNetworkMode('9'), (e: any) => e.noChange === true);
  assert.equal(r.posts.length, 0);
});

test('Pro7: وضع الشبكة — قيمة الخيار من الصفحة ويتأكد بالقراءة', async () => {
  const r = router();
  const d = await driver();
  await d.setNetworkMode('5');
  assert.equal(r.posts.length, 1);
  assert.equal(r.st.network['cbid.modem_info.cfg0502af.network'], '5');
  assert.equal((await d.getBandConfig()).mode, '5');
});

test('Pro7: الراوتر قبل الحفظ بس ما تغيّر ← خطأ صريح (مو noChange)', async () => {
  router({ ignoreWrites: true });
  const d = await driver();
  await assert.rejects(d.setBand([3]), (e: any) => !e.noChange && /القراءة بعده مختلفة/.test(e.message));
});

test('Pro7: تثبيت برج 4G — قسم 5G (SA) يبقى بأرقامه', async () => {
  const r = router();
  const d = await driver();
  const cells = await d.getCells();
  const lte = cells.find(c => c.tech === 'LTE')!;
  assert.equal(lte.pci, '210'); assert.equal(lte.arfcn, '1850'); assert.equal(lte.band, 3);
  await d.lockCell({ tech: 'LTE', pci: lte.pci!, arfcn: lte.arfcn! });
  const c = r.st.cell;
  assert.equal(c['cbid.modem_info.ltecelllock.enable'], '1');
  assert.equal(c['cbid.modem_info.ltecelllock.freq'], '1850');
  assert.equal(c['cbid.modem_info.ltecelllock.pci'], '210');
  assert.equal(c['cbid.modem_info.sacelllock.enable'], '1');
  assert.equal(c['cbid.modem_info.sacelllock.freq'], '636666');
  assert.equal(c['cbid.modem_info.sacelllock.pci'], '123');
  assert.equal(c['cbid.modem_info.sacelllock.scs'], '30');
  const locks = await d.getCellLocks();
  assert.deepEqual(locks.map(l => [l.tech, l.pci]), [['LTE', '210'], ['NR', '123']]);
});

test('Pro7: برج 5G — في وضع NSA يرفض بدون إرسال · في SA يثبّت مع SCS 30 لـ n78 · n41 ما نخمّن', async () => {
  const r = router();
  const d = await driver();
  await assert.rejects(d.lockCell({ tech: 'NR', band: 78, pci: '300', arfcn: '627264' }), (e: any) => e.noChange && /SA/.test(e.message));
  assert.equal(r.posts.length, 0);
  await d.setNetworkMode('5');
  await d.lockCell({ tech: 'NR', band: 78, pci: '300', arfcn: '627264' });
  assert.equal(r.st.cell['cbid.modem_info.sacelllock.pci'], '300');
  assert.equal(r.st.cell['cbid.modem_info.sacelllock.freq'], '627264');
  assert.equal(r.st.cell['cbid.modem_info.sacelllock.band'], '78');
  assert.equal(r.st.cell['cbid.modem_info.sacelllock.scs'], '30');
  const n = r.posts.length;
  await assert.rejects(d.lockCell({ tech: 'NR', band: 41, pci: '300', arfcn: '520110' }), (e: any) => e.noChange && /SCS/.test(e.message));
  await assert.rejects(d.lockCell({ tech: 'LTE', pci: '', arfcn: '1850' }), (e: any) => e.noChange);
  assert.equal(r.posts.length, n);
});

test('Pro7: فك البرج يطفي «Enable» بس ويخلي الأرقام', async () => {
  const r = router();
  const d = await driver();
  await d.unlockCell('NR');
  assert.equal(r.st.cell['cbid.modem_info.sacelllock.enable'], '0');
  assert.equal(r.st.cell['cbid.modem_info.sacelllock.pci'], '123');
  assert.deepEqual(await d.getCellLocks(), []);
});

test('Pro7: لقطة ← تغييرات ← إرجاع = نفس الصفحات بالضبط', async () => {
  const r = router();
  const d = await driver();
  const before = JSON.stringify(r.st);
  const snap = await d.readLockState();
  assert.match(snap.summary, /4G: تلقائي · 5G: n78 · 5G NSA بس · برج 5G 123/);
  await d.setBand([1], [41]);
  await d.setNetworkMode('2');
  await d.lockCell({ tech: 'LTE', pci: '7', arfcn: '100' });
  assert.ok(JSON.stringify(r.st) !== before, 'تغيّر شي');
  await d.restoreLockState(snap);
  assert.equal(JSON.stringify(r.st), before);
});

test('Pro7: الإنقاذ — يفك البرج والترددات ويرجّع «Auto»', async () => {
  const r = router();
  const d = await driver();
  await d.setBand([3]);
  await d.restoreAll();
  assert.equal(r.st.band['cbid.modem_info.band.lteenable'], '0');
  assert.equal(r.st.band['cbid.modem_info.band.nsanr5genable'], '0');
  assert.equal(r.st.cell['cbid.modem_info.sacelllock.enable'], '0');
  assert.equal(r.st.network['cbid.modem_info.cfg0502af.network'], '0');
});

test('CBI: خانة مشروطة شرطها ما تحقق ما تنرسل (مثل cbi.js) · checkbox بدون قيمة = on', () => {
  const html = `<form method="post" name="cbi" action="/x" enctype="multipart/form-data">
    <input type="hidden" name="cbi.submit" value="1" />
    <select name="cbid.m.s.search" id="cbid.m.s.search"><option value="auto" selected="selected">Auto</option><option value="manual">Manual</option></select>
    <div class="cbi-value" id="cbi-m-s-op"><input type="text" name="cbid.m.s.op" value="42001" /></div>
    <script type="text/javascript" id="cbip-m-s-op">cbi_d_add("cbi-m-s-op", {"cbid.m.s.search":"manual"}, "cbip-m-s-op");</script>
    <input type="checkbox" name="cbid.m.s.x" checked="checked" />
    <input type="submit" name="cbi.apply" value="Save &amp; Apply" /></form>`;
  const f = parseCbiForm(html)!;
  assert.deepEqual(f.dropped, ['cbid.m.s.op']);
  assert.deepEqual(cbiPairs(f), [['cbi.submit', '1'], ['cbid.m.s.search', 'auto'], ['cbid.m.s.x', 'on'], ['cbi.apply', 'Save & Apply']]);
  assert.throws(() => cbiApply(f, { vals: { 'cbid.m.s.search': 'other' } }), /مو موجود/);
  assert.equal(cbiState(f).vals['cbid.m.s.search'], 'auto');
});
