/**
 * TP-Link «GDPR» — قراءة صفحة الدخول وردود الراوتر (بدون react-native).
 * من ملفات NX200 (١٥ نوفمبر): الصفحة على https، وصفحة http «ترحيب» بس.
 */
import type { Signal, CellTower, Carrier } from '../types';

/** صفحة http اللي وظيفتها «روح لـ https» */
export function tpIsWelcome(t: string): boolean {
  return /\/cgi\/welcome/.test(t) && /go-https-modal|visitHttpsNote/.test(t);
}
/** صفحة دخول TP-Link (نسخة GDPR): تطلب /cgi/getGDPRParm وفيها gdprProxy.js */
export function tpIsLoginPage(t: string): boolean {
  return /\/cgi\/getGDPRParm/.test(t) || (/gdprProxy\.js/.test(t) && /tpEncrypt\.js/.test(t));
}
/** متغيرات السطر الأخير في الصفحة: modelName · adminType · authTimes · forbidFlag … */
export function tpPageVars(t: string): { model?: string; desc?: string; adminType?: string; authTimes?: number; maxAuthTimes?: number; forbidFlag?: boolean; forbidForever?: boolean; forbidTime?: number } {
  const s = (k: string) => t.match(new RegExp(`\\bvar\\s+${k}\\s*=\\s*"([^"]*)"`))?.[1];
  const n = (k: string) => { const v = t.match(new RegExp(`\\bvar\\s+${k}\\s*=\\s*(\\d+)`))?.[1]; return v === undefined ? undefined : Number(v); };
  return {
    model: s('modelName'), desc: s('modelDesc'), adminType: s('adminType'),
    authTimes: n('authTimes'), maxAuthTimes: n('maxAuthTimes'),
    forbidFlag: n('forbidFlag') === 1, forbidForever: n('forbidForever') === 1, forbidTime: n('forbidTime'),
  };
}
/**
 * اسم المستخدم مثل الصفحة: INCLUDE_LOGIN_USERNAME = 0 (CHGINIT_PWD=1 و AUTH_PASSWORD=1) و USER_RESTRICTION=1
 * ← user = adminType == "admin" ? 'admin' : 'user'. صفحة بدون adminType ← اللي كتبه العضو أو admin.
 */
export function tpLoginUser(adminType: string | undefined, typed: string): string {
  if (adminType) return adminType === 'admin' ? 'admin' : 'user';
  return (typed || '').trim() || 'admin';
}
/** رد /cgi/getBusy */
export function tpBusy(t: string): { logined: boolean; busy: boolean } {
  return { logined: /isLogined\s*=\s*1/.test(t), busy: /isBusy\s*=\s*1/.test(t) };
}
/** رد أمر cgi بعد فك التشفير: «$.ret=0;» — null = ما فيه */
export function tpRet(t: string): number | null {
  const m = t.match(/\$\.ret\s*=\s*(-?\d+)/);
  return m ? Number(m[1]) : null;
}
/** رمز الجلسة في الصفحة الرئيسية بعد الدخول (var token="…") — يروح في رأس TokenID */
export function tpToken(t: string): string | null {
  return t.match(/\btoken\s*=\s*"([0-9a-zA-Z]{8,})"/)?.[1] ?? null;
}
/** خطأ الكلمة الغلط في الصفحة (HTTP_ERR_USER_PWD_NOT_CORRECT) */
export const TP_ERR_PWD = 71233;

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) && /\d/.test(String(v)) ? n : undefined;
};

/**
 * الإشارة من ردود الراوتر — ما نعرف أسماء الخانات بالضبط للحين (تنعرف من ملف FULL)، فنقرأ بس الخانات
 * اللي اسمها واضح (rsrp / rsrq / sinr|snr / rssi) وبقيم معقولة. خانة فيها nr أو 5g ← 5G.
 * ما نخمّن شي غير كذا — لو ما لقينا ← فاضي.
 */
export function tpSignalGuess(objs: Record<string, unknown>[]): Signal {
  const s: Signal = {};
  const set = <K extends keyof Signal>(k: K, v: Signal[K]) => { if (v !== undefined && s[k] === undefined) s[k] = v; };
  for (const o of objs) {
    for (const [k0, v] of Object.entries(o ?? {})) {
      if (v && typeof v === 'object') continue;
      const k = k0.toLowerCase();
      const nr = /nr|5g/.test(k.replace(/sinr/g, '')); // «sinr» فيها nr — ما تنحسب 5G
      const x = num(v);
      if (x === undefined) continue;
      if (/rsrp/.test(k) && x <= -40 && x >= -150) set(nr ? 'nrRsrp' : 'rsrp', x);
      else if (/rsrq/.test(k) && x < 0 && x >= -40) set(nr ? 'nrRsrq' : 'rsrq', x);
      else if (/(sinr|snr)/.test(k) && x >= -30 && x <= 50) set(nr ? 'nrSinr' : 'sinr', x);
      else if (/rssi/.test(k) && x <= -20 && x >= -130 && !nr) set('rssi', x);
    }
  }
  if (s.nrRsrp !== undefined) s.nrActiveFromStatus = true;
  if (s.rsrp !== undefined || s.nrRsrp !== undefined) s.network = s.rsrp !== undefined && s.nrRsrp !== undefined ? '5G NSA' : s.nrRsrp !== undefined ? '5G SA' : '4G';
  return s;
}

