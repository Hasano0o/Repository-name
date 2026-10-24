/**
 * 🤖 «اضبط لي كل شي» — المساعد يدير الراوتر بنفسه: يفحص، يختار أفضل تردد وبرج وقناة، ويقارن قبل وبعد.
 * المحرك في src/assistant/autopilot.ts (كل تغيير بأمان ويرجع لو صار أسوأ).
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView } from 'react-native';
import { View, Text, Pressable } from '../../src/i18n/rn';
import { useLocalSearchParams, router, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useAutoStart } from '../../src/assistant/auto';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { driverById } from '../../src/drivers/registry';
import { runAutopilot, freshSteps, PilotStep, Measure, StepStatus } from '../../src/assistant/autopilot';
import { LEVEL_COLOR, rsrpLevel, sinrLevel } from '../../src/utils/signal';
import { Icon, IconName } from '../../src/ui/Icon';
import { C, R, S, tBg, tBd, tFg } from '../../src/ui/theme';
import { sheet } from '../../src/i18n';

const ST: Record<StepStatus, { icon: IconName; color: string; word: string }> = {
  wait: { icon: 'clock', color: '#9aa1bd', word: 'بالدور' },
  run: { icon: 'refresh', color: '#2f6bff', word: 'شغّال' },
  ok: { icon: 'check', color: '#12b76a', word: 'تحسّن' },
  same: { icon: 'check', color: '#5ba644', word: 'الحالي أفضل' },
  skip: { icon: 'chevron', color: '#9aa1bd', word: 'تخطّيناها' },
  fail: { icon: 'power', color: '#e5484d', word: 'ما ضبط' },
};
const STEP_ICON: Record<string, IconName> = { check: 'antenna', band: 'bands', tower: 'tower', wifi: 'wifi', final: 'chart' };

function Cmp({ label, before, after, unit, lowerBetter, level }: {
  label: string; before?: number; after?: number; unit: string; lowerBetter?: boolean; level?: (v?: number) => string;
}) {
  if (before === undefined && after === undefined) return null;
  const better = before !== undefined && after !== undefined && (lowerBetter ? after < before - 1 : after > before + 1);
  const worse = before !== undefined && after !== undefined && (lowerBetter ? after > before + 1 : after < before - 1);
  const col = (v?: number) => (level && v !== undefined ? LEVEL_COLOR[level(v) as keyof typeof LEVEL_COLOR] : C.text);
  return (
    <View style={s.cmpRow}>
      <Text style={s.cmpLabel}>{label}</Text>
      <Text style={[s.cmpVal, { color: tFg(col(before)) }]}>{before === undefined ? '—' : Math.round(before)}</Text>
      <Icon name="chevron" size={14} color={C.muted} />
      <Text style={[s.cmpVal, { color: tFg(col(after)) }, s.bold]}>{after === undefined ? '—' : Math.round(after)}</Text>
      <Text style={s.cmpUnit}>{unit}</Text>
      <Text style={[s.cmpTag, { color: better ? '#12b76a' : worse ? '#e5484d' : C.muted }]}>{better ? '▲' : worse ? '▼' : '='}</Text>
    </View>
  );
}

export default function AutopilotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [steps, setSteps] = useState<PilotStep[]>(freshSteps());
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [before, setBefore] = useState<Measure | undefined>();
  const [after, setAfter] = useState<Measure | undefined>();
  const [changed, setChanged] = useState<string[]>([]);
  const cancel = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    getRouter(id).then(r => { if (alive.current) setInfo(r); });
    return () => { alive.current = false; cancel.current = true; deactivateKeepAwake('pilot'); };
  }, [id]);

  const zte = !!(info && driverById(info.driverId)?.cellLockRisk);

  const start = async () => {
    if (!info || running) return;
    cancel.current = false;
    setRunning(true); setDone(false); setBefore(undefined); setAfter(undefined); setChanged([]); setSteps(freshSteps());
    activateKeepAwakeAsync('pilot').catch(() => {});
    try {
      const rep = await runAutopilot(info, {
        onSteps: st => alive.current && setSteps(st),
        onStatus: t => alive.current && setStatus(t),
        onMeasure: (w, m) => { if (!alive.current) return; if (w === 'before') setBefore(m); else setAfter(m); },
        isCancelled: () => cancel.current || !alive.current,
      });
      if (alive.current) { setChanged(rep.changed); setDone(true); }
    } catch (e: any) {
      if (alive.current) Alert.alert('ما كمّلت', String(e?.message ?? e));
    } finally {
      deactivateKeepAwake('pilot');
      if (alive.current) { setRunning(false); setStatus(''); }
    }
  };

  const ask = () => Alert.alert('أضبط لك كل شي؟',
    `بجرّب الترددات${zte ? '' : ' والأبراج'} وقنوات الواي فاي، وأثبّت الأفضل.\n\n• النت بينقطع شوي مع كل تجربة (١٠–١٥ دقيقة تقريباً)\n• خلّ التطبيق مفتوح وجوالك على واي فاي الراوتر\n• لو أي شي صار أسوأ أرجّعه لحاله`,
    [{ text: 'لا', style: 'cancel' }, { text: 'ابدأ', onPress: start }]);

  useAutoStart(!!info && !running, ask);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
      <View style={s.hero}>
        <View style={s.heroIcon}><Text style={{ fontSize: 30 }}>🤖</Text></View>
        <Text style={s.heroTitle}>أضبط لك كل شي بنفسي</Text>
        <Text style={s.heroSub}>أفحص · أجرّب · أثبّت الأفضل · وأرجّع أي شي صار أسوأ</Text>
      </View>

      {/* الخطوات */}
      <View style={s.card}>
        {steps.map((st, i) => {
          const look = ST[st.status];
          return (
            <View key={st.key} style={[s.step, i > 0 && s.stepLine]}>
              <View style={[s.stepIcon, { backgroundColor: tBg(look.color + '1f') }]}>
                {st.status === 'run'
                  ? <ActivityIndicator size="small" color={look.color} />
                  : <Icon name={st.status === 'wait' ? STEP_ICON[st.key] : look.icon} size={18} color={tFg(look.color)} stroke={2.4} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.stepTitle, st.status === 'wait' && { color: C.muted }]}>{st.title}</Text>
                {st.status === 'run' && !!status
                  ? <Text style={[s.stepNote, { color: tFg('#2f6bff') }]}>{status}</Text>
                  : !!st.note && <Text style={s.stepNote}>{st.note}</Text>}
              </View>
              {st.status !== 'wait' && st.status !== 'run' && (
                <Text style={[s.tag, { color: tFg(look.color), backgroundColor: tBg(look.color + '18') }]}>{look.word}</Text>
              )}
            </View>
          );
        })}
      </View>

      {/* قبل وبعد */}
      {(before || after) && (
        <View style={s.card}>
          <Text style={s.cardTitle}>قبل ← بعد</Text>
          <Cmp label="قوة 4G" before={before?.rsrp} after={after?.rsrp} unit="dBm" level={v => rsrpLevel(v)} />
          <Cmp label="صفاء 4G" before={before?.sinr} after={after?.sinr} unit="dB" level={v => sinrLevel(v)} />
          <Cmp label="قوة 5G" before={before?.nrRsrp} after={after?.nrRsrp} unit="dBm" level={v => rsrpLevel(v)} />
          <Cmp label="البنق" before={before?.ping} after={after?.ping} unit="ms" lowerBetter />
          <Cmp label="التذبذب" before={before?.jitter} after={after?.jitter} unit="ms" lowerBetter />
          <Cmp label="درجة اللعب" before={before?.game} after={after?.game} unit="/100" />
        </View>
      )}

      {done && (
        <View style={[s.card, { borderColor: tBd(changed.length ? '#12b76a77' : '#2f6bff55'), backgroundColor: tBg(changed.length ? '#12b76a10' : '#2f6bff0c') }]}>
          <Text style={[s.verdict, { color: tFg(changed.length ? '#0f9a5f' : '#2f6bff') }]}>
            {changed.length ? `✓ خلصت — حسّنت ${changed.length === 1 ? 'شي واحد' : `${changed.length} أشياء`}` : '✓ خلصت — إعدادك الحالي هو الأفضل'}
          </Text>
          {changed.length > 0 && <Text style={s.note}>غيّرت: {changed.join('، ')}. تلقاها في «وش نجح عندي»، وترجّع إعدادك الأصلي من صفحة الراوتر «رجّع الإشارة».</Text>}
          {!changed.length && <Text style={s.note}>لو النت للحين ضعيف، المشكلة غالباً في مكان الراوتر أو اتجاه الأنتنا — جرّب «توجيه الأنتنا».</Text>}
          <View style={s.row}>
            <Pressable style={[s.btn2, { borderColor: tBd('#12b76a66') }]} onPress={() => router.push(`/speed/${id}` as Href)}><Text style={[s.btn2Txt, { color: tFg('#0f9a5f') }]}>اختبر السرعة</Text></Pressable>
            {!changed.length && <Pressable style={[s.btn2, { borderColor: tBd('#2f6bff55') }]} onPress={() => router.push(`/aim/${id}` as Href)}><Text style={[s.btn2Txt, { color: tFg('#2f6bff') }]}>وجّه الأنتنا</Text></Pressable>}
          </View>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [s.btn, running && { backgroundColor: C.red }, !info && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
        disabled={!info}
        onPress={() => (running ? (cancel.current = true, setStatus('أوقف وأرجّع إعدادك…')) : ask())}
        accessibilityRole="button"
      >
        <Icon name={running ? 'power' : 'spark'} size={17} color={C.onAccent} />
        <Text style={s.btnTxt}>{running ? 'وقّف ورجّع إعدادي' : done ? 'أعد الضبط' : 'ابدأ'}</Text>
      </Pressable>

      <Text style={s.foot}>
        🛡️ ما أسوي ضبط مصنع ولا أغيّر كلمات المرور. كل تثبيت أقيس قبله وبعده، ولو صار أسوأ أرجّعه.
        {zte ? '\nراوترك ZTE: نتخطى تثبيت البرج لأنه ممكن يطيّح الراوتر.' : ''}
      </Text>
    </ScrollView>
  );
}

const s = sheet({
  page: { padding: S.lg, gap: S.md },
  hero: { alignItems: 'center', gap: 6, paddingVertical: 6 },
  heroIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: tBg('#7c5cff1a'), alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: C.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  heroSub: { color: C.sub, fontSize: 13.5, textAlign: 'center' },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: R.lg, padding: 14, gap: 8 },
  cardTitle: { color: C.sub, fontWeight: '800', fontSize: 13, textAlign: 'center' },
  step: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 8 },
  stepLine: { borderTopWidth: 1, borderColor: C.lineSoft },
  stepIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { color: C.text, fontWeight: '800', fontSize: 15, textAlign: 'right' },
  stepNote: { color: C.sub, fontSize: 12.5, lineHeight: 19, textAlign: 'right', marginTop: 2 },
  tag: { fontSize: 11.5, fontWeight: '800', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
  cmpRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 4 },
  cmpLabel: { flex: 1, color: C.sub, fontSize: 13.5, fontWeight: '700', textAlign: 'right' },
  cmpVal: { fontSize: 15, fontWeight: '700', minWidth: 40, textAlign: 'center' },
  cmpUnit: { color: C.muted, fontSize: 11, width: 36, textAlign: 'left' },
  cmpTag: { fontSize: 13, fontWeight: '900', width: 16, textAlign: 'center' },
  bold: { fontWeight: '900' },
  verdict: { fontSize: 17, fontWeight: '900', textAlign: 'center' },
  note: { color: C.sub, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  row: { flexDirection: 'row-reverse', justifyContent: 'center', gap: 10, marginTop: 4 },
  btn2: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.card },
  btn2Txt: { fontWeight: '800', fontSize: 13.5 },
  btn: { alignSelf: 'center', flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: '#7c5cff', borderRadius: 999, paddingVertical: 14, paddingHorizontal: 34 },
  btnTxt: { color: C.onAccent, fontWeight: '900', fontSize: 16 },
  foot: { color: C.muted, fontSize: 11.5, textAlign: 'center', lineHeight: 18 },
});
