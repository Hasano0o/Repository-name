/**
 * «باقتي» (١٦ نوفمبر): العضو يضيف باقته يدوي (الحجم · المدة · يوم الاشتراك) ونحسب استهلاكه الحقيقي
 * من عدّاد الراوتر (سجل الاستهلاك اليومي) — كم استهلك، كم باقي، كم يوم للتجديد، ومتى تخلص بمعدله.
 * المنطق: src/utils/manualPlan.ts · التخزين: src/store/manualPlan.ts · التنبيهات بالخلفية: src/tasks/monitor.ts
 */
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, TextInput, Pressable } from '../i18n/rn';
import { useFocusEffect } from 'expo-router';
import { GlassCard } from './GlassCard';
import { C, tBg, tFg } from './theme';
import { FONT } from './fonts';
import { fmtBytes } from '../utils/format';
import { getUsageLog } from '../store/usageLog';
import { getManualPlan, setManualPlan } from '../store/manualPlan';
import { ManualPlan, PlanStatus, planStatus, dayStart, addDays } from '../utils/manualPlan';
import { dayKey } from '../utils/usageDays';
import { sheet } from '../i18n';

const SIZES = [10, 50, 100, 200, 500];
const DURS: { d: number; label: string }[] = [{ d: 7, label: 'أسبوع' }, { d: 30, label: 'شهر' }, { d: 90, label: '٣ شهور' }];
const AGO: { n: number; label: string }[] = [{ n: 0, label: 'اليوم' }, { n: 1, label: 'أمس' }, { n: 7, label: 'قبل أسبوع' }];

const fmtDate = (t: number) => { const d = new Date(t); return `${d.getDate()}/${d.getMonth() + 1}`; };

