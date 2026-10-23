/**
 * اختبار السرعة — عدّاد بإبرة يتحرك مباشرة + كل القياسات:
 * التنزيل، الرفع، البنق، التذبذب، البنق تحت الضغط، الخادم والشركة، ووش يكفي له اتصالك.
 * التصميم بهوية Bandly (أزرق للتنزيل، بنفسجي للرفع) — مو نسخة من أي تطبيق ثاني.
 */
import { useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import { Animated, Easing, ScrollView } from 'react-native';
import { View, Text, Pressable } from '../../src/i18n/rn';
import { useLocalSearchParams } from 'expo-router';
import Svg, { Path, Circle, Line, Defs, LinearGradient as SvgGrad, Stop, Text as SvgText } from 'react-native-svg';
import { runSpeedTest, SpeedResult, SpeedProgress, SpeedPhase, ratingsFor } from '../../src/utils/speedtest';
import { getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { Icon, IconName } from '../../src/ui/Icon';
import { C, R, S, tBg, tBd, tFg } from '../../src/ui/theme';
import { sheet } from '../../src/i18n';

const DOWN = '#2f6bff';
const DOWN2 = '#22c3e6';
const UP = '#7c5cff';
const UP2 = '#c084fc';

// ═══ العدّاد: ٢٤٠ درجة، تدريج غير خطي (السرعات الصغيرة تاخذ مساحة أكبر) ═══
const TICKS = [0, 5, 10, 50, 100, 250, 500, 750, 1000];
const SIZE = 280;
const CX = SIZE / 2;
const CY = SIZE / 2 + 8;
const RAD = 112;
const START = 150; // درجة (من اليمين باتجاه عقارب الساعة)
const SWEEP = 240;
/** طول الإبرة — أقصر من الأرقام عشان ما تغطيها */
const NEEDLE = RAD - 48;

/** السرعة ← ٠..١ على طول القوس */
function frac(v: number): number {
  if (v <= 0) return 0;
  const last = TICKS.length - 1;
  if (v >= TICKS[last]) return 1;
  for (let i = 1; i <= last; i++) {
    if (v <= TICKS[i]) {
      const a = TICKS[i - 1], b = TICKS[i];
      return (i - 1 + (v - a) / (b - a)) / last;
    }
  }
  return 1;
}
const rad = (deg: number) => (deg * Math.PI) / 180;
const pt = (deg: number, r: number) => ({ x: CX + r * Math.cos(rad(deg)), y: CY + r * Math.sin(rad(deg)) });
function arc(f0: number, f1: number, r = RAD): string {
  const a0 = START + SWEEP * f0;
  const a1 = START + SWEEP * Math.max(f0 + 0.0001, f1);
  const p0 = pt(a0, r), p1 = pt(a1, r);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`;
}
const fmtMbps = (v?: number) => (v === undefined ? '—' : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const tickLabel = (t: number) => (t >= 1000 ? '1k' : String(t));

const PHASE_TXT: Record<SpeedPhase, string> = {
  meta: 'نجهّز…', ping: 'نقيس البنق…', download: 'التنزيل', upload: 'الرفع', done: 'خلص ✓',
};

function Gauge({ value, phase }: { value: number; phase: SpeedPhase | 'idle' }) {
  const isUp = phase === 'upload';
  const needle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(needle, { toValue: frac(value), duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [value, needle]);
  const rotate = needle.interpolate({ inputRange: [0, 1], outputRange: [`${START + 90}deg`, `${START + SWEEP + 90}deg`] });
  const f = frac(value);
  const c1 = isUp ? UP : DOWN;
  const c2 = isUp ? UP2 : DOWN2;

  return (
    <View style={{ width: SIZE, height: SIZE - 30, alignItems: 'center' }}>
      <Svg width={SIZE} height={SIZE - 30}>
        <Defs>
          <SvgGrad id="g" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={c2} />
            <Stop offset="1" stopColor={c1} />
          </SvgGrad>
        </Defs>
        <Path d={arc(0, 1)} stroke={C.track} strokeWidth={22} fill="none" strokeLinecap="round" />
        {f > 0.002 && <Path d={arc(0, f)} stroke="url(#g)" strokeWidth={22} fill="none" strokeLinecap="round" />}
        {TICKS.map((t, i) => {
          const deg = START + (SWEEP * i) / (TICKS.length - 1);
          const p = pt(deg, RAD - 34);
          const a = pt(deg, RAD - 16), b = pt(deg, RAD - 20);
          return (
            <G2 key={t}>
              <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={C.muted} strokeWidth={2} />
              <SvgText x={p.x} y={p.y + 4} fontSize={11.5} fontWeight="700" fill={C.sub} textAnchor="middle">{tickLabel(t)}</SvgText>
            </G2>
          );
        })}
        <Circle cx={CX} cy={CY} r={9} fill={c1} />
      </Svg>
      {/* الإبرة: طبقة تدور حول مركز القوس */}
      <Animated.View pointerEvents="none" style={[s.needleWrap, { left: CX - 2, top: CY - NEEDLE, height: NEEDLE * 2, transform: [{ rotate }] }]}>
        <View style={[s.needle, { backgroundColor: c1 }]} />
      </Animated.View>
    </View>
  );
}
// react-native-svg G بدون استيراد إضافي للأنواع
const G2 = ({ children }: { children: ReactNode }) => <>{children}</>;

function Box({ icon, label, value, color, active }: { icon: IconName; label: string; value?: number; color: string; active: boolean }) {
  return (
    <View style={[s.box, { borderColor: active ? tBd(color + 'aa') : C.cardBorder, backgroundColor: active ? tBg(color + '12') : C.card }]}>
      <View style={s.boxHead}>
        <Icon name={icon} size={16} color={tFg(color)} stroke={2.4} />
        <Text style={[s.boxLabel, { color: tFg(color) }]}>{label}</Text>
      </View>
      <Text style={[s.boxValue, value === undefined && { color: C.muted }]}>{fmtMbps(value)}</Text>
      <Text style={s.boxUnit}>Mbps</Text>
    </View>
  );
}

function Mini({ label, value, unit, color }: { label: string; value?: number; unit: string; color: string }) {
  return (
    <View style={s.mini}>
      <Text style={s.miniLabel}>{label}</Text>
      <Text style={[s.miniValue, { color: value === undefined ? C.muted : tFg(color) }]}>
        {value === undefined ? '—' : Math.round(value)}<Text style={s.miniUnit}> {unit}</Text>
      </Text>
    </View>
  );
}

const RATING_ICON: Record<string, IconName> = { browse: 'globe', video: 'tv', game: 'game', call: 'call' };
const dotColor = (score: number) => (score >= 4 ? '#12b76a' : score >= 3 ? '#5ba644' : score >= 2 ? '#f79009' : '#e5484d');

export default function SpeedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [running, setRunning] = useState(false);
  const [prog, setProg] = useState<SpeedProgress | null>(null);
  const [res, setRes] = useState<SpeedResult | null>(null);
  const [err, setErr] = useState('');
  const [op, setOp] = useState<string | undefined>();
  const alive = useRef(true);
  const cancel = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; cancel.current = true; };
  }, []);

  // الشركة من الراوتر نفسه (أدق من عنوان الآي بي) — قراءة فقط، ولو فشلت عادي
  useEffect(() => {
    if (!id) return;
    getRouter(id).then(r => r && withSession(r, async d => (d.getNetworkInfo ? d.getNetworkInfo() : null), false))
      .then(n => { if (alive.current && n?.operator) setOp(n.operator); })
      .catch(() => {});
  }, [id]);

  const run = useCallback(async () => {
    if (running) return;
    cancel.current = false;
    setRunning(true); setErr(''); setRes(null); setProg({ phase: 'meta' });
    try {
      const r = await runSpeedTest(p => { if (alive.current) setProg(p); }, () => cancel.current || !alive.current);
      if (alive.current) setRes(r);
    } catch (e: any) {
      if (alive.current) setErr(e?.message ?? 'فشل الاختبار');
    } finally {
      if (alive.current) setRunning(false);
    }
  }, [running]);

  // يبدأ لحاله أول ما تنفتح الشاشة (سواء من الأدوات أو من المساعد ?auto=1)
  const first = useRef(false);
  useEffect(() => { if (!first.current) { first.current = true; run(); } }, [run]);

  const phase: SpeedPhase | 'idle' = prog?.phase ?? 'idle';
  const live = phase === 'download' || phase === 'upload' ? prog?.mbps ?? 0 : res ? res.downloadMbps : 0;
  const down = res?.downloadMbps ?? (phase === 'upload' || phase === 'done' ? prog?.downloadMbps : phase === 'download' ? prog?.mbps : undefined);
  const up = res?.uploadMbps ?? (phase === 'upload' ? prog?.mbps : undefined);
  const ping = res?.pingMs ?? prog?.pingMs;
  const jitter = res?.jitterMs ?? prog?.jitterMs;
  const loaded = res?.loadedPingMs ?? prog?.loadedPingMs;
  const server = res?.server ?? prog?.server;
  const isp = op ?? res?.isp ?? prog?.isp;
  const centerColor = phase === 'upload' ? UP : DOWN;
  const ratings = res ? ratingsFor(res) : null;
  const bloat = res?.loadedPingMs !== undefined && res.loadedPingMs - res.pingMs > 60;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={s.wrap}>
      {/* ═══ التنزيل والرفع ═══ */}
      <View style={s.boxes}>
        <Box icon="down" label="تنزيل" value={down} color={DOWN} active={phase === 'download'} />
        <Box icon="up" label="رفع" value={up} color={UP} active={phase === 'upload'} />
      </View>

      {/* ═══ البنق والتذبذب والبنق تحت الضغط ═══ */}
      <View style={s.minis}>
        <Mini label="البنق" value={ping} unit="ms" color="#12b76a" />
        <View style={s.sep} />
        <Mini label="التذبذب" value={jitter} unit="ms" color="#f79009" />
        <View style={s.sep} />
        <Mini label="البنق وقت التحميل" value={loaded} unit="ms" color="#ec4899" />
      </View>

      {/* ═══ العدّاد ═══ */}
      <View style={{ alignItems: 'center' }}>
        <Gauge value={live} phase={phase} />
        <View style={s.center} pointerEvents="none">
          <Text style={[s.big, { color: phase === 'idle' || phase === 'meta' || phase === 'ping' ? C.muted : C.text }]}>
            {phase === 'idle' || phase === 'meta' || phase === 'ping' ? '—' : fmtMbps(live)}
          </Text>
          <View style={s.centerRow}>
            {(phase === 'download' || phase === 'upload') && <Icon name={phase === 'upload' ? 'up' : 'down'} size={14} color={tFg(centerColor)} stroke={2.6} />}
            <Text style={[s.centerSub, { color: tFg(centerColor) }]}>{running ? PHASE_TXT[phase as SpeedPhase] ?? '' : res ? 'Mbps · تنزيل' : 'Mbps'}</Text>
          </View>
        </View>
      </View>

      {/* ═══ وش يكفي له اتصالك ═══ */}
      {ratings && (
        <View style={s.ratings}>
          {ratings.map(r => (
            <View key={r.key} style={s.rating}>
              <Icon name={RATING_ICON[r.key]} size={22} color={tFg(dotColor(r.score))} />
              <Text style={s.ratingLabel}>{r.label}</Text>
              <View style={s.dots}>
                {[0, 1, 2, 3, 4].map(i => (
                  <View key={i} style={[s.dot, { backgroundColor: i < r.score ? dotColor(r.score) : C.track }]} />
                ))}
              </View>
            </View>
          ))}
        </View>
      )}

      {bloat && (
        <View style={[s.note2, { borderColor: tBd('#ec489955'), backgroundColor: tBg('#ec489910') }]}>
          <Text style={s.note2Txt}>⚠️ البنق يرتفع كثير وقت التحميل ({res!.pingMs} ← {res!.loadedPingMs}ms) — هذا سبب اللاق لما أحد بالبيت يحمّل. «مُحسّن الألعاب» و«كاشف اللاق» يساعدونك.</Text>
        </View>
      )}

      {!!err && (
        <View style={[s.note2, { borderColor: tBd('#e5484d66'), backgroundColor: tBg('#e5484d10') }]}>
          <Text style={[s.note2Txt, { color: C.red, fontWeight: '800' }]}>تعذّر إكمال الاختبار</Text>
          <Text style={s.note2Txt}>{err}</Text>
        </View>
      )}

      {/* ═══ الخادم والشركة ═══ */}
      <View style={s.meta}>
        <View style={s.metaItem}>
          <Icon name="tower" size={18} color={C.sub} />
          <View>
            <Text style={s.metaTop}>{isp ?? 'شركتك'}</Text>
            <Text style={s.metaSub}>الشبكة</Text>
          </View>
        </View>
        <View style={s.metaItem}>
          <Icon name="globe" size={18} color={C.sub} />
          <View>
            <Text style={s.metaTop}>{server ? `Cloudflare · ${server}` : 'Cloudflare'}</Text>
            <Text style={s.metaSub}>خادم القياس</Text>
          </View>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [s.btn, running && { backgroundColor: C.red }, pressed && { opacity: 0.8 }]}
        onPress={() => (running ? (cancel.current = true) : run())}
        accessibilityRole="button"
      >
        <Icon name={running ? 'power' : 'refresh'} size={16} color={C.onAccent} />
        <Text style={s.btnTxt}>{running ? 'وقّف الاختبار' : res || err ? 'أعد الاختبار' : 'ابدأ'}</Text>
      </Pressable>

      <Text style={s.note}>
        {res ? `استهلك ${res.usedMB} ميقا تقريباً. ` : 'يستهلك تقريباً ٥٠–٣٠٠ ميقا حسب سرعتك. '}
        الرقم سرعة جوالك عبر الراوتر — لو الجوال على واي فاي بعيد أو 2.4، يشمل سرعة الواي فاي.
        {'\n'}خادم القياس: speed.cloudflare.com — ما نرسل أي بيانات شخصية.
      </Text>
    </ScrollView>
  );
}

const s = sheet({
  wrap: { padding: S.lg, gap: S.md, alignItems: 'stretch', paddingBottom: 40 },
  boxes: { flexDirection: 'row-reverse', gap: 10 },
  box: { flex: 1, borderWidth: 1.5, borderRadius: R.md, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', gap: 2 },
  boxHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  boxLabel: { fontWeight: '800', fontSize: 14 },
  boxValue: { color: C.text, fontSize: 30, fontWeight: '900', textAlign: 'center' },
  boxUnit: { color: C.muted, fontSize: 12, fontWeight: '700' },
  minis: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.md, paddingVertical: 10 },
  mini: { flex: 1, alignItems: 'center', gap: 2 },
  miniLabel: { color: C.sub, fontSize: 11.5, fontWeight: '700', textAlign: 'center' },
  miniValue: { fontSize: 18, fontWeight: '900', textAlign: 'center' },
  miniUnit: { fontSize: 11, fontWeight: '700', color: C.muted },
  sep: { width: 1, height: 30, backgroundColor: C.lineSoft },
  needleWrap: { position: 'absolute', width: 4, alignItems: 'center' },
  needle: { width: 4, height: '50%', borderRadius: 2 },
  center: { position: 'absolute', top: CY + 18, left: 0, right: 0, alignItems: 'center' },
  big: { fontSize: 40, fontWeight: '900', textAlign: 'center' },
  centerRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  centerSub: { fontSize: 13.5, fontWeight: '800' },
  ratings: { flexDirection: 'row-reverse', justifyContent: 'space-around', backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.md, paddingVertical: 12, marginTop: 6 },
  rating: { alignItems: 'center', gap: 4 },
  ratingLabel: { color: C.sub, fontSize: 11.5, fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  note2: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 4 },
  note2Txt: { color: C.text, fontSize: 13, lineHeight: 20, textAlign: 'right' },
  meta: { flexDirection: 'row-reverse', justifyContent: 'space-around', paddingVertical: 4 },
  metaItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  metaTop: { color: C.text, fontSize: 13.5, fontWeight: '800', textAlign: 'right' },
  metaSub: { color: C.muted, fontSize: 11, textAlign: 'right' },
  btn: { alignSelf: 'center', backgroundColor: C.blue, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 30, flexDirection: 'row-reverse', alignItems: 'center', gap: S.sm },
  btnTxt: { color: C.onAccent, fontWeight: '800', fontSize: 15 },
  note: { color: C.muted, fontSize: 11.5, textAlign: 'center', lineHeight: 18 },
});
