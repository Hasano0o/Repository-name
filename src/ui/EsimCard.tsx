/**
 * الشريحة الإلكترونية — بطاقة في صفحة الراوتر (٢٧ نوفمبر، قرار حسن: «نشغّلها ونشوف المستخدمين»).
 * - راوترك فيه eSIM (فحص هواوي = yes) ← «افتح» الشاشة التجريبية (قراءة + باركود + صفحة الراوتر)
 * - غيره ← «أبغاها»: نسجّل الطلب مع موديل الراوتر (community/esim) ونعرف كم عضو يبيها وعلى أي راوترات
 * تنقفل بـ ✕ (لكل راوتر). ما فيه أي أمر للراوتر من هنا.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { useFocusEffect, router, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Rect, Path, Circle } from 'react-native-svg';
import type { SavedRouter } from '../store/routers';
import { esimProbeResult } from '../services/esimProbe';
import { esimEvent } from '../services/community';
import { C, R, isDark } from './theme';
import { sheet } from '../i18n';

const wantKey = (id: string) => `bandly.esimWant.${id}`;
const hideKey = (id: string) => `bandly.esimHide.${id}`;

function SimIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path d="M7 2h7l5 5v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" stroke="#fff" strokeWidth={1.8} strokeLinejoin="round" />
      <Rect x={8.5} y={11} width={7} height={7} rx={1.2} stroke="#fff" strokeWidth={1.6} />
      <Circle cx={12} cy={7.2} r={1.1} fill="#fff" />
    </Svg>
  );
}

export function EsimCard({ r, model }: { r: SavedRouter; model?: string }) {
  const [state, setState] = useState<{ probe: string | null; want: boolean; hide: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    let on = true;
    (async () => {
      const [probe, want, hide] = await Promise.all([
        esimProbeResult(r.id),
        AsyncStorage.getItem(wantKey(r.id)).catch(() => null),
        AsyncStorage.getItem(hideKey(r.id)).catch(() => null),
      ]);
      if (on) setState({ probe, want: !!want, hide: !!hide });
    })();
    return () => { on = false; };
  }, [r.id]));

  if (!state) return null;
  const supported = state.probe === 'yes';
  // راوتر فيه eSIM تطلع دايم (ما تنقفل) — غيره يقدر يخفيها
  if (state.hide && !supported) return null;

  const want = async () => {
    if (busy) return;
    setBusy(true);
    await esimEvent('want', { model, brand: r.driverId, esim: state.probe === 'no' ? 'no' : 'unknown' }).catch(() => {});
    await AsyncStorage.setItem(wantKey(r.id), String(Date.now())).catch(() => {});
    setState({ ...state, want: true });
    setBusy(false);
  };
  const hide = async () => {
    await AsyncStorage.setItem(hideKey(r.id), '1').catch(() => {});
    setState({ ...state, hide: true });
  };

  const title = 'الشريحة الإلكترونية (eSIM)';
  const sub = supported
    ? 'راوترك يدعمها ✓ — شوف شرائحك وصوّر باركود شريحة جديدة (تجريبي)'
    : state.want
      ? '✓ سجّلنا طلبك — نعلن في القروب أول ما تجهز لراوترك'
      : 'تبي تضيف شريحة بالباركود بدل ما تشيلها وتركّبها كل مرة؟';

  return (
    <LinearGradient colors={isDark ? ['#1f2c3f', '#262742'] : ['#eef4ff', '#efeaff']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.card}>
      <View style={s.row}>
        <LinearGradient colors={['#4f46e5', '#0ea5e9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.icon}>
          <SimIcon />
        </LinearGradient>
        <View style={s.txt}>
          <Text style={s.title} numberOfLines={1} maxFontSizeMultiplier={1.25}>{title}</Text>
          <Text style={s.sub} maxFontSizeMultiplier={1.25}>{sub}</Text>
        </View>
        {supported ? (
          <Pressable style={s.btn} onPress={() => router.push(`/esim/${r.id}` as Href)} accessibilityRole="button">
            <Text style={s.btnTxt} maxFontSizeMultiplier={1.2}>افتح</Text>
          </Pressable>
        ) : !state.want ? (
          <Pressable style={s.btn} onPress={want} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnTxt} maxFontSizeMultiplier={1.2}>أبغاها</Text>}
          </Pressable>
        ) : null}
        {!supported && (
          <Pressable onPress={hide} hitSlop={10} accessibilityRole="button" accessibilityLabel="إخفاء">
            <Text style={s.x}>✕</Text>
          </Pressable>
        )}
      </View>
    </LinearGradient>
  );
}

const s = sheet({
  card: {
    borderRadius: R.lg, paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: isDark ? '#36406a' : '#d6dcff',
  },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  txt: { flex: 1, alignItems: 'flex-end' },
  title: { color: C.text, fontSize: 13, fontWeight: '900' },
  sub: { color: C.sub, fontSize: 11, fontWeight: '700', textAlign: 'right', marginTop: 1 },
  btn: { backgroundColor: '#4f46e5', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, minWidth: 64, alignItems: 'center' },
  btnTxt: { color: '#fff', fontSize: 12.5, fontWeight: '900' },
  x: { color: C.sub, fontSize: 13, fontWeight: '800', paddingHorizontal: 2 },
});
