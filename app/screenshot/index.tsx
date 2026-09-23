/**
 * Screenshot Consent Screen — PHASE 4C-2C-1
 *
 * شاشة عرض فقط. تستدعي pure functions.
 * لا منطق أمني هنا.
 */

import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { C, R, S, T } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import { useScreenshotFlow } from '../../src/ui/screenshot-flow-context';
import { grantConsent, createConsentState } from '../../src/router-discovery/screenshot/consent';

export default function ScreenshotConsentScreen() {
  const nav = useRouter();
  const { state, actions } = useScreenshotFlow();

  // ═══ إذا لم يُمرَّر host صالح → عرض خطأ وعدم السماح بالمتابعة
  useEffect(() => {
    if (!state.host) {
      Alert.alert(
        'عنوان غير صالح',
        'تعذّر فتح مساعد الصور بدون عنوان راوتر محلي.',
        [{ text: 'رجوع', onPress: () => nav.back() }],
      );
    }
  }, [state.host, nav]);

  function onContinue() {
    if (!state.host) return;
    actions.setConsent(grantConsent(createConsentState(), Date.now()));
    nav.push({ pathname: '/screenshot/input', params: { host: state.host } });
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      <GlassCard title="🖼️ مساعد الصور" subtitle="Screenshot Helper" tint={C.violet} collapsible={false}>
        <Text style={s.p}>
          سنحلّل النص الذي تلصقه لاستخراج معلومات الشبكة والإشارة، ولن نحتفظ بالصورة أو النص.
        </Text>

        <Text style={s.sectionTitle}>سنستخدم</Text>
        <Text style={s.li}>✓ النص الذي تلصقه</Text>
        <Text style={s.li}>✓ عنوان الراوتر المحلي (كسياق)</Text>

        <Text style={s.sectionTitle}>لن نفعل</Text>
        <Text style={s.li}>✗ لا نحفظ الصور</Text>
        <Text style={s.li}>✗ لا نرفع أي شيء لأي خادم</Text>
        <Text style={s.li}>✗ لا نحفظ كلمات المرور أو التوكنات</Text>
        <Text style={s.li}>✗ المعلومات الحساسة تُتجاهل تلقائيًا</Text>
        <Text style={s.li}>✗ لا تثبيت إعدادات على الراوتر</Text>

        <View style={s.buttonsRow}>
          <Pressable
            style={[s.btn, s.btnGhost]}
            onPress={() => nav.back()}
          >
            <Text style={[s.btnTxt, s.btnTxtGhost]}>إلغاء</Text>
          </Pressable>
          <Pressable
            style={[s.btn, s.btnPrimary, !state.host && s.btnDisabled]}
            disabled={!state.host}
            onPress={onContinue}
          >
            <Text style={[s.btnTxt, s.btnTxtPrimary]}>متابعة</Text>
          </Pressable>
        </View>
      </GlassCard>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: S.lg, gap: S.md, paddingBottom: 40 },
  p: { color: C.sub, fontSize: T.body, lineHeight: 22, textAlign: 'right', marginBottom: S.md },
  sectionTitle: {
    color: C.text, fontSize: T.label, fontWeight: '700',
    textAlign: 'right', marginTop: S.md, marginBottom: S.xs,
  },
  li: { color: C.sub, fontSize: T.body, textAlign: 'right', lineHeight: 22 },
  buttonsRow: {
    flexDirection: 'row-reverse', gap: S.sm, marginTop: S.lg,
  },
  btn: {
    flex: 1, paddingVertical: S.md, borderRadius: R.md,
    alignItems: 'center', justifyContent: 'center', minHeight: 48,
  },
  btnPrimary: { backgroundColor: C.blue },
  btnGhost: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: C.cardBorder },
  btnDisabled: { opacity: 0.45 },
  btnTxt: { fontSize: T.body, fontWeight: '600' },
  btnTxtPrimary: { color: '#fff' },
  btnTxtGhost: { color: C.text },
});
