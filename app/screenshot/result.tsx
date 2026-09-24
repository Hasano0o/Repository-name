/**
 * Screenshot Result Screen — PHASE 4C-2C-3
 *
 * ملخص نجاح فقط — لا نعرض الحزمة كاملة.
 * لا endpoints، لا evidence، لا originalValue.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { C, R, S, T } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import { useScreenshotFlow } from '../../src/ui/screenshot-flow-context';

const COMPAT_LABELS: Record<string, string> = {
  FULL: 'مدعوم بالكامل',
  READ_ONLY: 'قراءة فقط',
  PARTIAL: 'دعم جزئي',
  DISCOVERY_ONLY: 'استكشاف فقط',
  UNSUPPORTED: 'غير مدعوم',
};

export default function ScreenshotResultScreen() {
  const nav = useRouter();
  const { state, actions } = useScreenshotFlow();

  function onDone() {
    // نحفظ host في متغير محلي قبل reset() لضمان استخدامه في navigation
    const host = state.host;
    actions.reset();
    if (host) {
      nav.replace({ pathname: '/probe', params: { host } });
    } else {
      nav.replace('/probe');
    }
  }

  if (!state.finalPackage) {
    return (
      <View style={s.center}>
        <Text style={s.emptyText}>لا توجد حزمة تشخيصية.</Text>
        <Pressable style={[s.btn, s.btnPrimary]} onPress={() => nav.back()}>
          <Text style={[s.btnTxt, s.btnTxtPrimary]}>رجوع</Text>
        </Pressable>
      </View>
    );
  }

  const pkg = state.finalPackage;
  const fieldsCount =
    Object.keys(pkg.signalFields).length +
    Object.keys(pkg.bandFields).length +
    Object.keys(pkg.cellFields).length;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      <GlassCard title="✅ تم" subtitle="Success" tint={C.green} collapsible={false}>
        <Text style={s.p}>تم تجهيز الحزمة التشخيصية بنجاح.</Text>

        <View style={s.statsBox}>
          <View style={s.statRow}>
            <Text style={s.statLabel}>حقول مضمّنة</Text>
            <Text style={s.statValue}>{fieldsCount}</Text>
          </View>
          <View style={s.statRow}>
            <Text style={s.statLabel}>مستوى التوافق</Text>
            <Text style={s.statValue}>
              {COMPAT_LABELS[pkg.compatLevel] ?? pkg.compatLevel}
            </Text>
          </View>
        </View>

        <Text style={s.note}>
          لم تُحفَظ أي صورة أو نص. المعلومات الحساسة تُجاهل تلقائيًا.
        </Text>

        <View style={s.buttonsRow}>
          <Pressable style={[s.btn, s.btnGhost]} onPress={() => nav.back()}>
            <Text style={[s.btnTxt, s.btnTxtGhost]}>رجوع للتفاصيل</Text>
          </Pressable>
          <Pressable style={[s.btn, s.btnPrimary]} onPress={onDone}>
            <Text style={[s.btnTxt, s.btnTxtPrimary]}>تم</Text>
          </Pressable>
        </View>
      </GlassCard>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: S.lg, gap: S.md, paddingBottom: 40 },
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: S.lg, gap: S.md, backgroundColor: C.bg,
  },
  emptyText: { color: C.sub, fontSize: T.body, textAlign: 'center' },
  p: {
    color: C.sub, fontSize: T.body, lineHeight: 22,
    textAlign: 'right', marginBottom: S.md,
  },
  statsBox: { gap: S.xs, marginBottom: S.md },
  statRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: S.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.cardBorder,
  },
  statLabel: { color: C.sub, fontSize: T.body },
  statValue: { color: C.text, fontSize: T.body, fontWeight: '700' },
  note: {
    color: C.muted, fontSize: T.label, textAlign: 'center',
    marginTop: S.sm, lineHeight: 20,
  },
  buttonsRow: { flexDirection: 'row-reverse', gap: S.sm, marginTop: S.lg },
  btn: {
    flex: 1, paddingVertical: S.md, borderRadius: R.md,
    alignItems: 'center', justifyContent: 'center', minHeight: 48,
  },
  btnPrimary: { backgroundColor: C.blue },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.cardBorder,
  },
  btnTxt: { fontSize: T.body, fontWeight: '600' },
  btnTxtPrimary: { color: '#fff' },
  btnTxtGhost: { color: C.text },
});