/** أوامر القراءة اللي نسحبها في FULL (go = كائن · gl = قائمة) — كلها قراءة. أسماؤها من oid_str.js في الراوتر */
export const TP_READ_OIDS: { op: 'go' | 'gl'; oid: string; stacks: string[] }[] = [
  { op: 'go', oid: 'DEV2_DEV_INFO', stacks: ['0,0,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_NET_STATUS', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_SERVING_CELL_INFO', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'gl', oid: 'DEV2_LTE_SERVING_CELL_INFO', stacks: ['0,0,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_BANDINFO', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_LINK_CFG', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_4G_CELL_LOCK', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_5G_CELL_LOCK', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_CELL_LOCK', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_PROF_STAT', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0', '2,1,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_WAN_CFG', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_CELL_INTF', stacks: ['1,0,0,0,0,0'] },
  { op: 'gl', oid: 'DEV2_CELL_INTF', stacks: ['0,0,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_CELL_INTF_STAT', stacks: ['1,0,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_XTP_LTE_INTF_CFG', stacks: ['0,0,0,0,0,0', '1,0,0,0,0,0'] },
  // صفحة advanceLte.htm (اختيار الترددات + بحث الشبكات) — قراءة بس، stack الصفحة نفسها
  { op: 'go', oid: 'DEV2_LTE_BAND_SEARCH', stacks: ['1,0,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_NETWORK_SEARCH', stacks: ['1,0,0,0,0,0'] },
  { op: 'go', oid: 'DEV2_LTE_PLMNLOCK', stacks: ['1,0,0,0,0,0'] },
];

/* ═══ الإشارة الحقيقية (FULL ١٥ نوفمبر ٤:١٦ م) ═══
 * gl DEV2_LTE_SERVING_CELL_INFO ← قائمة خانات (stack 1,N). من frame/top.htm:
 *   networkType: 3 LTE · 7 4G+ · 8 NR (٢ WCDMA · ٤ TD-SCDMA) · cellConnectionStatus "1" = الخلية الأساسية
 *   "2" = ثانوية (الدمج): عند العضو B3 «1» + B1 «2» و LINK_CFG.connectedBand = "B3;B1".
 *   الخانات: band · cid · PCI · TAC · ARFCN · RSRP · RSRQ · SNR · RSSI · CQI · upMCS/downMCS · txPowerPUCCH · downBandWidth (kHz)
 *   · nodeBId (hex) · CGI. لـ 5G: SSRSRP / SSRSRQ / SSSINR. صفر = ما فيه قراءة.
 *   SNR: الراوتر رجّع 47 مع RSRQ -10 و downMCS 2 (QPSK) — هذا ٤٫٧ dB (وحدة ٠٫١ dB مثل rssnr في MediaTek — المودم ccmni)، مو ٤٧.
 */
export interface TpCell { tech: 'LTE' | 'NR'; status: string; band: number; arfcn?: string; pci?: string; cellId?: string; tac?: string; enb?: string;
  rsrp?: number; rsrq?: number; sinr?: number; rssi?: number; cqi?: number; dlMcs?: number; ulMcs?: number; bwMhz?: number }

const nz = (v: unknown, lo: number, hi: number): number | undefined => { const x = num(v); return x === undefined || x === 0 || x < lo || x > hi ? undefined : x; };
const st = (v: unknown) => { const x = v === null || v === undefined ? '' : String(v).trim(); return x && x !== '0' ? x : undefined; };

export function tpCells(list: unknown): TpCell[] {
  const arr: any[] = Array.isArray(list) ? list : [];
  const out: TpCell[] = [];
  for (const c of arr) {
    const nt = Number(c?.networkType);
    const band = Number(c?.band);
    if (![3, 7, 8].includes(nt) || !(band > 0)) continue;
    const nr = nt === 8;
    const snr = num(nr ? (num(c.SSSINR) ? c.SSSINR : c.SNR) : c.SNR);
    const bw = num(c.downBandWidth);
    out.push({
      tech: nr ? 'NR' : 'LTE', status: String(c.cellConnectionStatus ?? ''), band,
      arfcn: st(c.ARFCN), pci: st(c.PCI), cellId: st(c.cid), tac: st(c.TAC), enb: st(c.nodeBId),
      rsrp: nz(nr && num(c.SSRSRP) ? c.SSRSRP : c.RSRP, -160, -30),
      rsrq: nz(nr && num(c.SSRSRQ) ? c.SSRSRQ : c.RSRQ, -45, -1),
      sinr: snr === undefined || (snr === 0 && !num(c.RSRP)) ? undefined : snr / 10,
      rssi: nz(c.RSSI, -130, -20), cqi: nz(c.CQI, 1, 15), dlMcs: num(c.downMCS), ulMcs: num(c.upMCS),
      bwMhz: bw && bw > 0 ? bw / 1000 : undefined,
    });
  }
  return out;
}

/** link = DEV2_LTE_LINK_CFG (endcStatus · connectedBand · networkType) */
export function tpSignal(cells: TpCell[], link?: Record<string, unknown> | null): Signal {
  const s: Signal = {};
  const lte = cells.find(c => c.tech === 'LTE' && c.status === '1');
  const nr = cells.find(c => c.tech === 'NR' && c.status === '1');
  if (lte) {
    s.band = 'B' + lte.band; s.earfcn = lte.arfcn; s.pci = lte.pci; s.cellId = lte.cellId; s.tac = lte.tac;
    s.enodebId = lte.enb ? String(parseInt(lte.enb, 16) || lte.enb) : undefined;
    s.rsrp = lte.rsrp; s.rsrq = lte.rsrq; s.sinr = lte.sinr; s.rssi = lte.rssi; s.cqi = lte.cqi; s.dlMcs = lte.dlMcs; s.ulMcs = lte.ulMcs;
    s.dlBandwidth = lte.bwMhz ? lte.bwMhz + 'MHz' : undefined;
  }
  if (nr) {
    s.nrBand = 'n' + nr.band; s.nrArfcn = nr.arfcn; s.nrPci = nr.pci; s.nrRsrp = nr.rsrp; s.nrRsrq = nr.rsrq; s.nrSinr = nr.sinr; s.nrCqi = nr.cqi;
    s.nrDlBandwidth = nr.bwMhz ? nr.bwMhz + 'MHz' : undefined;
    s.nrActiveFromStatus = true;
    if (!lte) { s.cellId = nr.cellId; s.tac = nr.tac; }
  }
  const active = cells.filter(c => c.status === '1' || c.status === '2');
  const lteCa = active.filter(c => c.tech === 'LTE').length;
  if (active.length > 1) {
    s.caCount = active.length;
    const bw = active.reduce((a, c) => a + (c.bwMhz ?? 0), 0);
    if (bw) s.caBandwidthMhz = bw;
  }
  const endc = Number(link?.endcStatus ?? -1) > 0;
  s.network = nr && lte ? '5G NSA' : nr ? (endc ? '5G NSA' : '5G SA') : lte ? (lteCa > 1 || Number(link?.networkType) === 7 ? '4G+' : '4G') : undefined;
  return s;
}

export function tpTowers(cells: TpCell[]): CellTower[] {
  return cells.map(c => ({
    kind: c.status === '1' ? 'serving' : c.status === '2' ? 'secondary' : 'neighbor',
    tech: c.tech, band: c.band, arfcn: c.arfcn, pci: c.pci, cellId: c.cellId, rsrp: c.rsrp, rsrq: c.rsrq, sinr: c.sinr, rssi: c.rssi,
  } as CellTower));
}
export function tpCarriers(cells: TpCell[]): Carrier[] {
  return cells.filter(c => c.status === '1' || c.status === '2')
    .map(c => ({ tech: c.tech, band: c.band, role: c.status === '1' ? 'PCC' as const : 'SCC' as const, arfcn: c.arfcn, pci: c.pci, bandwidth: c.bwMhz, rsrp: c.rsrp, rsrq: c.rsrq, sinr: c.sinr }));
}

/* ═══ الترددات ووضع الشبكة (AUTH ١٥ نوفمبر ٤:٣٨ م + advanceLte.htm) ═══
 * go DEV2_LTE_BAND_SEARCH (stack 1,0,0,0,0,0): selectedMode 1 تلقائي / 2 يدوي · selectedBand "B1;B3" ·
 *   supportBandList "W1;…;B1;B3;…;N1;N3;…;N78" (5G ممكن تجي بلاحقة N/S — الصفحة تشيلها في العرض)
 * الحفظ في الصفحة: $.dm.set (operation "so") DEV2_LTE_BAND_SEARCH {selectedMode, selectedBand, stack}
 *   والترددات اللي تنكتب حسب وضع الشبكة: «4G Only/4G Preferred» = ترددات 4G بس · «5G Only» = 5G بس ·
 *   «5G/4G» و «5G Preferred» = الاثنين.
 * وضع الشبكة: DEV2_LTE_WAN_CFG {networkPreferredModeSelected: "5G Preferred"…} — الخيارات من networkPreferredModeOptionList.
 *   الصفحة ترفض «4G Only» لو الترددات اليدوية بدون B، و«5G Only» لو بدون N.
 */
export interface TpBands { manual: boolean; lte: number[]; nr: number[]; supLte: number[]; supNr: number[]; raw: string; mode: string; modes: string[] }

const bandNums = (list: string, p: 'B' | 'N') => [...new Set(String(list ?? '').split(/[;,\s]+/)
  .map(x => x.trim().toUpperCase()).filter(x => x.startsWith(p)).map(x => Number(x.slice(1).replace(/[NS]$/, ''))).filter(n => n > 0))].sort((a, b) => a - b);

export function tpBands(bs: Record<string, unknown> | null, wan: Record<string, unknown> | null): TpBands {
  const raw = String(bs?.selectedBand ?? '');
  return {
    manual: String(bs?.selectedMode ?? '1') === '2',
    lte: bandNums(raw, 'B'), nr: bandNums(raw, 'N'),
    supLte: bandNums(String(bs?.supportBandList ?? ''), 'B'), supNr: bandNums(String(bs?.supportBandList ?? ''), 'N'),
    raw, mode: String(wan?.networkPreferredModeSelected ?? ''),
    modes: String(wan?.networkPreferredModeOptionList ?? '').split(',').map(x => x.trim()).filter(Boolean),
  };
}
/** وش اللي مثبّت فعلاً لكل تقنية — اختيار كل المدعوم = تلقائي */
export function tpLocked(b: TpBands): { lte: number[]; nr: number[] } {
  if (!b.manual) return { lte: [], nr: [] };
  const all = (x: number[], sup: number[]) => sup.length > 0 && sup.every(n => x.includes(n));
  return { lte: all(b.lte, b.supLte) ? [] : b.lte, nr: all(b.nr, b.supNr) ? [] : b.nr };
}
export const tpBandValue = (lte: number[], nr: number[]) =>
  [...[...lte].sort((a, b) => a - b).map(n => 'B' + n), ...[...nr].sort((a, b) => a - b).map(n => 'N' + n)].join(';');

export const tpModeHas = (mode: string) => ({
  lte: !/^5G Only$/i.test(mode) && !/^3G/i.test(mode),
  nr: /^(5G\/4G|5G Preferred|5G Only)$/i.test(mode),
});

/**
 * الإعداد الجديد للصفحة (selectedMode + selectedBand) — نفس منطق حفظ advanceLte.htm.
 * lte/nr: [] = تلقائي لهالتقنية. اللي تلقائي يتعبّى بكل المدعوم (عشان تثبيت 4G ما يقطع 5G).
 * يرجّع {error} لو الطلب ما يمشي مع وضع الشبكة الحالي.
 */
export function tpBandPlan(b: TpBands, lte: number[], nr: number[]): { mode: '1' | '2'; band: string } | { error: string } {
  const has = tpModeHas(b.mode);
  const badL = lte.filter(n => !b.supLte.includes(n)), badN = nr.filter(n => !b.supNr.includes(n));
  if (badL.length || badN.length) return { error: `راوترك ما يدعم ${[...badL.map(n => 'B' + n), ...badN.map(n => 'n' + n)].join(', ')} — ما غيّرنا شي.` };
  if (nr.length && !has.nr) return { error: `راوترك على «${b.mode}» — 5G مطفي. غيّر وضع الشبكة لـ «5G Preferred» أول. ما غيّرنا شي.` };
  if (lte.length && !has.lte) return { error: `راوترك على «${b.mode}» — 4G مطفي. غيّر وضع الشبكة أول. ما غيّرنا شي.` };
  if (!lte.length && !nr.length) return { mode: '1', band: '' };
  const L2 = has.lte ? (lte.length ? lte : b.supLte) : [];
  const N2 = has.nr ? (nr.length ? nr : b.supNr) : [];
  return { mode: '2', band: tpBandValue(L2, N2) };
}

const MODE_AR: Record<string, string> = {
  '5G/4G': '4G + 5G', '5G Preferred': '5G أول (مع 4G)', '5G Only': '5G فقط', '4G Preferred': '4G أول', '4G Only': '4G فقط', '3G Only': '3G فقط',
};
export const tpModeLabel = (m: string) => MODE_AR[m] ?? m;
