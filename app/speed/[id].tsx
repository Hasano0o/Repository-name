import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';
import { runSpeedTest, SpeedResult } from '../../src/utils/speedtest';
import { Icon, IconName } from '../../src/ui/Icon';
import { MetricCard } from '../../src/ui/Cards';
import { C, R, S, T } from '../../src/ui/theme';

type Phase = 'idle' | 'running' | 'done' | 'error';

function Stat({ icon, label, value, unit, color }: {
  icon: IconName; label: string; value: string; unit: string; color: string;
}) {
  return (
    <View style={s.stat}>
      <View style={[s.statIcon, { backgroundColor: color + '18' }]}>
        <Icon name={icon} size={17} color={color} />
      </View>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Text style={s.statLabel}>{label}</Text>
        <View style={s.statRow}>
          <Text style={s.statUnit}>{unit}</Text>
          <Text style={[s.statValue, { color }]}>{value}</Text>
        </View>
      </View>
    </View>
  );
}

export default function SpeedScreen() {
  useLocalSearchParams<{ id: string }>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [res, setRes] = useState<SpeedResult | null>(null);
  const [err, setErr] = useState('');
  const spin = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (phase !== 'running') { spin.stopAnimation(); return; }
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, spin]);

  const run = async () => {
    setPhase('running'); setErr(''); setRes(null);
    fade.setValue(0);
    try {
      const r = await runSpeedTest();
      if (!alive.current) return;
      setRes(r); setPhase('done');
      Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }).start();
    } catch (e: any) {
      if (!alive.current) return;
      setErr(e?.message ?? 'فشل الاختبار'); setPhase('error');
    }
  };

  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={s.wrap}>
      <View style={s.dial}>
        <Svg width={190} height={190}>
          <Circle cx={95} cy={95} r={82} fill="none" stroke={C.track} strokeWidth={10} />
          {phase === 'done' && (
            <Circle
              cx={95} cy={95} r={82} fill="none" stroke={C.blue} strokeWidth={10} strokeLinecap="round"
              strokeDasharray={515} strokeDashoffset={515 * (1 - Math.min(1, (res?.downloadMbps ?? 0) / 200))}
              transform="rotate(-90 95 95)"
            />
          )}
        </Svg>

        {phase === 'running' && (
          <Animated.View style={[s.dialCenter, { transform: [{ rotate }] }]}>
            <Svg width={190} height={190}>
              <Circle
                cx={95} cy={95} r={82} fill="none" stroke={C.blue} strokeWidth={10}
                strokeLinecap="round" strokeDasharray="90 425"
              />
            </Svg>
          </Animated.View>
        )}

        <View style={s.dialCenter}>
          {phase === 'running' ? (
            <>
              <Text style={s.big}>···</Text>
              <Text style={s.dialSub}>جاري القياس</Text>
            </>
          ) : phase === 'done' && res ? (
            <>
              <Text style={s.big}>{res.downloadMbps.toFixed(1)}</Text>
              <Text style={s.dialSub}>Mbps تنزيل</Text>
            </>
          ) : (
            <>
              <Text style={[s.big, { color: C.muted }]}>—</Text>
              <Text style={s.dialSub}>{phase === 'error' ? 'ما تم القياس' : 'جاهز'}</Text>
            </>
          )}
        </View>
      </View>

      {phase === 'error' && (
        <MetricCard style={{ borderColor: C.red }}>
          <View style={s.errRow}>
            <Icon name="power" size={16} color={C.red} />
            <Text style={s.errTitle}>تعذّر إكمال الاختبار</Text>
          </View>
          <Text style={s.errBody}>{err}</Text>
        </MetricCard>
      )}

      {phase === 'done' && res && (
        <Animated.View style={{ opacity: fade, width: '100%', gap: S.sm }}>
          <MetricCard>
            <Stat icon="down" label="التنزيل" value={res.downloadMbps.toFixed(1)} unit="Mbps" color={C.blue} />
          </MetricCard>
          <MetricCard>
            <Stat icon="up" label="الرفع" value={res.uploadMbps.toFixed(1)} unit="Mbps" color={C.violet} />
          </MetricCard>
          <MetricCard>
            <Stat icon="speed" label="زمن الاستجابة" value={String(res.pingMs)} unit="ms" color={C.green} />
          </MetricCard>
        </Animated.View>
      )}

      <Pressable
        style={({ pressed }) => [s.btn, phase === 'running' && s.btnOff, pressed && { opacity: 0.7 }]}
        disabled={phase === 'running'}
        onPress={run}
      >
        <Icon name="refresh" size={16} color={C.onAccent} />
        <Text style={s.btnTxt}>{phase === 'running' ? 'جاري القياس...' : 'إعادة الاختبار'}</Text>
      </Pressable>

      <Text style={s.note}>يقيس سرعة جوالك عبر شبكة الراوتر ويستهلك حوالي ٣٠ ميجا</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, alignItems: 'center', padding: S.lg, gap: S.md },
  dial: { width: 190, height: 190, alignItems: 'center', justifyContent: 'center', marginTop: S.md },
  dialCenter: { position: 'absolute', width: 190, height: 190, alignItems: 'center', justifyContent: 'center' },
  big: { color: C.text, fontSize: 42, fontWeight: '900', lineHeight: 48 },
  dialSub: { color: C.sub, fontSize: T.body, fontWeight: '700', marginTop: 2 },
  stat: { flexDirection: 'row-reverse', alignItems: 'center', gap: S.md },
  statIcon: { width: 38, height: 38, borderRadius: R.md, alignItems: 'center', justifyContent: 'center' },
  statLabel: { color: C.sub, fontSize: T.label, fontWeight: '700' },
  statRow: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: 5 },
  statValue: { fontSize: 26, fontWeight: '900' },
  statUnit: { color: C.muted, fontSize: T.label, fontWeight: '700' },
  errRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: S.sm },
  errTitle: { color: C.red, fontWeight: '800', fontSize: T.h2 },
  errBody: { color: C.sub, fontSize: T.body, textAlign: 'right' },
  btn: {
    backgroundColor: C.blue, borderRadius: R.md, paddingVertical: 13, paddingHorizontal: 22,
    flexDirection: 'row-reverse', alignItems: 'center', gap: S.sm, marginTop: S.xs,
  },
  btnOff: { opacity: 0.5 },
  btnTxt: { color: C.onAccent, fontWeight: '800', fontSize: 15 },
  note: { color: C.muted, fontSize: T.label, textAlign: 'center' },
});
