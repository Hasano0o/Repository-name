import { useCallback, useState } from 'react';
import {
  ScrollView, View, Text, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet, RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { SmsMessage } from '../../src/drivers/types';
import { C } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';

type Box = 'inbox' | 'sent';

export default function SmsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [box, setBox] = useState<Box>('inbox');
  const [items, setItems] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async (r: SavedRouter, b: Box) => {
    setError('');
    try {
      const list = await withSession(r, d => (d.listSms ? d.listSms(b) : Promise.resolve([] as SmsMessage[])));
      setItems(list);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      setLoading(true);
      await load(r, box);
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, box, load]));

  const onRefresh = async () => {
    if (!info) return;
    setRefreshing(true);
    await load(info, box);
    setRefreshing(false);
  };

  const onSend = async () => {
    if (!info) return;
    const p = phone.trim();
    if (!p || !text.trim()) { Alert.alert('ناقص', 'اكتب الرقم ونص الرسالة'); return; }
    setSending(true);
    try {
      await withSession(info, d => d.sendSms!(p, text), false);
      setText('');
      Alert.alert('تم', 'انرسلت الرسالة');
      if (box === 'sent') await load(info, box);
    } catch (e: any) {
      Alert.alert('ما انرسلت', e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  };

  const onOpen = async (m: SmsMessage) => {
    if (!info || !m.unread) return;
    setItems(list => list.map(x => (x.index === m.index ? { ...x, unread: false } : x)));
    try { await withSession(info, d => (d.markSmsRead ? d.markSmsRead(m.index) : Promise.resolve()), false); } catch {}
  };

  const onDelete = (m: SmsMessage) => {
    if (!info) return;
    Alert.alert('حذف الرسالة', 'تبي تحذف هذي الرسالة من الراوتر؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف', style: 'destructive', onPress: async () => {
          try {
            await withSession(info, d => d.deleteSms!(m.index), false);
            setItems(list => list.filter(x => x.index !== m.index));
          } catch (e: any) {
            Alert.alert('خطأ', e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.blue} colors={[C.blue]} />}
      >
        <GlassCard title="رسالة جديدة" icon="✏️" defaultOpen={false}>
          <TextInput
            style={s.input} value={phone} onChangeText={setPhone}
            placeholder="رقم الجوال" placeholderTextColor={C.muted} keyboardType="phone-pad"
          />
          <TextInput
            style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]} value={text} onChangeText={setText}
            placeholder="نص الرسالة" placeholderTextColor={C.muted} multiline
          />
          <Pressable style={[s.btn, sending && { opacity: 0.5 }]} onPress={onSend} disabled={sending}>
            <Text style={s.btnText}>{sending ? 'نرسل...' : 'إرسال'}</Text>
          </Pressable>
        </GlassCard>

        <View style={s.tabs}>
          {(['sent', 'inbox'] as Box[]).map(b => (
            <Pressable key={b} style={[s.tab, box === b && s.tabOn]} onPress={() => setBox(b)}>
              <Text style={[s.tabText, box === b && { color: C.onAccent }]}>{b === 'inbox' ? 'الوارد' : 'المرسل'}</Text>
            </Pressable>
          ))}
        </View>

        {loading && <ActivityIndicator color={C.blue} style={{ marginTop: 20 }} />}
        {!!error && <Text style={s.error}>{error}</Text>}
        {!loading && !error && items.length === 0 && <Text style={s.muted}>ما فيه رسائل</Text>}

        {!loading && items.map(m => (
          <Pressable key={m.index} style={[s.msg, m.unread && s.msgUnread]} onPress={() => onOpen(m)} onLongPress={() => onDelete(m)}>
            <View style={s.msgHead}>
              <Text style={s.msgDate}>{m.date}</Text>
              <View style={s.msgFrom}>
                <Text style={s.msgPhone}>{m.phone}</Text>
                {m.unread && <View style={s.unreadDot} />}
              </View>
            </View>
            <Text style={s.msgBody}>{m.content}</Text>
          </Pressable>
        ))}

        {!loading && items.length > 0 && <Text style={s.hint}>اضغط مطوّل على الرسالة لحذفها</Text>}
      </ScrollView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  input: {
    backgroundColor: C.rowBg, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.cardBorder, color: C.text, textAlign: 'right',
  },
  btn: { backgroundColor: C.blue, borderRadius: 14, padding: 14, alignItems: 'center' },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 15 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.card, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  tabOn: { backgroundColor: C.blue, borderColor: C.blue },
  tabText: { color: C.text, fontWeight: '700' },
  muted: { color: C.sub, textAlign: 'center', marginTop: 20 },
  error: { color: C.red, fontWeight: '600', textAlign: 'right' },
  hint: { color: C.muted, fontSize: 12, textAlign: 'center' },
  msg: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  msgUnread: { borderColor: C.blue },
  msgHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  msgFrom: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  msgPhone: { color: C.text, fontWeight: '800' },
  msgDate: { color: C.muted, fontSize: 11 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.blue },
  msgBody: { color: C.sub, textAlign: 'right', lineHeight: 22 },
});
