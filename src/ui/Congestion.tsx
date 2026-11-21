import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { Signal, Carrier } from '../drivers/types';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { quickDownload } from '../utils/speedtest';
import { expectedMbps, judgeProbe, ProbeResult } from '../utils/loadProbe';
import {
  estimateLoad, smoothLoad, loadLevel, LOAD_LABEL, LOAD_COLOR, LoadSample,
  loadSamples, recordLoad, hourlyProfile, peakSentence,
} from '../utils/congestion';
import { C, R, S, tBg, tFg } from './theme';

import { sheet } from '../i18n';
const NOTE = {
  free: 'البرج شبه فاضي — السرعة اللي تشوفها هي أقصى ما تعطيه إشارتك.',
  normal: 'ضغط طبيعي على البرج.',
  busy: 'فيه ناس كثير على البرج — السرعة تنزل شوي حتى لو الإشارة قوية.',
  packed: 'البرج مضغوط بقوة — هذا سبب البطء مو إشارتك. جرّب وقت ثاني، أو تردد/برج ثاني من شاشة الأبراج.',
};

/** يسجّل زحمة البرج كل ٤ دقائق (لما ما تحمّل) ويرجع السجل */
export function useLoadHistory(routerId: string, signal: Signal | null, downBps?: number) {
  const [list, setList] = useState<LoadSample[]>([]);
  const listRef = useRef<LoadSample[] | null>(null);

  useEffect(() => {
    let alive = true;
    loadSamples(routerId).then(l => { if (alive) { listRef.current = l; setList(l); } });
    return () => { alive = false; };
  }, [routerId]);

  const own = (downBps ?? 0) > 150_000; // تحميلك أنت يرفع الرقم — ما نقيس وقتها
  const raw = signal && !own ? estimateLoad(signal.rsrq, signal.sinr) : undefined;
  // وسيط آخر ٥ قراءات لنفس البرج (يتصفّر لو تغيّر البرج)
  const recent = useRef<{ pci?: string; v: number[] }>({ v: [] });
  if (raw !== undefined) {
    if (recent.current.pci !== signal?.pci) recent.current = { pci: signal?.pci, v: [] };
    const last = recent.current.v;
    if (last[last.length - 1] !== raw || last.length < 2) recent.current.v = [...last, raw].slice(-5);
  }
  const load = raw === undefined ? undefined : smoothLoad(recent.current.v);

  useEffect(() => {
    if (load === undefined || own || !listRef.current) return;
    recordLoad(routerId, { t: Date.now(), load, pci: signal?.pci }, listRef.current).then(next => {
      if (next !== listRef.current) { listRef.current = next; setList(next); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, own, routerId]);

  return { list, load, own };
}

const PROBE_COLOR: Record<ProbeResult['level'], string> = { ...LOAD_COLOR, weak: C.sub };

/** «قِس الزحمة الحين»: تنزيل ٦ ثواني + تحميل الراوتر كله، مقابل السرعة اللي تسمح فيها الإشارة */
function LoadProbe({ router }: { router: SavedRouter }) {
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(0);
  const [res, setRes] = useState<ProbeResult | null>(null);
  const [err, setErr] = useState('');

  const run = async () => {
    setRunning(true); setRes(null); setErr(''); setLive(0);
    try {
      const [sig, carriers] = await withSession(router, async d => [
        d.getSignal ? await d.getSignal().catch(() => null) : null,
        d.getCarriers ? await d.getCarriers().catch(() => [] as Carrier[]) : ([] as Carrier[]),
      ] as const);
      const exp = sig ? expectedMbps(sig, carriers) : undefined;
      if (exp === undefined) { setErr('راوترك ما يعطي نقاء الإشارة (SINR)، فما نقدر نحسب السرعة المفروضة.'); return; }
      // تحميل الراوتر كله وقت الاختبار (يشمل الأجهزة الثانية) — ناخذ الأعلى
      let routerMax = 0;
      let done = false;
      const poll = (async () => {
        await new Promise(r => setTimeout(r, 1500));
        while (!done) {
          const t = await withSession(router, async d => (d.getTraffic ? d.getTraffic() : null)).catch(() => null);
          if (t?.downBytesPerSec) routerMax = Math.max(routerMax, (t.downBytesPerSec * 8) / 1e6);
          await new Promise(r => setTimeout(r, 1200));
        }
      })();
      let phone = 0;
      try {
        phone = (await quickDownload(6000, m => setLive(m))).mbps;
      } finally {
        done = true;
        await poll;
      }
      const r = judgeProbe(Math.max(phone, routerMax), exp);
      if (r) setRes(r); else setErr('ما قدرنا نحسب النتيجة — جرّب مرة ثانية.');
    } catch (e: any) {
      setErr(e?.message ?? 'ما قدرنا نقيس — تأكد إن النت شغال');
    } finally {
      setRunning(false);
    }
  };

  return (
    <View style={s.probe}>
      <Pressable onPress={run} disabled={running} style={({ pressed }) => [s.probeBtn, (pressed || running) && { opacity: 0.8 }]}>
        {running ? (
          <View style={s.probeRow}>
            <ActivityIndicator color="#fff" />
            <Text style={s.probeBtnTxt}>نقيس… {live > 0 ? `${Math.round(live)} ميقا` : ''}</Text>
          </View>
        ) : (
          <Text style={s.probeBtnTxt}>⚡ قِس الزحمة الحين</Text>
        )}
      </Pressable>
      {!res && !err && !running && (
        <Text style={s.tiny}>اختبار تنزيل ٦ ثواني يقارن سرعتك باللي تسمح فيه إشارتك — يشتغل حتى مع التشويش، ويستهلك تقريباً ١٠–١٠٠ ميقا.</Text>
      )}
      {!!err && <Text style={s.note}>{err}</Text>}
      {res && (
        <View style={s.probeRes}>
          <Text style={[s.probeTitle, { color: PROBE_COLOR[res.level] }]}>
            {res.title}{res.load !== undefined ? ` · ${Math.round(res.load * 100)}٪` : ''}
          </Text>
          <Text style={s.probeNums}>وصلك {Math.round(res.gotMbps)} ميقا من حوالي {Math.round(res.expMbps)} تسمح فيها إشارتك</Text>
          <Text style={s.note}>{res.note}</Text>
          <Text style={s.tiny}>💡 قِس وجوالك قريب من الراوتر (أو على 5GHz) — الواي فاي الضعيف ينزّل النتيجة.</Text>
        </View>
      )}
    </View>
  );
}

/** بطاقة زحمة البرج + أوقات الزحمة عبر اليوم */
export function CongestionCard({ routerId, signal, downBps, history, router }: {
  routerId: string; signal: Signal | null; downBps?: number;
  /** لو موجود يطلع زر «قِس الزحمة الحين» */
  router?: SavedRouter;
  /** لو السجل جاي من برا (useLoadHistory) ما نسجّل مرتين */
  history?: { list: LoadSample[]; load?: number; own: boolean };
}) {
  const inner = useLoadHistory(history ? '' : routerId, history ? null : signal, downBps);
  const { list, load, own } = history ?? inner;

  if (!signal) return null;
  const lv = load !== undefined ? loadLevel(load) : undefined;
  const { avg, count } = hourlyProfile(list);
  const enough = list.length >= 12;
  const nowH = new Date().getHours();
  const peak = peakSentence(list);

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title}>زحمة البرج</Text>
        {lv && !own && (
          <Text style={[s.badge, { color: LOAD_COLOR[lv] }]}>{LOAD_LABEL[lv]} · {Math.round(load! * 100)}٪</Text>
        )}
      </View>

      {own ? (
        <Text style={s.note}>تحمّل الحين — ننتظر لين يهدأ التحميل عشان نقيس زحمة البرج بدقة.</Text>
      ) : lv ? (
        <>
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.max(4, Math.round(load! * 100))}%`, backgroundColor: LOAD_COLOR[lv] }]} />
          </View>
          <Text style={s.note}>{NOTE[lv]}</Text>
        </>
      ) : (
        <Text style={s.note}>{router ? 'التشويش عالي الحين، فالتقدير السريع ما يقدر يفرّق بين الزحمة والتشويش — استخدم «قِس الزحمة الحين» تحت.' : 'التشويش عالي الحين، فما نقدر نفرّق بين الزحمة والتشويش.'}</Text>
      )}

      {!!router && <LoadProbe router={router} />}

      <View style={s.sep} />
      <Text style={s.sub}>الزحمة عبر اليوم</Text>
      {enough ? (
        <>
          <View style={s.bars}>
            {avg.map((v, h) => (
              <View key={h} style={s.barCol}>
                <View style={[
                  s.bar,
                  {
                    height: v === undefined ? 3 : Math.max(4, Math.round(v * 44)),
                    backgroundColor: v === undefined ? C.track : LOAD_COLOR[loadLevel(v)],
                    opacity: h === nowH ? 1 : 0.8,
                  },
                  h === nowH && s.barNow,
                ]} />
              </View>
            ))}
          </View>
          <View style={s.axis}>
            {['12ص', '6ص', '12ظ', '6م', '11م'].map(t => <Text key={t} style={s.axisT}>{t}</Text>)}
          </View>
          {!!peak && <Text style={s.peak}>{peak}</Text>}
          <Text style={s.tiny}>من {list.length} قياس خلال {count.filter(c => c > 0).length} ساعة مختلفة</Text>
        </>
      ) : (
        <Text style={s.note}>
          نسجّل الزحمة كل ما فتحت التطبيق. بعد كم يوم استخدام نوريك أوقات الزحمة وأفضل وقت للتحميل.
          ({list.length} من 12 قياس)
        </Text>
      )}
    </View>
  );
}

const s = sheet({
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: R.lg, padding: S.lg, gap: S.sm },
  head: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: C.text, fontWeight: '800', fontSize: 15, textAlign: 'right' },
  badge: { fontWeight: '800', fontSize: 13 },
  track: { height: 7, borderRadius: R.pill, backgroundColor: C.track, overflow: 'hidden', flexDirection: 'row-reverse' },
  fill: { height: '100%', borderRadius: R.pill },
  note: { color: C.sub, fontSize: 12, lineHeight: 18, textAlign: 'right' },
  sep: { height: 1, backgroundColor: C.lineSoft, marginVertical: 4 },
  sub: { color: C.text, fontWeight: '700', fontSize: 13, textAlign: 'right' },
  // الساعات من اليسار (١٢ص) لليمين (١١م) مثل أي رسم زمني
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 48, gap: 2, direction: 'ltr' },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 2 },
  barNow: { borderWidth: 1, borderColor: C.text },
  axis: { flexDirection: 'row', justifyContent: 'space-between', direction: 'ltr' },
  axisT: { color: C.muted, fontSize: 10 },
  peak: { color: C.text, fontSize: 12.5, fontWeight: '600', textAlign: 'right', lineHeight: 19 },
  tiny: { color: C.muted, fontSize: 10.5, textAlign: 'right' },
  probe: { gap: 6, marginTop: 2 },
  probeBtn: { backgroundColor: tBg('#2563eb'), borderRadius: 14, paddingVertical: 11, alignItems: 'center' },
  probeRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  probeBtnTxt: { color: tFg('#ffffff'), fontWeight: '800', fontSize: 14 },
  probeRes: { gap: 4, backgroundColor: C.rowBg, borderRadius: 14, padding: S.md },
  probeTitle: { fontWeight: '900', fontSize: 15, textAlign: 'right' },
  probeNums: { color: C.text, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
});
