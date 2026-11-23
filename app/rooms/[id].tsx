/**
 * «الواي فاي بالغرف» (عدّة الألياف — حسن ٢٣ نوفمبر): بدون دخول الراوتر.
 * العضو يوقف في كل غرفة ويضغط «قِس هنا» ← بنق الجوال↔الراوتر (١٠ قياسات) + تنزيل قصير (٥ ثواني).
 * النتيجة لكل غرفة (ممتاز/جيد/متوسط/ضعيف) + نصيحة للبيت كامل (وين المقوّي، وين أقوى مكان).
 * (قوة الإشارة dBm من الجوال تحتاج مكتبة أصلية — مسجّلة في docs/NEXT_BUILD.md)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { ScrollView, View, Text, Pressable, TextInput } from '../../src/i18n/rn';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { measureWifi } from '../../src/utils/latency';
import { quickDownload } from '../../src/utils/speedtest';
import { findGateway } from '../../src/services/gateway';
import {
  RoomRead, ROOM_PRESETS, ROOM_LEVEL_COL, ROOM_LEVEL_TXT, roomLevel, roomScore, roomsAdvice, speedRef, upsertRoom,
} from '../../src/utils/fiberKit';
import { Icon } from '../../src/ui/Icon';
import { C, R, S, tBg, tBd } from '../../src/ui/theme';
import { sheet } from '../../src/i18n';

export default function Rooms() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rid = String(id || 'none');
  const KEY = `bandly.rooms.${rid}`;
  const [rooms, setRooms] = useState<RoomRead[]>([]);
  const [plan, setPlan] = useState<number | undefined>();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [step, setStep] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    AsyncStorage.multiGet([KEY, `bandly.fiberPlan.${rid}`]).then(([[, r], [, p]]) => {
      if (!alive.current) return;
      try { if (r) setRooms(JSON.parse(r)); } catch {}
      const n = Number(p);
      if (n > 0) setPlan(n);
    }).catch(() => {});
    return () => { alive.current = false; };
  }, [KEY, rid]);

  const save = (next: RoomRead[]) => {
    setRooms(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  };

  const measure = useCallback(async (room: string) => {
    const nm = room.trim();
    if (!nm) { Alert.alert('اسم الغرفة', 'اختار الغرفة اللي أنت فيها أو اكتب اسمها'); return; }
    if (busy) return;
    setBusy(nm);
    try {
      setStep('ندوّر على الراوتر…');
      const host = await findGateway(rid);
      if (!host) {
        Alert.alert('ما لقينا الراوتر', 'تأكد إن جوالك متصل بواي فاي البيت (مو بيانات الجوال) وجرّب مرة ثانية.');
        return;
      }
      setStep('نقيس الواي فاي…');
      const w = await measureWifi(host, 10);
      if (!w.samples) {
        Alert.alert('الراوتر ما رد', 'الإشارة هنا ضعيفة جداً أو مقطوعة. قرّب شوي وأعد القياس.');
        return;
      }
      setStep('نقيس السرعة…');
      const d = await quickDownload(5000).catch(() => ({ mbps: 0, bytes: 0 }));
      if (!alive.current) return;
      save(upsertRoom(rooms, { name: nm, at: Date.now(), mbps: d.mbps, wifiMs: w.median, jitter: w.jitter, lossPct: w.lossPct }));
      setName('');
    } catch (e: any) {
      if (alive.current) Alert.alert('فشل القياس', e?.message ?? '');
    } finally {
      if (alive.current) { setBusy(''); setStep(''); }
    }
  }, [busy, rid, rooms]);

  const remove = (nm: string) => save(rooms.filter(r => r.name !== nm));
  const clearAll = () => Alert.alert('نمسح كل الغرف؟', '', [
    { text: 'لا', style: 'cancel' },
    { text: 'امسح', style: 'destructive', onPress: () => save([]) },
  ]);

  const ref = speedRef(rooms, plan);
  const sorted = rooms.map(r => ({ r, sc: roomScore(r, ref) })).sort((a, b) => b.sc - a.sc);
  const advice = roomsAdvice(rooms, plan);
  const measured = new Set(rooms.map(r => r.name));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: S.lg, paddingBottom: 40, gap: 12 }} keyboardShouldPersistTaps="handled">
      {/* الشرح + اختيار الغرفة */}
      <View style={s.card}>
        <View style={s.head}>
          <View style={[s.hIcon, { backgroundColor: C.blue }]}><Icon name="wifi" size={18} color="#ffffff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>وين يضعف الواي فاي في بيتك؟</Text>
            <Text style={s.sub}>روح لكل غرفة، اختار اسمها واضغط «قِس هنا» — ١٠ ثواني لكل غرفة</Text>
          </View>
        </View>
        <View style={s.chips}>
          {ROOM_PRESETS.map(p => (
            <Pressable key={p} onPress={() => measure(p)} disabled={!!busy}
              style={[s.chip, measured.has(p) && s.chipDone, busy === p && s.chipBusy]}>
              {busy === p ? <ActivityIndicator size="small" color="#ffffff" /> : measured.has(p) ? <Icon name="check" size={13} color="#12b76a" /> : null}
              <Text style={[s.chipTxt, busy === p && { color: '#ffffff' }]}>{p}</Text>
            </Pressable>
          ))}
        </View>
        <View style={s.customRow}>
          <TextInput value={name} onChangeText={setName} placeholder="غرفة ثانية…" placeholderTextColor={C.muted}
            style={s.input} onSubmitEditing={() => measure(name)} />
          <Pressable onPress={() => measure(name)} disabled={!!busy}>
            <LinearGradient colors={['#2f6bff', '#6a4cff']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={s.mBtn}>
              <Text style={s.mBtnTxt}>قِس هنا</Text>
            </LinearGradient>
          </Pressable>
        </View>
        {!!busy && <Text style={[s.sub, { textAlign: 'center', color: C.blue }]}>{`${busy}: ${step}`}</Text>}
      </View>

      {/* النتائج */}
      {sorted.length > 0 && (
        <View style={s.card}>
          <View style={s.resHead}>
            <Text style={s.title}>{`الغرف (${sorted.length})`}</Text>
            <Pressable onPress={clearAll} hitSlop={8}><Text style={s.clear}>امسح الكل</Text></Pressable>
          </View>
          {sorted.map(({ r, sc }) => {
            const lv = roomLevel(sc);
            const col = ROOM_LEVEL_COL[lv];
            return (
              <View key={r.name} style={s.room}>
                <View style={s.roomTop}>
                  <Text style={s.roomName} numberOfLines={1}>{r.name}</Text>
                  <View style={[s.lvPill, { backgroundColor: tBg(col + '1f') }]}>
                    <Text style={[s.lvTxt, { color: col }]}>{ROOM_LEVEL_TXT[lv]}</Text>
                  </View>
                  <Pressable onPress={() => measure(r.name)} disabled={!!busy} hitSlop={6}>
                    <Icon name="refresh" size={16} color={C.sub} />
                  </Pressable>
                  <Pressable onPress={() => remove(r.name)} disabled={!!busy} hitSlop={6}>
                    <Icon name="trash" size={16} color={C.muted} />
                  </Pressable>
                </View>
                <View style={{ direction: 'ltr' }}>
                  <View style={s.bar}><View style={{ width: `${Math.max(4, sc)}%`, backgroundColor: col, borderRadius: 99 }} /></View>
                </View>
                <View style={s.stats}>
                  <Text style={s.stat}>{`السرعة ${r.mbps >= 100 ? r.mbps.toFixed(0) : r.mbps.toFixed(1)} Mbps`}</Text>
                  <Text style={s.stat}>{`للراوتر ${Math.round(r.wifiMs)}ms`}</Text>
                  {r.lossPct > 0 && <Text style={[s.stat, { color: '#e5484d' }]}>{`فقد ${Math.round(r.lossPct)}٪`}</Text>}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* النصيحة */}
      {advice.length > 0 && (
        <View style={[s.card, { backgroundColor: tBg('#eef4ff'), borderColor: tBd('#bdd9fd') }]}>
          <View style={s.head}>
            <Icon name="bulb" size={18} color={C.blue} />
            <Text style={[s.title, { flex: 1 }]}>نصيحة Bandly</Text>
          </View>
          {advice.map((a, i) => (
            <View key={i} style={s.step}>
              <Text style={[s.stepDot, { color: C.blue }]}>•</Text>
              <Text style={s.stepTxt}>{a}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={s.note}>القياس من جوالك نفسه: البنق للراوتر يكشف ضعف الإشارة، والسرعة تكشف كم يوصلك فعلاً. كل غرفة تستهلك تقريباً ٢٠–٢٠٠ ميقا.</Text>
    </ScrollView>
  );
}

const s = sheet({
  card: {
    backgroundColor: C.card, borderRadius: R.lg, padding: 14, gap: 12, borderWidth: 1, borderColor: tBd('#ffffff'),
    shadowColor: C.shadow, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  hIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  sub: { color: C.sub, fontSize: 11.5, textAlign: 'right', lineHeight: 17 },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 38, borderRadius: 12, backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder },
  chipDone: { borderColor: '#12b76a88', backgroundColor: tBg('#ecfbf3') },
  chipBusy: { backgroundColor: C.blue, borderColor: C.blue },
  chipTxt: { color: C.text, fontSize: 13, fontWeight: '800' },
  customRow: { flexDirection: 'row-reverse', gap: 8 },
  input: { flex: 1, height: 42, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.rowBg, paddingHorizontal: 12, color: C.text, textAlign: 'right' },
  mBtn: { height: 42, paddingHorizontal: 18, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mBtnTxt: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  resHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  clear: { color: C.muted, fontSize: 12, fontWeight: '700' },
  room: { gap: 6, paddingVertical: 4 },
  roomTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  roomName: { flex: 1, color: C.text, fontSize: 14, fontWeight: '900', textAlign: 'right' },
  lvPill: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 2 },
  lvTxt: { fontSize: 11.5, fontWeight: '900' },
  bar: { height: 8, borderRadius: 99, backgroundColor: C.track, overflow: 'hidden', flexDirection: 'row' },
  stats: { flexDirection: 'row-reverse', gap: 12, flexWrap: 'wrap' },
  stat: { color: C.sub, fontSize: 11.5, fontWeight: '700' },
  step: { flexDirection: 'row-reverse', gap: 6 },
  stepDot: { fontSize: 14, fontWeight: '900', lineHeight: 19 },
  stepTxt: { flex: 1, color: C.text, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  note: { color: C.muted, fontSize: 11, textAlign: 'center', lineHeight: 17 },
});
