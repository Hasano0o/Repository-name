import { useCallback, useState } from 'react';
import { ScrollView, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { Trial, TrialVerdict, loadTrials, trialNote } from '../../src/utils/safeLock';
import { Icon, IconName } from '../../src/ui/Icon';
import { C, R, S } from '../../src/ui/theme';

const V: Record<TrialVerdict, { label: string; color: string; soft: string; icon: IconName }> = {
  better: { label: 'صار أفضل', color: C.green, soft: C.greenSoft, icon: 'spark' },
  same: { label: 'ما فرق', color: C.sub, soft: C.rowBg, icon: 'chevron' },
  worse: { label: 'رجعناه', color: C.red, soft: C.redSoft, icon: 'down' },
  noconn: { label: 'ما اتصل', color: C.gold, soft: C.goldSoft, icon: 'refresh' },
};

export default function TrialsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      const t = await loadTrials(id);
      if (!alive) return;
      setInfo(r); setTrials(t); setLoading(false);
    })();
    return () => { alive = false; };
  }, [id]));

  const betterCount = trials.filter(t => t.verdict === 'better').length;

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        <View style={s.card}>
          <Text style={s.title}>⭐ وش نجح عندي</Text>
          <Text style={s.body}>
            كل تجربة قفل أو دمج سويناها على {info?.name ?? 'راوترك'}، ونتيجتها. عشان ما نعيد تجربة طلعت أسوأ قبل.
          </Text>
          {!loading && trials.length > 0 && (
            <Text style={s.meta}>
              جرّبنا {trials.length} {trials.length === 1 ? 'مرة' : 'مرات'}
              {betterCount > 0 ? ` · ${betterCount} منها حسّنت اتصالك` : ''}
            </Text>
          )}
        </View>

        {loading ? (
          <ActivityIndicator color={C.blue} style={{ marginTop: 20 }} />
        ) : trials.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyText}>
              ما جرّبنا شي بعد. أول ما تسوي «أفضل تردد» أو «التوجيه» ويثبّت شي، بيتسجّل هنا.
            </Text>
          </View>
        ) : (
          trials.map((t, i) => {
            const v = V[t.verdict];
            return (
              <View key={`${t.key}-${t.at}-${i}`} style={[s.row, { borderColor: v.color + '33' }]}>
                <View style={[s.icon, { backgroundColor: v.soft }]}>
                  <Icon name={v.icon} size={17} color={v.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>{t.label}</Text>
                  <Text style={s.rowNote}>{trialNote(t)}</Text>
                </View>
                <View style={[s.tag, { backgroundColor: v.soft }]}>
                  <Text style={[s.tagText, { color: v.color }]}>{v.label}</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  page: { padding: S.lg, gap: S.md },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.lg, padding: S.lg, gap: S.sm },
  title: { color: C.text, fontWeight: '800', fontSize: 17, textAlign: 'right' },
  body: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  meta: { color: C.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  empty: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.lg, padding: S.lg },
  emptyText: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'center' },
  row: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 11,
    backgroundColor: C.card, borderWidth: 1, borderRadius: R.md, padding: S.md,
  },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  rowNote: { color: C.sub, fontSize: 12, textAlign: 'right', marginTop: 2, lineHeight: 18 },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  tagText: { fontWeight: '800', fontSize: 11.5 },
});
