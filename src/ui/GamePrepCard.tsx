import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Share } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { SavedRouter } from '../store/routers';
import { GameRegion } from '../utils/latency';
import { canPrep, getPrep, prepareForGame, restoreAfterGame, PrepResult, PrepState } from '../utils/gamePrep';
import { C, isDark, tBg, tFg } from './theme';
import { Icon } from './Icon';
import { sheet } from '../i18n';

/** بطاقة «جهّزني للعب» — فوق مُحسّن الألعاب */
export function GamePrepCard({ info, reg, disabled }: { info: SavedRouter; reg: GameRegion; disabled?: boolean }) {
  const [state, setState] = useState<PrepState | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [res, setRes] = useState<PrepResult | null>(null);

  const refresh = useCallback(() => { getPrep(info.id).then(setState); }, [info.id]);
  useEffect(refresh, [refresh]);

  if (!canPrep(info)) return null;

  const go = () => {
    Alert.alert(
      'جهّزني للعب',
      'بنجهّز الراوتر للعب قبل ما تبدأ: النت ممكن يفصل ثواني. لا تسويها وأنت داخل مباراة.\nبعد ما تخلص، اضغط «رجّع إعدادي».',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'جهّزني', onPress: async () => {
            setBusy(true); setRes(null);
            try {
              const r = await prepareForGame(info, reg, setStep);
              setRes(r);
            } catch (e: any) {
              setRes({ ok: false, actions: [], tips: [], error: e?.message ?? String(e) });
            } finally {
              setBusy(false); setStep(''); refresh();
            }
          },
        },
      ],
    );
  };

  const undo = async () => {
    setBusy(true);
    try {
      const r = await restoreAfterGame(info, setStep);
      setRes(null);
      Alert.alert(r.exact ? 'رجّعنا إعدادك ✓' : 'رجع أغلب إعدادك', r.exact ? 'الراوتر رجع مثل ما كان قبل التجهيز.' : `ما رجع كل شي: ${(r.items ?? []).join('، ')}`);
    } catch (e: any) {
      Alert.alert('ما تم', e?.message ?? String(e));
    } finally {
      setBusy(false); setStep(''); refresh();
    }
  };

  const share = () => {
    if (!res?.before || !res.after?.samples) return;
    Share.share({
      message: [
        '🎮 «جهّزني للعب» في Bandly',
        `قبل: بنق ${res.before.median}ms · تذبذب ${res.before.jitter}ms`,
        `بعد: بنق ${res.after.median}ms · تذبذب ${res.after.jitter}ms`,
        '',
        'حمّل Bandly: https://has-host.com/dl/bandly.apk',
        'آيفون: https://apps.apple.com/sa/app/id6819877993',
      ].join('\n'),
    }).catch(() => {});
  };

  return (
    <View style={s.card}>
      {!state ? (
        <Pressable onPress={go} disabled={busy || disabled} style={({ pressed }) => [pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }, (busy || disabled) && { opacity: 0.6 }]}>
          <LinearGradient colors={['#7c3aed', '#4f46e5', '#2f6bff']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.hero}>
            <LinearGradient colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']} style={s.gloss} pointerEvents="none" />
            <View style={{ flex: 1, alignItems: 'flex-end', gap: 3 }}>
              <View style={s.heroTitleRow}>
                <Icon name="game" size={22} color="#fff" stroke={2.2} />
                <Text style={s.heroTitle}>جهّزني للعب</Text>
              </View>
              <Text style={s.heroSub} numberOfLines={2}>{busy ? step || 'لحظات...' : 'ضغطة وحدة قبل المباراة — نطبّق اللي يثبّت البنق عندك أنت'}</Text>
            </View>
            <View style={s.goBtn}>
              {busy ? <ActivityIndicator color="#4f46e5" /> : <>
                <Icon name="spark" size={15} color="#4f46e5" stroke={2.4} />
                <Text style={s.goTxt}>ابدأ</Text>
              </>}
            </View>
          </LinearGradient>
        </Pressable>
      ) : (
        <View style={s.readyRow}>
          <Pressable onPress={undo} disabled={busy} style={[s.undoBtn, busy && { opacity: 0.6 }]}>
            {busy ? <ActivityIndicator size="small" color={C.blue} /> : <Text style={s.undoTxt}>رجّع إعدادي</Text>}
          </Pressable>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={s.readyTitle}>🎮 جاهز للعب</Text>
            <Text style={s.readySub} numberOfLines={2}>{busy ? step : 'خلصت؟ رجّع إعدادك العادي بضغطة'}</Text>
          </View>
        </View>
      )}

      {!!res && (
        <View style={s.result}>
          {!!res.error && <Text style={s.err}>{res.error}</Text>}
          {res.ok && res.nothing && <Text style={s.ok}>إعدادك الحالي مناسب للعب — ما يحتاج نغيّر شي 👌</Text>}
          {res.ok && !!res.before && !!res.after?.samples && (
            <View style={s.cmp}>
              {([['بعد', res.after, res.aScore, true], ['قبل', res.before, res.bScore, false]] as const).map(([t, r, sc, isAfter]) => (
                <View key={t} style={[s.cmpCol, isAfter && { borderColor: C.green }]}>
                  <Text style={[s.cmpHead, isAfter && { color: C.green }]}>{t}</Text>
                  <Text style={s.cmpBig}>{r.median}<Text style={s.cmpUnit}> ms</Text></Text>
                  <Text style={s.cmpSmall}>تذبذب {r.jitter}ms{sc !== undefined ? ` · ${sc}/100` : ''}</Text>
                </View>
              ))}
            </View>
          )}
          {res.actions.map((a, i) => <Text key={'a' + i} style={s.line}>✅ {a}</Text>)}
          {res.tips.map((t, i) => <Text key={'t' + i} style={s.tip}>💡 {t}</Text>)}
          {res.ok && !!res.after?.samples && (
            <Pressable onPress={share} style={s.shareBtn}><Text style={s.shareTxt}>شارك النتيجة</Text></Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const s = sheet({
  card: { gap: 10 },
  hero: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderRadius: 22, paddingVertical: 16, paddingHorizontal: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    shadowColor: '#7c3aed', shadowOpacity: isDark ? 0.5 : 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 5,
  },
  gloss: { position: 'absolute', top: 0, left: 0, right: 0, height: '55%' },
  heroTitleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  heroTitle: { color: '#fff', fontSize: 20, fontWeight: '900' },
  heroSub: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600', textAlign: 'right' },
  goBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: '#fff', borderRadius: 18,
    paddingVertical: 9, paddingHorizontal: 14, minWidth: 74, justifyContent: 'center',
  },
  goTxt: { color: '#4f46e5', fontSize: 14, fontWeight: '900' },
  readyRow: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderRadius: 18, padding: 14,
    backgroundColor: C.greenSoft, borderWidth: 1, borderColor: tBg('#34ce8355'),
  },
  readyTitle: { color: tFg('#0f7a52'), fontSize: 16, fontWeight: '900' },
  readySub: { color: C.sub, fontSize: 12, textAlign: 'right', marginTop: 2 },
  undoBtn: { backgroundColor: C.card, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.blue, minWidth: 96, alignItems: 'center' },
  undoTxt: { color: C.blue, fontWeight: '800', fontSize: 13 },
  result: { backgroundColor: C.card, borderRadius: 18, padding: 14, gap: 8, borderWidth: 1, borderColor: C.cardBorder },
  err: { color: C.red, fontSize: 13, fontWeight: '700', textAlign: 'right', lineHeight: 20 },
  ok: { color: C.green, fontSize: 13.5, fontWeight: '800', textAlign: 'right' },
  cmp: { flexDirection: 'row', gap: 10 },
  cmpCol: { flex: 1, borderWidth: 1.5, borderColor: C.cardBorder, borderRadius: 14, padding: 10, alignItems: 'center', gap: 3 },
  cmpHead: { color: C.sub, fontWeight: '800', fontSize: 12.5 },
  cmpBig: { color: C.text, fontWeight: '900', fontSize: 24 },
  cmpUnit: { color: C.sub, fontWeight: '700', fontSize: 12 },
  cmpSmall: { color: C.sub, fontSize: 11.5 },
  line: { color: C.text, fontSize: 13, textAlign: 'right', lineHeight: 20 },
  tip: { color: C.sub, fontSize: 12.5, textAlign: 'right', lineHeight: 19 },
  shareBtn: { backgroundColor: C.blue, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  shareTxt: { color: C.onAccent, fontWeight: '800', fontSize: 13.5 },
});
