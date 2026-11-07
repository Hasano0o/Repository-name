/**
 * زر «العملية الحالية» العائم (اقتراح عضو ٧ نوفمبر): عملية شغالة وأنت بشاشة ثانية ← «ارجع لها» ·
 * خلصت/فشلت/انقطعت وما شفتها ← النتيجة + زر يفتح شاشتها. يختفي لما تكون بشاشتها أو تقفله.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activeOps, pillFor } from '../store/activeOps';
import { isDark, tFg } from './theme';
import { FONT } from './fonts';
import { sheet } from '../i18n';

const TONE = {
  running: { bg: isDark ? '#1e3360' : '#2f6bff', fg: '#ffffff' },
  done: { bg: isDark ? '#123a2c' : '#dafcee', fg: isDark ? '#6ee7a8' : '#0f6b41' },
  failed: { bg: isDark ? '#3a1d1d' : '#ffecf2', fg: isDark ? '#ff9a8a' : '#b42318' },
  interrupted: { bg: isDark ? '#33270f' : '#fff4e5', fg: isDark ? '#fdba74' : '#9a3412' },
} as const;

export function OpPill() {
  const path = usePathname() || '/';
  const insets = useSafeAreaInsets();
  const [, tick] = useState(0);
  useEffect(() => { activeOps.setRoute(path); }, [path]);
  useEffect(() => {
    activeOps.restore();
    const un = activeOps.subscribe(() => tick(x => x + 1));
    const t = setInterval(() => tick(x => x + 1), 30_000);
    return () => { un(); clearInterval(t); };
  }, []);
  // وصل لشاشة العملية والنتيجة جاهزة ← انشافت
  useEffect(() => {
    const r = activeOps.lastResult();
    if (r && r.route === path && !r.interrupted) activeOps.markSeen();
  }, [path]);

  const p = pillFor(activeOps, path);
  if (!p) return null;
  const tone = TONE[p.kind];
  const label = p.op.label;
  const text = p.kind === 'running' ? `«${label}» شغالة — ارجع لها`
    : p.kind === 'done' ? `✓ خلصت «${label}» — شوف النتيجة`
      : p.kind === 'failed' ? `✗ «${label}» ما كملت${'msg' in p.op && p.op.msg ? `: ${p.op.msg}` : ''}`
        : `⚠️ «${label}» انقطعت (التطبيق انقفل أو تحدّث) — افتحها`;
  const open = () => {
    if (p.kind !== 'running') activeOps.markSeen();
    try { router.push(p.op.route as any); } catch {}
  };
  return (
    <View style={[s.wrap, { bottom: insets.bottom + 14 }]} pointerEvents="box-none">
      <View style={[s.pill, { backgroundColor: tone.bg }]}>
        <Pressable onPress={open} style={s.main} accessibilityRole="button" accessibilityLabel={text}>
          {p.kind === 'running' && <ActivityIndicator size="small" color={tone.fg} />}
          <Text style={[s.txt, { color: tone.fg }]} numberOfLines={2}>{text}</Text>
        </Pressable>
        {p.kind !== 'running' && (
          <Pressable onPress={() => activeOps.markSeen()} style={s.x} accessibilityRole="button" accessibilityLabel="إخفاء">
            <Text style={[s.xTxt, { color: tone.fg }]}>✕</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = sheet({
  wrap: { position: 'absolute', left: 14, right: 14, alignItems: 'center' },
  pill: {
    flexDirection: 'row-reverse', alignItems: 'center', borderRadius: 18, maxWidth: 520, alignSelf: 'stretch',
    shadowColor: '#0b1a3c', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 10,
  },
  main: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 14, minHeight: 48 },
  txt: { flex: 1, fontFamily: FONT.bold, fontSize: 13, textAlign: 'right' },
  x: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  xTxt: { fontSize: 15, fontWeight: '800', color: tFg('#ffffff') },
});
