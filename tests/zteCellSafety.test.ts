import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;

const Module = require('module');
const origLoad = Module._load;

Module._load = function (req: string, ...rest: unknown[]) {
  if (req === '@react-native-async-storage/async-storage') {
    const m = new Map<string, string>();
    return {
      default: {
        getItem: async (k: string) => m.get(k) ?? null,
        setItem: async (k: string, v: string) => { m.set(k, v); },
        removeItem: async (k: string) => { m.delete(k); },
      },
    };
  }
  if (/^@noble\//.test(req)) {
    return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  }
  return origLoad.call(this, req, ...rest);
};

(globalThis as any).__DEV__ = false;

function mockRouter(options: {
  ltePci?: string;
  lteEarfcn?: string;
  nrCell?: string;
  failLockRead?: boolean;
} = {}) {
  const posts: string[] = [];
  const state: Record<string, string> = {
    wa_inner_version: 'BD_STCMU5001V1.0.2B04',
    cr_version: '',
    web_version: '',
    loginfo: 'ok',
    LD: 'LD1',
    RD: 'rd123',
    network_type: 'ENDC',
    lte_pci_lock: options.ltePci ?? '',
    lte_earfcn_lock: options.lteEarfcn ?? '',
    nr5g_cell_lock: options.nrCell ?? '',
    net_select: 'Only_LTE',
  };

  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const reply = (body: unknown) => ({
      ok: true,
      status: 200,
      url,
      headers: { get: () => null },
      text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    });

    if (u.pathname.endsWith('goform_set_cmd_process')) {
      const form = new URLSearchParams(String(init?.body ?? ''));
      const id = form.get('goformId') ?? '?';
      posts.push(id);
      if (id === 'LOGIN') return reply({ result: '0' });
      if (id === 'LOGOUT' || id === 'GOFORM_LOGOUT') return reply({ result: 'success' });
      return reply({ result: 'success' });
    }

    const keys = (u.searchParams.get('cmd') ?? '').split(',');
    if (
      options.failLockRead &&
      keys.some(k => ['lte_pci_lock', 'lte_earfcn_lock', 'nr5g_cell_lock'].includes(k))
    ) {
      throw new Error('simulated lock-state read failure');
    }

    const out: Record<string, string> = {};
    for (const key of keys) out[key] = state[key] ?? '';
    return reply(out);
  };

  return { posts };
}

function makeDriver() {
  const { ZteDriver } = require('../src/drivers/zte/index');
  const d = new ZteDriver();
  (d as any).host = '192.168.0.1';
  (d as any).password = 'test';
  (d as any).loggedIn = true;
  (d as any).ensure = async () => {};
  return d;
}

const changeCommands = [
  'LTE_LOCK_CELL_SET',
  'NR5G_CELL_LOCK_SET',
  'NR5G_LOCK_CELL_SET',
  'UNLOCK_ALL_CELL',
  'REBOOT_DEVICE',
];

function assertNoCellChanges(posts: string[]) {
  assert.deepEqual(
    posts.filter(id => changeCommands.includes(id)),
    [],
    `انرسلت أوامر تغيير غير متوقعة: ${posts.join(', ')}`,
  );
}

test('MU5001: تثبيت برج عام مرفوض بلا أي أمر تغيير', async () => {
  const r = mockRouter();
  const d = makeDriver();

  await assert.rejects(
    d.lockCell({ tech: 'LTE', pci: '12', arfcn: '1650', band: 3 }),
    (err: any) => err?.noChange === true,
  );

  assertNoCellChanges(r.posts);
});

test('MU5001: وجود قفل LTE يمنع فك القفل العام وإعادة التشغيل', async () => {
  const r = mockRouter({ ltePci: '12', lteEarfcn: '1650' });
  const d = makeDriver();

  await assert.rejects(
    d.unlockCell(),
    (err: any) => err?.noChange === true,
  );

  assertNoCellChanges(r.posts);
});

test('MU5001: عدم وجود قفل لا يرسل أوامر فك أو إعادة تشغيل', async () => {
  const r = mockRouter();
  const d = makeDriver();

  await d.unlockCell();

  assertNoCellChanges(r.posts);
});

test('MU5001: فشل قراءة حالة الأقفال لا يتحول إلى نجاح', async () => {
  const r = mockRouter({ failLockRead: true });
  const d = makeDriver();

  await assert.rejects(d.unlockCell());

  assertNoCellChanges(r.posts);
});

test('MU5001: clearLteCell لا يرسل أمرًا عند عدم وجود قفل أو عند وجوده', async () => {
  const empty = mockRouter();
  const d1 = makeDriver();

  await (d1 as any).clearLteCell();
  assertNoCellChanges(empty.posts);

  const locked = mockRouter({ ltePci: '12', lteEarfcn: '1650' });
  const d2 = makeDriver();

  await assert.rejects(
    (d2 as any).clearLteCell(),
    (err: any) => err?.noChange === true,
  );
  assertNoCellChanges(locked.posts);
});

test('MU5001: clearNrCell لا يرسل أمرًا عند عدم وجود قفل أو عند وجوده', async () => {
  const empty = mockRouter();
  const d1 = makeDriver();

  await (d1 as any).clearNrCell();
  assertNoCellChanges(empty.posts);

  const locked = mockRouter({ nrCell: '12,640000,78,0' });
  const d2 = makeDriver();

  await assert.rejects(
    (d2 as any).clearNrCell(),
    (err: any) => err?.noChange === true,
  );
  assertNoCellChanges(locked.posts);
});

test('MU5001: فشل قراءة LTE يمنع clearLteCell من إرسال أي أمر', async () => {
  const r = mockRouter({ failLockRead: true });
  const d = makeDriver();

  await assert.rejects(
    (d as any).clearLteCell(),
    (err: any) => err?.noChange === true,
  );

  assertNoCellChanges(r.posts);
});

test('MU5001: فشل قراءة 5G يمنع clearNrCell من إرسال أي أمر', async () => {
  const r = mockRouter({ failLockRead: true });
  const d = makeDriver();

  await assert.rejects(
    (d as any).clearNrCell(),
    (err: any) => err?.noChange === true,
  );

  assertNoCellChanges(r.posts);
});
