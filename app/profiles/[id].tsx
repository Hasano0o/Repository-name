import { useCallback, useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { BandConfig } from '../../src/drivers/types';
import { Profile, listProfiles, saveProfile, deleteProfile, profileSummary } from '../../src/store/profiles';
import { C } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import { fmtTime } from '../../src/utils/format';

export default function ProfilesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const [items, setItems] = useState<Profile[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (r: SavedRouter) => {
    const [c, list] = await Promise.all([
      withSession(r, async d => (d.getBandConfig ? d.getBandConfig() : null)).catch(() => null),
      listProfiles(r.id),
    ]);
    setCfg(c);
    setItems(list.sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try { await reload(r); } catch (e: any) { setError(e?.message ?? String(e)); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, reload]));

  const saveCurrent = async () => {
    if (!info || !cfg) return;
    const title = name.trim() || `ملف ${items.length + 1}`;
    setBusy(true); setError('');
    try {
      await saveProfile({
        routerId: info.id,
        name: title,
        bands: cfg.locked,
        nrBands: cfg.nrLocked,
        mode: cfg.mode,
      });
      setName('');
      await reload(info);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  const apply = (p: Profile) => {
    if (!info) return;
    Alert.alert('تطبيق الملف', `بنطبّق «${p.name}» — ${profileSummary(p)}`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'طبّق',
        onPress: async () => {
          setBusy(true); setError(''); setStatus('نطبّق الإعدادات...');
          try {
            const applied = await withSession(info, async d => {
              if (p.mode && d.setNetworkMode) { try { await d.setNetworkMode(p.mode); } catch {} }
              if (!d.setBand) return false;
              await d.setBand(p.bands, p.nrBands);
              return true;
            }, false);
            if (!applied) {
              Alert.alert('غير مدعوم', 'راوترك ما يدعم قفل الترددات، فما انطبق شي.');
              return;
            }
            setStatus('ننتظر الاتصال...');
            await new Promise(r => setTimeout(r, 6000));
            await reload(info);
            Alert.alert('تم', `طُبّق «${p.name}» بنجاح.`);
          } catch (e: any) {
            setError(e?.message ?? String(e));
          } finally { setBusy(false); setStatus(''); }
        },
      },
    ]);
  };

  const remove = (p: Profile) => {
    if (!info) return;
    Alert.alert('حذف', `تحذف «${p.name}»؟`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'احذف', style: 'destructive',
        onPress: async () => { await deleteProfile(info.id, p.id); await reload(info); },
      },
    ]);
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator color={C.blue} /></View>;
  }

  const current = cfg
    ? (cfg.locked.length || cfg.nrLocked.length
        ? [...cfg.locked.map(b => 'B' + b), ...cfg.nrLocked.map(b => 'n' + b)].join(' · ')
        : 'بدون قفل — تلقائي')
    : 'غير متاح';

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      {!!error && <Text style={s.err}>{error}</Text>}
      {!!status && <Text style={s.status}>{status}</Text>}

      <GlassCard title="الوضع الحالي" subtitle="Current setup" icon="📍" tint={C.blue} collapsible={false}>
        <Text style={s.big}>{current}</Text>
        {!!cfg?.mode && <Text style={s.sub}>نمط الشبكة: {cfg.mode}</Text>}
        <Text style={s.lbl}>اسم الملف</Text>
        <TextInput
          style={s.input} value={name} onChangeText={setName}
          placeholder="مثلاً: ألعاب، أو ليلي، أو مطر"
          placeholderTextColor={C.muted}
        />
        <Pressable style={[s.btn, (busy || !cfg) && s.btnOff]} disabled={busy || !cfg} onPress={saveCurrent}>
          {busy ? <ActivityIndicator color={C.onAccent} /> : <Text style={s.btnTxt}>احفظ الوضع الحالي</Text>}
        </Pressable>
      </GlassCard>

      <GlassCard title="ملفاتي" subtitle="Saved profiles" icon="🗂️" tint={C.violet} collapsible={false}>
        {items.length === 0 && <Text style={s.sub}>ما حفظت أي ملف بعد.</Text>}
        {items.map(p => (
          <View key={p.id} style={s.row}>
            <Pressable style={s.del} onPress={() => remove(p)} hitSlop={8}>
              <Text style={s.delTxt}>حذف</Text>
            </Pressable>
            <Pressable style={s.apply} disabled={busy} onPress={() => apply(p)}>
              <Text style={s.applyTxt}>طبّق</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>{p.name}</Text>
              <Text style={s.rowSub}>{profileSummary(p)} · {fmtTime(p.createdAt)}</Text>
            </View>
          </View>
        ))}
      </GlassCard>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 14, gap: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  big: { color: C.text, fontSize: 18, fontWeight: '800', textAlign: 'right' },
  sub: { color: C.sub, fontSize: 12.5, textAlign: 'right', marginTop: 4 },
  lbl: { color: C.sub, fontSize: 12, marginTop: 12, marginBottom: 4, textAlign: 'right' },
  input: {
    backgroundColor: C.rowBg, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder,
    paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14, textAlign: 'right',
  },
  btn: { backgroundColor: C.blue, borderRadius: 14, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  btnOff: { opacity: 0.45 },
  btnTxt: { color: C.onAccent, fontWeight: '800', fontSize: 15 },
  row: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.cardBorder,
  },
  rowTitle: { color: C.text, fontWeight: '800', fontSize: 15, textAlign: 'right' },
  rowSub: { color: C.muted, fontSize: 11.5, textAlign: 'right', marginTop: 2 },
  apply: { backgroundColor: C.violetSoft, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  applyTxt: { color: C.violet, fontWeight: '800', fontSize: 13 },
  del: { paddingHorizontal: 8, paddingVertical: 8 },
  delTxt: { color: C.red, fontSize: 12.5, fontWeight: '700' },
  err: { color: C.red, fontSize: 13, textAlign: 'center' },
  status: { color: C.sub, fontSize: 12.5, textAlign: 'center' },
});
