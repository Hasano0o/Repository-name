/**
 * نافذة التقدّم للعمليات اللي تقطع النت (تثبيت برج/تردد، SA، رجّع الإشارة، الإنقاذ):
 * خطوات بعلامات + شريط ووقت تقريبي + تحذير «لا تطلع» + منع الرجوع + الشاشة ما تنطفي.
 * النتيجة نفسها تطلع بعدها (Alert الشاشة) — ما تختفي لين يضغط المستخدم.
 *
 * الاستخدام من أي مكان (حتى خارج React):
 *   const t = progress.start('نثبّت التردد', ['نقيس', 'نطبّق', 'ننتظر الاتصال', 'نقيس النتيجة'], 70);
 *   t.step(1); t.note('...'); t.end();
 * عمليات متداخلة (رجّع الإشارة داخل التجربة) تكمّل على نفس النافذة.
 */
import { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { P } from './Pro';
import { tBd, tBg, tFg } from './theme';

interface State {
  title: string;
  steps: string[];
  step: number;
  note: string;
  startedAt: number;
  estSecs: number;
  hidden: boolean;
}

let state: State | null = null;
let depth = 0;
const subs = new Set<(s: State | null) => void>();
const emit = () => subs.forEach(f => f(state ? { ...state } : null));
const KEEP = 'bandly-progress';

export interface Tracker {
  /** ننتقل لخطوة (رقمها) — أو نضيف خطوة جديدة بنصها */
  step: (i: number | string) => void;
  note: (t: string) => void;
  /** نخفي النافذة مؤقتاً (مثلاً لما نسأل المستخدم سؤال) */
  hide: (h: boolean) => void;
  end: () => void;
}

const noop: Tracker = { step: () => {}, note: () => {}, hide: () => {}, end: () => {} };

export const progress = {
  start(title: string, steps: string[], estSecs: number): Tracker {
    depth++;
    if (depth > 1 && state) {
      // عملية داخل عملية: نكمّل على نفس النافذة ونضيف خطواتها
      const base = state.steps.length;
      state.steps = [...state.steps, ...steps];
      state.estSecs += estSecs;
      state.step = base;
      emit();
      return {
        step: i => { if (!state) return; state.step = typeof i === 'number' ? base + i : addStep(i); emit(); },
        note: t => { if (state) { state.note = t; emit(); } },
        hide: () => {},
        end: () => { depth = Math.max(0, depth - 1); },
      };
    }
    state = { title, steps, step: 0, note: '', startedAt: Date.now(), estSecs, hidden: false };
    activateKeepAwakeAsync(KEEP).catch(() => {});
    emit();
    return {
      step: i => { if (!state) return; state.step = typeof i === 'number' ? i : addStep(i); state.note = ''; emit(); },
      note: t => { if (state) { state.note = t; emit(); } },
      hide: h => { if (state) { state.hidden = h; emit(); } },
      end: () => {
        depth = 0;
        state = null;
        try { deactivateKeepAwake(KEEP); } catch {}
        emit();
      },
    };
  },
  /** للأماكن اللي تبي تتبع بس لو فيه نافذة شغالة */
  active: () => state !== null,
  none: noop,
};

function addStep(t: string): number {
  if (!state) return 0;
  const i = state.steps.indexOf(t);
  if (i >= 0) return i;
  state.steps = [...state.steps, t];
  return state.steps.length - 1;
}

function useProgress() {
  const [s, set] = useState<State | null>(state);
  useEffect(() => { subs.add(set); return () => { subs.delete(set); }; }, []);
  return s;
}

function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

export function ProgressHost() {
  const s = useProgress();
  const now = useNow(!!s);
  if (!s) return null;
  const elapsed = Math.max(0, Math.round((now - s.startedAt) / 1000));
  const left = Math.max(0, s.estSecs - elapsed);
  const ratio = Math.min(0.95, Math.max(0.04, (s.step + 0.5) / Math.max(1, s.steps.length) * 0.6 + (elapsed / Math.max(1, s.estSecs)) * 0.4));
  const fmt = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')} دقيقة` : `${n} ثانية`);

  return (
    <Modal visible={!s.hidden} transparent animationType="fade" statusBarTranslucent
      onRequestClose={() => Alert.alert('العملية ما خلصت', 'لو طلعت الحين ممكن يبقى الراوتر في النص وبدون نت. خلّنا نكمّل — ما بتطوّل.', [{ text: 'أكمل' }])}>
      <View style={st.back}>
        <View style={st.card}>
          <View style={st.head}>
            <ActivityIndicator color={P.blue} />
            <Text style={st.title} numberOfLines={2}>{s.title}</Text>
          </View>

          <View style={st.steps}>
            {s.steps.map((t, i) => {
              const done = i < s.step;
              const cur = i === s.step;
              return (
                <View key={i} style={st.stepRow}>
                  <View style={[st.dot, done && st.dotDone, cur && st.dotCur]}>
                    <Text style={[st.dotTxt, (done || cur) && { color: tFg('#fff') }]}>{done ? '✓' : cur ? '•' : ''}</Text>
                  </View>
                  <Text style={[st.stepTxt, done && st.stepDone, cur && st.stepCur]} numberOfLines={2}>{t}</Text>
                </View>
              );
            })}
          </View>

          {!!s.note && <Text style={st.note} numberOfLines={3}>{s.note}</Text>}

          <View style={st.track}><View style={[st.fill, { width: `${Math.round(ratio * 100)}%` }]} /></View>
          <View style={st.timeRow}>
            <Text style={st.time}>مرّ {fmt(elapsed)}</Text>
            <Text style={st.time}>{left > 0 ? `باقي تقريباً ${fmt(left)}` : 'قربنا نخلص…'}</Text>
          </View>

          <View style={st.warn}>
            <Text style={st.warnTxt}>⚠️ لا تطلع من الشاشة — الراوتر في النص، وبنقول لك لما نخلص</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(8,12,28,0.55)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  card: {
    alignSelf: 'stretch', backgroundColor: P.card, borderRadius: 24, padding: 18, gap: 14,
    borderWidth: 1, borderColor: P.border,
  },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  title: { flex: 1, color: P.text, fontSize: 17, fontWeight: '800', textAlign: 'right' },
  steps: { gap: 10 },
  stepRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  dot: {
    width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: P.border, backgroundColor: P.soft,
  },
  dotDone: { backgroundColor: P.green, borderColor: P.green },
  dotCur: { backgroundColor: P.blue, borderColor: P.blue },
  dotTxt: { fontSize: 13, fontWeight: '900', color: P.sub, lineHeight: 16 },
  stepTxt: { flex: 1, color: P.faint, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  stepDone: { color: P.sub },
  stepCur: { color: P.text, fontWeight: '800' },
  note: { color: P.sub, fontSize: 12.5, textAlign: 'right', lineHeight: 19 },
  track: { height: 8, borderRadius: 4, backgroundColor: P.soft, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: P.blue },
  timeRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: -6 },
  time: { color: P.sub, fontSize: 11.5, fontWeight: '600' },
  warn: { backgroundColor: tBg('#fff7ed'), borderColor: tBd('#fed7aa'), borderWidth: 1, borderRadius: 12, padding: 10 },
  warnTxt: { color: tFg('#9a3412'), fontSize: 12.5, fontWeight: '700', textAlign: 'right', lineHeight: 19 },
});
