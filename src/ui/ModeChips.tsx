import { useCallback, useState } from 'react';
import { View, Text, Pressable, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter } from '../store/routers';
import { Profile, Role, ROLES, roleProfiles, profileSummary } from '../store/profiles';
import { applyProfile } from '../utils/applyProfile';
import { C } from './theme';

/** شريط «الأوضاع بضغطة» في صفحة الراوتر */
export function ModeChips({ r, onApplied }: { r: SavedRouter; onApplied?: () => void }) {
  const [roles, setRoles] = useState<Partial<Record<Role, Profile>>>({});
  const [busy, setBusy] = useState<Role | null>(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    roleProfiles(r.id).then(x => { if (alive) setRoles(x); }).catch(() => {});
    return () => { alive = false; };
  }, [r.id]));

  const tap = (role: Role) => {
    const p = roles[role];
    const meta = ROLES.find(x => x.id === role)!;
    if (!p) {
      Alert.alert(`${meta.icon} وضع ${meta.name}`, 'ما حفظت هذا الوضع للحين. من «الملفات» احفظ الإعداد اللي يناسبه، أو ثبّت الأفضل من مُحسّن اللعبة ويحفظه لك لحاله.', [
        { text: 'لاحقاً', style: 'cancel' },
        { text: 'افتح الملفات', onPress: () => router.push(`/profiles/${r.id}` as Href) },
      ]);
      return;
    }
    Alert.alert(`${meta.icon} وضع ${meta.name}`, `بنطبّق ${profileSummary(p)} — النت بينقطع لحظات.`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'طبّق', onPress: async () => {
          setBusy(role);
          try {
            const ok = await applyProfile(r, p);
            if (!ok) Alert.alert('غير مدعوم', 'راوترك ما يدعم قفل الترددات.');
            else onApplied?.();
          } catch (e: any) {
            Alert.alert('ما تم', e?.message ?? String(e));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  return (
    <View style={s.wrap}>
      <Text style={s.title}>الأوضاع بضغطة</Text>
      <View style={s.row}>
        {ROLES.map(m => {
          const has = !!roles[m.id];
          return (
            <Pressable key={m.id} style={[s.chip, has && s.chipOn, !!busy && s.dim]} onPress={() => tap(m.id)} disabled={!!busy}>
              {busy === m.id ? <ActivityIndicator color={C.blue} /> : <Text style={s.icon}>{m.icon}</Text>}
              <Text style={[s.name, !has && { color: C.sub }]}>{m.name}</Text>
              <Text style={s.sub} numberOfLines={1}>{has ? profileSummary(roles[m.id]!) : 'غير محفوظ'}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  title: { color: C.text, fontWeight: '800', fontSize: 15, textAlign: 'right' },
  row: { flexDirection: 'row-reverse', gap: 8 },
  chip: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 16, backgroundColor: C.rowBg, borderWidth: 1.5, borderColor: C.cardBorder, borderStyle: 'dashed' },
  chipOn: { backgroundColor: C.card, borderStyle: 'solid', borderColor: C.blueSoft },
  dim: { opacity: 0.5 },
  icon: { fontSize: 22 },
  name: { color: C.text, fontWeight: '800', fontSize: 13 },
  sub: { color: C.muted, fontSize: 10 },
});
