import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Share, KeyboardAvoidingView, Platform } from 'react-native';
import { View, Text, Pressable, TextInput, ScrollView } from '../i18n/rn';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getLabel, setLabel, LabelCreds } from '../store/routers';
import { C, tBg, tFg } from './theme';
import { Icon } from './Icon';
import { sheet } from '../i18n';

/**
 * «بيانات الملصق» — بيانات المصنع اللي تحت الراوتر، محفوظة مشفّرة على الجوال بس.
 * المستخدم يحطها مرة وحدة (تصوير أو كتابة)، ويشوفها بضغطة وقت الحاجة.
 * وبعد ضبط المصنع التطبيق يدخل فيها لحاله (sessions.ts).
 */
const FIELDS: { k: keyof LabelCreds; label: string; secret: boolean; hint: string }[] = [
  { k: 'adminPassword', label: 'كلمة دخول الراوتر', secret: true, hint: 'Password / Admin Password' },
  { k: 'username', label: 'اسم المستخدم', secret: false, hint: 'غالباً admin' },
  { k: 'ssid', label: 'اسم الواي فاي', secret: false, hint: 'SSID / WLAN Name' },
  { k: 'wifiPassword', label: 'كلمة الواي فاي', secret: true, hint: 'WiFi Key / WLAN Key' },
];

export function LabelCard({ routerId }: { routerId: string }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<LabelCreds | null>(null);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<LabelCreds | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});

  const load = useCallback(() => { getLabel(routerId).then(setData).catch(() => setData(null)); }, [routerId]);
  useEffect(load, [load]);

  const has = !!data && Object.values(data).some(Boolean);
  const close = () => { setOpen(false); setEdit(null); setShown({}); };

  const save = async () => {
    if (!edit) return;
    await setLabel(routerId, edit);
    setEdit(null);
    load();
  };

  const remove = () => Alert.alert('حذف بيانات الملصق', 'بنمسحها من جوالك. تقدر تضيفها مرة ثانية متى ما بغيت.', [
    { text: 'إلغاء', style: 'cancel' },
    { text: 'احذف', style: 'destructive', onPress: async () => { await setLabel(routerId, null); load(); close(); } },
  ]);

  const share = (v: string) => Share.share({ message: v }).catch(() => {});

  return (
    <>
      <Pressable onPress={() => { setOpen(true); if (!has) setEdit({}); }} style={({ pressed }) => [s.row, pressed && { opacity: 0.8 }]}>
        <View style={s.icon}><Icon name="lock" size={17} color={tFg('#0f766e')} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>بيانات الملصق</Text>
          <Text style={s.sub} numberOfLines={1}>
            {has ? 'محفوظة على جوالك — اضغط تشوفها' : 'احفظ كلمة الملصق مرة وحدة — تنفعك بعد ضبط المصنع'}
          </Text>
        </View>
        <View style={[s.badge, !has && s.badgeOff]}><Text style={[s.badgeTxt, !has && { color: C.sub }]}>{has ? 'محفوظة' : 'أضفها'}</Text></View>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.kav}>
        <Pressable style={s.backdrop} onPress={close} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={s.grip} />
          <Text style={s.sheetTitle}>بيانات الملصق</Text>
          <Text style={s.sheetSub}>اللي مكتوب على الملصق تحت الراوتر. ترجع لها بعد ضبط المصنع. محفوظة مشفّرة على جوالك بس، وما تطلع لأي مكان.</Text>
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
            {FIELDS.map(f => {
              const v = (edit ? edit[f.k] : data?.[f.k]) ?? '';
              if (!edit && !v) return null;
              return (
                <View key={f.k} style={s.field}>
                  <Text style={s.fLabel}>{f.label}</Text>
                  {edit ? (
                    <TextInput value={v} onChangeText={t => setEdit(e => ({ ...(e ?? {}), [f.k]: t }))}
                      placeholder={f.hint} placeholderTextColor={C.sub} autoCapitalize="none" autoCorrect={false}
                      style={s.input} />
                  ) : (
                    <View style={s.valRow}>
                      <Text style={s.val} selectable>{f.secret && !shown[f.k] ? '••••••••' : v}</Text>
                      {f.secret && (
                        <Pressable hitSlop={8} onPress={() => setShown(x => ({ ...x, [f.k]: !x[f.k] }))}>
                          <Icon name={shown[f.k] ? 'eye-off' : 'eye'} size={20} color={C.sub} />
                        </Pressable>
                      )}
                      <Pressable hitSlop={8} onPress={() => share(v)}>
                        <Icon name="share" size={18} color={C.blue} />
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
          {edit ? (
            <Pressable onPress={save} style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]}>
              <Text style={s.btnTxt}>احفظ</Text>
            </Pressable>
          ) : (
            <View style={s.actions}>
              <Pressable onPress={() => setEdit({ ...(data ?? {}) })} style={({ pressed }) => [s.btn, { flex: 1, marginTop: 0 }, pressed && { opacity: 0.85 }]}>
                <Text style={s.btnTxt}>عدّل</Text>
              </Pressable>
              <Pressable onPress={remove} hitSlop={8}><Text style={s.del}>احذف</Text></Pressable>
            </View>
          )}
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const s = sheet({
  row: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 18,
    borderWidth: 1, borderColor: C.cardBorder, paddingVertical: 12, paddingHorizontal: 14,
  },
  icon: { width: 36, height: 36, borderRadius: 12, backgroundColor: tBg('#ccfbef'), alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 14.5, fontWeight: '800', textAlign: 'right' },
  sub: { color: C.sub, fontSize: 12, textAlign: 'right', marginTop: 2 },
  badge: { backgroundColor: tBg('#0f766e'), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeOff: { backgroundColor: C.rowBg },
  badgeTxt: { color: tFg('#ffffff'), fontSize: 11.5, fontWeight: '800' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, gap: 6, maxHeight: '88%' },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.cardBorder, marginBottom: 6 },
  sheetTitle: { color: C.text, fontSize: 18, fontWeight: '900', textAlign: 'right' },
  sheetSub: { color: C.sub, fontSize: 12.5, lineHeight: 19, textAlign: 'right', marginBottom: 6 },
  field: { marginTop: 10, gap: 6 },
  fLabel: { color: C.text, fontSize: 13.5, fontWeight: '800', textAlign: 'right' },
  input: { backgroundColor: C.rowBg, borderRadius: 14, paddingHorizontal: 12, minHeight: 46, color: C.text, fontSize: 15, textAlign: 'left', writingDirection: 'ltr' },
  valRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 14, backgroundColor: C.rowBg, borderRadius: 14, paddingHorizontal: 12, minHeight: 46 },
  val: { flex: 1, color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'left', writingDirection: 'ltr' },
  actions: { flexDirection: 'row-reverse', alignItems: 'center', gap: 16, marginTop: 14 },
  btn: { marginTop: 14, backgroundColor: tBg('#0f766e'), borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  btnTxt: { color: tFg('#ffffff'), fontSize: 16, fontWeight: '900' },
  del: { color: C.red, fontSize: 14, fontWeight: '800' },
});