export function ManualPlanCard({ routerId, refresh }: { routerId: string; refresh?: unknown }) {
  const [plan, setPlan] = useState<ManualPlan | null>(null);
  const [st, setSt] = useState<PlanStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [edit, setEdit] = useState(false);
  const [size, setSize] = useState('100');
  const [dur, setDur] = useState(30);
  const [ago, setAgo] = useState('0');
  /** مفتوحة ولا مخفية (سهم في الرأس) — تنحفظ لكل راوتر، والافتراضي مخفية عشان ما تاخذ حيز */
  const [open, setOpen] = useState(false);
  const openKey = `bandly.manualPlan.open.${routerId}`;

  const load = useCallback(async () => {
    const [p, log, o] = await Promise.all([getManualPlan(routerId), getUsageLog(routerId), AsyncStorage.getItem(openKey).catch(() => null)]);
    setOpen(o === '1');
    setPlan(p);
    setSt(p ? planStatus(p, log, Date.now()) : null);
    setReady(true);
  }, [routerId, openKey]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load, refresh]));

  const openEdit = () => {
    if (plan) { setSize(String(plan.sizeGB)); setDur(plan.days); setAgo(String(Math.max(0, Math.round((dayStart(Date.now()) - dayStart(plan.start)) / 86_400_000)))); }
    setEdit(true);
  };

  const save = async () => {
    const gb = parseFloat(size.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(',', '.'));
    const n = Math.max(0, Math.round(Number(ago.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))) || 0));
    if (!(gb > 0 && gb <= 10000)) { Alert.alert('حجم الباقة', 'اكتب حجم الباقة بالجيجا، مثلاً 100.'); return; }
    if (n >= dur) { Alert.alert('يوم الاشتراك', 'يوم الاشتراك أقدم من مدة الباقة — يعني الباقة تجددت. اكتب يوم آخر تجديد.'); return; }
    const start = addDays(dayStart(Date.now()), -n);
    // اشترك اليوم: اللي استهلكه اليوم قبل الباقة ما ينحسب عليها
    let baseBytes: number | undefined;
    if (n === 0) { const log = await getUsageLog(routerId); baseBytes = log.days[dayKey(Date.now())]?.bytes || undefined; }
    // نفس الباقة والدورة (تعديل بسيط) ← نخلي التنبيهات اللي انرسلت
    const same = plan && plan.start === start;
    const p: ManualPlan = { sizeGB: gb, days: dur, start, baseBytes: same ? plan!.baseBytes : baseBytes, alert: same ? plan!.alert : undefined };
    await setManualPlan(routerId, p);
    setEdit(false);
    await load();
  };

  const remove = () => Alert.alert('حذف الباقة', 'نحذف باقتك من التطبيق؟ سجل الاستهلاك يبقى.', [
    { text: 'لا', style: 'cancel' },
    { text: 'احذف', style: 'destructive', onPress: async () => { await setManualPlan(routerId, null); setEdit(false); await load(); } },
  ]);

  if (!ready) return null;

  if (edit) {
    return (
      <GlassCard title="باقتي" icon="📦" tint="#16a34a" collapsible={false}>
        <Text style={s.lbl}>حجم الباقة (جيجا)</Text>
        <View style={s.chips}>
          {SIZES.map(v => (
            <Pressable key={v} onPress={() => setSize(String(v))} style={[s.chip, size === String(v) && s.chipOn]}>
              <Text style={[s.chipTxt, size === String(v) && s.chipTxtOn]}>{v}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput style={s.input} value={size} onChangeText={setSize} keyboardType="decimal-pad" placeholder="مثلاً 100" placeholderTextColor={C.sub} />

        <Text style={s.lbl}>مدة الباقة</Text>
        <View style={s.chips}>
          {DURS.map(x => (
            <Pressable key={x.d} onPress={() => setDur(x.d)} style={[s.chip, dur === x.d && s.chipOn]}>
              <Text style={[s.chipTxt, dur === x.d && s.chipTxtOn]}>{x.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.lbl}>متى اشتركت (أو آخر تجديد)؟</Text>
        <View style={s.chips}>
          {AGO.map(x => (
            <Pressable key={x.n} onPress={() => setAgo(String(x.n))} style={[s.chip, ago === String(x.n) && s.chipOn]}>
              <Text style={[s.chipTxt, ago === String(x.n) && s.chipTxtOn]}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={s.agoRow}>
          <Text style={s.hint}>قبل</Text>
          <TextInput style={[s.input, s.agoInput]} value={ago} onChangeText={setAgo} keyboardType="number-pad" maxLength={2} />
          <Text style={s.hint}>يوم</Text>
        </View>

        <Pressable style={[s.btn, { backgroundColor: tBg('#16a34a') }]} onPress={save}>
          <Text style={s.btnTxt}>احفظ</Text>
        </Pressable>
        <View style={s.linkRow}>
          <Pressable onPress={() => setEdit(false)}><Text style={s.link}>إلغاء</Text></Pressable>
          {!!plan && <Pressable onPress={remove}><Text style={[s.link, { color: tFg('#dc2626') }]}>حذف الباقة</Text></Pressable>}
        </View>
        <Text style={s.hint}>الاستهلاك يتحسب من عدّاد الراوتر، فممكن يختلف شوي عن رقم شركتك. ولما تخلص المدة تتجدد لحالها.</Text>
      </GlassCard>
    );
  }

  if (!plan || !st) {
    return (
      <Pressable onPress={openEdit} style={({ pressed }) => [s.add, pressed && { opacity: 0.85 }]}>
        <Text style={s.addIcon}>📦</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.addTitle}>أضف باقتك</Text>
          <Text style={s.addSub}>اكتب حجمها ومدتها، ونحسب لك كم استهلكت وكم باقي</Text>
        </View>
      </Pressable>
    );
  }

  const col = st.pct >= 95 ? tFg('#dc2626') : st.pct >= 80 ? tFg('#ea580c') : tFg('#16a34a');
  return (
    <GlassCard key={open ? 'o' : 'c'} title={`باقتي · ${plan.sizeGB} جيجا`} icon="📦" tint="#16a34a"
      defaultOpen={open}
      subtitle={open ? undefined : `استهلكت ${fmtBytes(st.used)} · باقي ${fmtBytes(st.left)} · ${st.daysLeft} يوم`}
      onToggle={o => { setOpen(o); AsyncStorage.setItem(openKey, o ? '1' : '0').catch(() => {}); }}>
      <Pressable onPress={openEdit}>
        <View style={s.topRow}>
          <Text style={[s.big, { color: col }]}>{fmtBytes(st.used)}</Text>
          <Text style={s.of}>من {plan.sizeGB} جيجا</Text>
        </View>
        <View style={s.track}><View style={[s.fill, { width: `${Math.max(2, st.pct)}%`, backgroundColor: col }]} /></View>
        <View style={s.row}>
          <View style={s.box}><Text style={s.val}>{fmtBytes(st.left)}</Text><Text style={s.boxLbl}>باقي</Text></View>
          <View style={s.box}><Text style={s.val}>{st.daysLeft}</Text><Text style={s.boxLbl}>يوم للتجديد ({fmtDate(st.renewAt)})</Text></View>
          {st.avg > 0 && <View style={s.box}><Text style={s.val}>{fmtBytes(st.avg)}</Text><Text style={s.boxLbl}>معدلك باليوم</Text></View>}
        </View>
        {st.pct >= 100 ? (
          <Text style={[s.warn, { color: tFg('#dc2626') }]}>🚨 خلصت الباقة حسب عدّاد الراوتر</Text>
        ) : st.early && st.runOutIn !== undefined ? (
          <Text style={[s.warn, { color: tFg('#ea580c') }]}>⚠️ بهالمعدل تخلص بعد {st.runOutIn} يوم — قبل التجديد بـ {st.daysLeft - st.runOutIn} يوم</Text>
        ) : st.avg > 0 ? (
          <Text style={s.hint}>بهالمعدل تكفيك لين التجديد ✓</Text>
        ) : null}
        {st.partial && <Text style={s.hint}>فيه أيام ما انفتح فيها التطبيق — الرقم تقريبي. شغّل «المراقبة بالخلفية» عشان يصير أدق.</Text>}
        <Text style={s.editHint}>اضغط للتعديل</Text>
      </Pressable>
    </GlassCard>
  );
}

const s = sheet({
  add: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: tBg('#16a34a'), backgroundColor: tBg('#16a34a0d'), padding: 14 },
  addIcon: { fontSize: 26 },
  addTitle: { color: C.text, fontWeight: '900', fontSize: 15, textAlign: 'right' },
  addSub: { color: C.sub, fontSize: 12.5, textAlign: 'right', marginTop: 2 },
  topRow: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: 8 },
  big: { fontSize: 30, fontWeight: '900', fontFamily: FONT.num },
  of: { color: C.sub, fontSize: 14, fontWeight: '700' },
  track: { height: 10, borderRadius: 5, backgroundColor: C.track, overflow: 'hidden', marginTop: 8, flexDirection: 'row-reverse' },
  fill: { height: 10, borderRadius: 5 },
  row: { flexDirection: 'row-reverse', gap: 8, marginTop: 12 },
  box: { flex: 1, backgroundColor: C.rowBg, borderRadius: 12, paddingVertical: 8, alignItems: 'center' },
  val: { color: C.text, fontSize: 15, fontWeight: '900', fontFamily: FONT.num },
  boxLbl: { color: C.sub, fontSize: 11, marginTop: 2, textAlign: 'center' },
  warn: { fontSize: 13, fontWeight: '800', textAlign: 'right', marginTop: 10 },
  hint: { color: C.sub, fontSize: 12, lineHeight: 18, textAlign: 'right', marginTop: 8 },
  editHint: { color: C.sub, fontSize: 11, textAlign: 'center', marginTop: 8, opacity: 0.8 },
  lbl: { color: C.text, fontSize: 13.5, fontWeight: '800', textAlign: 'right', marginTop: 12 },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { flexGrow: 1, minWidth: 54, borderRadius: 12, borderWidth: 1.5, borderColor: C.cardBorder, backgroundColor: C.rowBg, paddingVertical: 9, alignItems: 'center' },
  chipOn: { backgroundColor: tBg('#16a34a'), borderColor: tBg('#16a34a') },
  chipTxt: { color: C.text, fontWeight: '800', fontSize: 14 },
  chipTxtOn: { color: '#fff' },
  input: { borderWidth: 1.5, borderColor: C.cardBorder, backgroundColor: C.rowBg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, color: C.text, fontSize: 16, textAlign: 'center', marginTop: 8 },
  agoRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, justifyContent: 'center' },
  agoInput: { width: 70 },
  btn: { borderRadius: 14, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  linkRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 4 },
  link: { color: C.blue, fontWeight: '800', fontSize: 13.5 },
});
