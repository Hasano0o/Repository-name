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
          <LinearGradient colors={['#2f6bff', '#7655F5']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.hero}>
            <View style={s.heroIcon}>
              {busy ? <ActivityIndicator color="#fff" /> : <Icon name="game" size={24} color="#fff" stroke={2.2} />}
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={s.heroTitle}>جهّزني للعب</Text>
              <Text style={s.heroSub} numberOfLines={2}>{busy ? step || 'لحظات...' : 'ضغطة وحدة قبل المباراة — نطبّق اللي يثبّت البنق عندك أنت'}</Text>
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
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderRadius: 20, padding: 14,
    shadowColor: '#7655F5', shadowOpacity: isDark ? 0 : 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: isDark ? 0 : 5,
  },
  heroIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', textAlign: 'right', marginTop: 2 },
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
