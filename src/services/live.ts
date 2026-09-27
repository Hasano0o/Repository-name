/**
 * وضع الفني — اتصال حيّ بين جوال العميل (ينشر القراءات) والفني (يشاهد ويوجّه).
 * السيرفر: live-server/app.py على has-host.com
 * ما ينرسل أي شي غير أرقام الإشارة — كلمة مرور الراوتر ما تطلع من الجوال.
 */
export const LIVE_BASE = 'https://has-host.com';
const WS_BASE = LIVE_BASE.replace(/^http/, 'ws');

export interface LiveReading {
  rsrp?: number; sinr?: number; band?: string; pci?: string; tech?: string;
  level?: string; score?: number; best?: number; pinned?: string | null; ts?: number;
}
export interface LiveReport {
  code: string; label: string; duration_sec: number; gain_db: number | null; ended: boolean;
  first: LiveReading | null; best: LiveReading | null; last: LiveReading | null;
}
export type CmdAction = 'lock_current' | 'lock_best' | 'unlock';
export const CMD_LABEL: Record<CmdAction, string> = {
  lock_current: 'ثبّت على البرج الحالي',
  lock_best: 'ثبّت على أفضل برج',
  unlock: 'فك التثبيت (رجوع للتلقائي)',
};
export const SAY_ORDER = ['left', 'right', 'up', 'down', 'slow', 'more', 'back', 'wait', 'stop'] as const;

export async function createLiveSession(label: string): Promise<{ code: string; token: string; url: string }> {
  const r = await fetch(`${LIVE_BASE}/live-api/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }),
  });
  if (!r.ok) {
    let msg = 'تعذّر فتح الجلسة';
    try { const j = await r.json(); if (j?.detail) msg = String(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function liveConfig(): Promise<{ require_tech_key: boolean }> {
  try { return await (await fetch(`${LIVE_BASE}/live-api/config`)).json(); }
  catch { return { require_tech_key: false }; }
}

export async function checkTechKey(key: string): Promise<{ ok: boolean; name?: string; expires?: number }> {
  try { return await (await fetch(`${LIVE_BASE}/live-api/tech/check?key=${encodeURIComponent(key)}`)).json(); }
  catch { return { ok: false }; }
}

export function reportText(r: LiveReport, tech?: string) {
  const f = (x: LiveReading | null) =>
    x ? `\u2066${x.rsrp} dBm\u2069${x.band ? ` (${x.band}${x.pci ? ` · PCI ${x.pci}` : ''})` : ''}` : '—';
  const g = r.gain_db === null ? '—' : `${r.gain_db > 0 ? '+' : ''}${r.gain_db} dB`;
  return `📡 تقرير ضبط الإشارة — Bandly\n\nقبل: ${f(r.first)}\nبعد: ${f(r.last)}\nأفضل قراءة: ${f(r.best)}\nالتحسن: ${g}\nالمدة: ${Math.max(1, Math.round(r.duration_sec / 60))} دقيقة${tech ? `\nالفني: ${tech}` : ''}`;
}

type Msg = { t: string; [k: string]: any };

/** اتصال WebSocket يعيد الاتصال تلقائياً */
class Link {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retry = 0;
  private closed = false;
  constructor(private url: string, private onMsg: (m: Msg) => void,
              private onState: (s: 'on' | 'off' | 'dead', code?: number) => void) {}

  open() {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.onState('on'); };
    ws.onmessage = e => { try { this.onMsg(JSON.parse(String(e.data))); } catch {} };
    ws.onclose = e => {
      if (this.ws !== ws) return;
      this.ws = null;
      // 44xx = رفض نهائي من السيرفر (كود غلط / مفتاح غلط / جلسة منتهية)
      if (this.closed || (e.code >= 4400 && e.code < 4500)) { this.onState('dead', e.code); return; }
      this.onState('off');
      setTimeout(() => this.open(), Math.min(10000, 1500 * ++this.retry));
    };
    ws.onerror = () => {};
    if (!this.timer) this.timer = setInterval(() => this.send({ t: 'ping' }), 20000);
  }
  send(m: Msg) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(m)); } catch {}
    }
  }
  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }
}

/** جهة العميل: ينشر القراءات ويستقبل التعليمات والأوامر */
export class LiveHost {
  private link: Link;
  constructor(public code: string, token: string, h: {
    onViewers?: (n: number, names: string[]) => void;
    onSay?: (text: string, from: string) => void;
    onCmd?: (id: number, action: CmdAction, from: string) => void;
    onEnd?: (why: string, report: LiveReport | null) => void;
    onState?: (s: 'on' | 'off' | 'dead') => void;
  }) {
    this.link = new Link(
      `${WS_BASE}/live-api/pub/${code}?token=${token}`,
      m => {
        if (m.t === 'viewers') h.onViewers?.(m.n ?? 0, m.names ?? []);
        else if (m.t === 'say') h.onSay?.(String(m.text ?? ''), String(m.from ?? 'الفني'));
        else if (m.t === 'cmd') h.onCmd?.(Number(m.id), m.action, String(m.from ?? 'الفني'));
        else if (m.t === 'end') { this.link.close(); h.onEnd?.(m.why, m.report ?? null); }
      },
      s => h.onState?.(s),
    );
    this.link.open();
  }
  send(r: LiveReading) { this.link.send({ t: 'r', ...r }); }
  result(id: number, ok: boolean, msg: string) { this.link.send({ t: 'cmd_result', id, ok, msg }); }
  end() { this.link.send({ t: 'end' }); setTimeout(() => this.link.close(), 800); }
  close() { this.link.close(); }
}

/** جهة الفني: يشاهد ويرسل */
export class LiveViewer {
  private link: Link;
  constructor(code: string, key: string, name: string, h: {
    onHello?: (m: { label: string; customer: boolean; history: LiveReading[]; say: Record<string, string>;
      ended: boolean; report: LiveReport | null }) => void;
    onReading?: (r: LiveReading) => void;
    onCustomer?: (online: boolean) => void;
    onCmdSent?: (action: CmdAction, delivered: boolean) => void;
    onCmdResult?: (ok: boolean, msg: string) => void;
    onEnd?: (why: string, report: LiveReport | null) => void;
    onState?: (s: 'on' | 'off' | 'dead', code?: number) => void;
  }) {
    const q = `key=${encodeURIComponent(key)}&name=${encodeURIComponent(name)}`;
    this.link = new Link(
      `${WS_BASE}/live-api/sub/${code}?${q}`,
      m => {
        if (m.t === 'hello') h.onHello?.(m as any);
        else if (m.t === 'r') h.onReading?.(m as LiveReading);
        else if (m.t === 'status') h.onCustomer?.(!!m.customer);
        else if (m.t === 'cmd_sent') h.onCmdSent?.(m.action, !!m.delivered);
        else if (m.t === 'cmd_result') h.onCmdResult?.(!!m.ok, String(m.msg ?? ''));
        else if (m.t === 'end') { this.link.close(); h.onEnd?.(m.why, m.report ?? null); }
      },
      (s, c) => h.onState?.(s, c),
    );
    this.link.open();
  }
  say(k: string) { this.link.send({ t: 'say', k }); }
  cmd(action: CmdAction) { this.link.send({ t: 'cmd', action }); }
  close() { this.link.close(); }
}
