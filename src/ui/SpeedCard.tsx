/**
 * اختبار السرعة قبل وبعد التوجيه — داخل مساعد التوجيه.
 * «قبل» ينحفظ للراوتر (يبقى لو طلعت ورجعت)، و«بعد» تقيسه لما تخلص التوجيه.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Section, PrimaryBtn, P } from './Pro';
import { Icon } from './Icon';
import { speedTest, SpeedPhase, fmtMbps } from '../utils/speedLive';
import { SpeedPair, SpeedPoint } from '../services/live';

const KEY = (id: string) => `bandly_speed_${id}`;
const PHASE_TXT: Record<SpeedPhase, string> = { ping: 'نقيس البنق…', down: 'نقيس التحميل…', up: 'نقيس الرفع…' };

function Box({ title, p, other, tone }: { title: string; p?: SpeedPoint; other?: SpeedPoint; tone: string }) {
  const pct = p && other && other.down > 0 ? Math.round(((p.down - other.down) / other.down) * 100) : undefined;
  return (
    <View style={[st.box, { borderColor: tone + '44' }]}>
      <Text style={[st.boxTitle, { color: tone }]}>{title}</Text>
      {p ? (
        <>
          <View style={st.big}>
            <Text style={st.bigVal}>{fmtMbps(p.down)}</Text>
            <Text style={st.bigUnit}>Mbps ⬇</Text>
          </View>
          <Text style={st.small}>{`⁦⬆ ${fmtMbps(p.up)} Mbps · ${p.ping} ms⁩`}</Text>
          {pct !== undefined && (
            <Text style={[st.pct, { color: pct >= 0 ? '#0f9d5f' : P.red }]}>{`⁦${pct > 0 ? '+' : ''}${pct}%⁩`}</Text>
          )}
        </>
      ) : <Text style={st.empty}>ما قسناه للحين</Text>}
    </View>
  );
}

export function SpeedCard({ routerId, onResult, onPair }: {
  routerId: string; onResult?: (phase: 'before' | 'after', r: SpeedPoint, all: SpeedPair) => void;
  onPair?: (p: SpeedPair) => void;
}) {
  const [pair, setPair] = useState<SpeedPair>({});
  useEffect(() => { onPair?.(pair); }, [pair]); // eslint-disable-line react-hooks/exhaustive-deps
  const [run, setRun] = useState<{ which: 'before' | 'after'; phase: SpeedPhase; mbps?: number } | null>(null);
  const stop = useRef(false);
  useEffect(() => {
    AsyncStorage.getItem(KEY(routerId)).then(v => { if (v) try { setPair(JSON.parse(v)); } catch {} }).catch(() => {});
    return () => { stop.current = true; };
  }, [routerId]);

  const go = (which: 'before' | 'after') => {
    if (run) { stop.current = true; return; }
    stop.current = false;
    setRun({ which, phase: 'ping' });
    speedTest((phase, mbps) => setRun(r => (r ? { ...r, phase, mbps } : r)), () => stop.current)
      .then(res => {
        const p: SpeedPoint = { down: res.down, up: res.up, ping: res.ping, at: res.at };
        setPair(prev => {
          const next = { ...prev, [which]: p };
          if (which === 'before') delete next.after;   // قياس «قبل» جديد يبدأ مقارنة جديدة
          AsyncStorage.setItem(KEY(routerId), JSON.stringify(next)).catch(() => {});
          onResult?.(which, p, next);
          return next;
        });
      })
      .catch(e => { if (!stop.current) Alert.alert('ما كمل الاختبار', e?.message ?? String(e)); })
      .finally(() => setRun(null));
  };

  const reset = () => {
    setPair({});
    AsyncStorage.removeItem(KEY(routerId)).catch(() => {});
  };

  return (
    <Section title="السرعة قبل وبعد" sub="قِس قبل ما تحرّك الهوائي، وبعد ما تخلص — وشوف الفرق" icon="speed"
      tone={P.green} toneSoft={P.greenSoft}
      right={pair.before && !run ? (
        <Pressable onPress={reset} hitSlop={8}><Icon name="refresh" size={17} color={P.sub} /></Pressable>
      ) : undefined}>
      <View style={st.row}>
        <Box title="قبل" p={pair.before} tone={P.sub} />
        <Box title="بعد" p={pair.after} other={pair.before} tone={P.green} />
      </View>
      {run ? (
        <Pressable onPress={() => { stop.current = true; }} style={st.running}>
          <Text style={st.runTxt}>{PHASE_TXT[run.phase]}{run.mbps ? `  ⁦${fmtMbps(run.mbps)} Mbps⁩` : ''}</Text>
          <Text style={st.runStop}>إيقاف</Text>
        </Pressable>
      ) : (
        <PrimaryBtn small icon="speed" style={{ marginTop: 12 }}
          text={!pair.before ? 'قِس السرعة الحين (قبل الضبط)' : 'قِس السرعة بعد الضبط'}
          colors={['#12b76a', '#0ea5a0']}
          onPress={() => go(pair.before ? 'after' : 'before')} />
      )}
      <Text style={st.note}>القياس عبر الواي فاي من خوادم Cloudflare · يستهلك تقريباً ٢٠–١٥٠ ميقا حسب سرعتك</Text>
    </Section>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row-reverse', gap: 8, marginTop: 12 },
  box: { flex: 1, backgroundColor: P.soft, borderRadius: 16, padding: 12, alignItems: 'center', borderWidth: 1.5, minHeight: 104, justifyContent: 'center' },
  boxTitle: { fontSize: 12.5, fontWeight: '800', marginBottom: 2 },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  bigVal: { color: P.text, fontSize: 26, fontWeight: '800' },
  bigUnit: { color: P.sub, fontSize: 11, fontWeight: '700' },
  small: { color: P.sub, fontSize: 11.5, fontWeight: '700', marginTop: 2 },
  pct: { fontSize: 14, fontWeight: '800', marginTop: 4 },
  empty: { color: P.faint, fontSize: 12.5, fontWeight: '700', marginTop: 8 },
  running: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, backgroundColor: P.greenSoft, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14 },
  runTxt: { color: '#0b7a47', fontSize: 14, fontWeight: '800' },
  runStop: { color: P.red, fontSize: 13, fontWeight: '800' },
  note: { color: P.faint, fontSize: 10.5, textAlign: 'center', marginTop: 8 },
});
