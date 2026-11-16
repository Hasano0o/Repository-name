/**
 * «هل يفيدك مسرّع؟» — في مُحسّن الألعاب. تطلع بس لو فيه سيرفر مسرّع في إعدادات الرسيفر.
 * المنطق: src/utils/accelCore.ts · القياس والإرسال: src/services/accel.ts
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { SavedRouter } from '../store/routers';
import { GameRegion } from '../utils/latency';
import { AccelServer } from '../utils/accelCore';
import { AccelResult, accelServers, checkAccel, reportAccel } from '../services/accel';
import { currentNet } from '../services/community';
import { GlassCard } from './GlassCard';
import { C } from './theme';
import { FONT } from './fonts';
import { sheet } from '../i18n';

export function AccelCheckCard({ info, reg, disabled }: { info: SavedRouter; reg: GameRegion; disabled?: boolean }) {
  const [servers, setServers] = useState<AccelServer[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [res, setRes] = useState<AccelResult | null>(null);

  useEffect(() => { accelServers().then(setServers).catch(() => {}); }, []);
  useEffect(() => { setRes(null); }, [reg.id]);

  if (!servers.length || reg.id === 'cf') return null;

  const run = async () => {
    setBusy(true); setRes(null);
    try {
      const op = (await currentNet(info).catch(() => null))?.operator ?? '';
      let best: AccelResult | null = null;
      for (const sv of servers) {
        const r = await checkAccel(sv, reg, setStep);
        if (r.verdict.kind !== 'fail' && (!best || best.verdict.kind === 'fail' || r.verdict.via < best.verdict.via)) best = r;
        else if (!best) best = r;
        reportAccel(r, reg.id, op).catch(() => {});
      }
      setRes(best);
    } finally {
      setBusy(false); setStep('');
    }
  };

  const v = res?.verdict;
  const color = !v ? C.text : v.kind === 'helps' ? C.green : v.kind === 'small' ? '#e0a100' : v.kind === 'no' ? C.blue : C.red;

  return (
    <GlassCard title="هل يفيدك مسرّع؟" icon="🚀" tint={C.cyanSoft} collapsible={false}>
      <Text style={s.sub}>نقارن طريقك المباشر لسيرفرات {reg.name} مع الطريق عن طريق سيرفر Bandly في السعودية</Text>

      {!!res && v && (
        <View style={s.box}>
          {v.kind === 'helps' && v.direct > 0 && <Text style={[s.lead, { color }]}>المسرّع ينقص بنقك {v.gain}ms ✅</Text>}
          {v.kind === 'helps' && v.direct === 0 && <Text style={[s.lead, { color }]}>طريقك المباشر ما يوصل، والمسرّع يوصلك ✅</Text>}
          {v.kind === 'small' && <Text style={[s.lead, { color }]}>فرق بسيط ({v.gain}ms) — ما بتحس فيه كثير</Text>}
          {v.kind === 'no' && v.direct <= 70 && <Text style={[s.lead, { color }]}>طريقك أصلاً ممتاز — ما تحتاج مسرّع</Text>}
          {v.kind === 'no' && v.direct > 70 && <Text style={[s.lead, { color }]}>المسرّع ما يفيدك لهالسيرفر — طريقك المباشر أقصر</Text>}
          {v.kind === 'fail' && <Text style={[s.lead, { color }]}>ما قدرنا نوصل سيرفر المسرّع الحين — جرّب بعد شوي</Text>}
          {v.kind !== 'fail' && (
            <View style={s.row}>
              <View style={s.tile}>
                <Text style={s.tileLbl}>مباشر</Text>
                <Text style={s.tileVal}>{v.direct ? `${v.direct}ms` : '—'}</Text>
                <Text style={s.tileSub}>فقد {res.direct.lossPct}%</Text>
              </View>
              <View style={[s.tile, { borderColor: color }]}>
                <Text style={s.tileLbl}>عبر المسرّع</Text>
                <Text style={[s.tileVal, { color }]}>{v.via}ms</Text>
                <Text style={s.tileSub}>فقد {v.viaLoss}%</Text>
              </View>
            </View>
          )}
          {v.kind !== 'fail' && <Text style={s.hint}>طريقك لسيرفر {res.server.name}: {res.toServer.median}ms + منه لسيرفر اللعبة: {res.route?.median ?? 0}ms</Text>}
          {v.kind !== 'fail' && <Text style={s.hint}>رقم تقريبي من قياس الطريقين</Text>}
        </View>
      )}

      {busy && (
        <View style={s.status}>
          <ActivityIndicator color={C.blue} />
          <Text style={s.statusTxt}>{step}</Text>
        </View>
      )}

      <Pressable style={[s.btn, (busy || disabled) && s.dim]} onPress={run} disabled={busy || disabled}>
        <Text style={s.btnTxt}>{busy ? 'نقيس...' : res ? 'قِس مرة ثانية' : 'افحص (15 ثانية تقريباً)'}</Text>
      </Pressable>
    </GlassCard>
  );
}

const s = sheet({
  sub: { color: C.sub, fontSize: 12, textAlign: 'right', lineHeight: 18 },
  box: { marginTop: 10, gap: 8 },
  lead: { fontSize: 15, fontWeight: '800', textAlign: 'right' },
  row: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, borderWidth: 1, borderColor: C.track, borderRadius: 14, padding: 10, alignItems: 'center' },
  tileLbl: { color: C.sub, fontSize: 12 },
  tileVal: { color: C.text, fontSize: 22, fontWeight: '800', fontFamily: FONT.num },
  tileSub: { color: C.muted, fontSize: 11 },
  hint: { color: C.muted, fontSize: 11, textAlign: 'center' },
  status: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10 },
  statusTxt: { color: C.sub, fontSize: 12, flex: 1, textAlign: 'right' },
  btn: { backgroundColor: C.blue, borderRadius: 14, padding: 13, alignItems: 'center', marginTop: 12 },
  btnTxt: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  dim: { opacity: 0.5 },
});
