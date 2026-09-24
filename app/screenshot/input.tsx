/**
 * Screenshot Input Screen — PHASE 4C-2C-1
 *
 * Manual text input فقط.
 * TextInput maxLength يحمي الإدخال.
 * التحقق قبل المعالجة يمنع استدعاءات فاشلة.
 * لا منطق أمني — نستدعي runScreenshotTextPipeline.
 */

import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { C, R, S, T } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import { useScreenshotFlow } from '../../src/ui/screenshot-flow-context';
import {
  MAX_TEXT_INPUT_LENGTH,
  isTextInputEmpty,
  isTextInputTooLong,
  isTextInputValid,
} from '../../src/router-discovery/screenshot/ui-helpers';
import { runScreenshotTextPipeline } from '../../src/router-discovery/screenshot';
import { createReviewFromResult } from '../../src/router-discovery/screenshot/review';

export default function ScreenshotInputScreen() {
  const nav = useRouter();
  const { state, actions } = useScreenshotFlow();
  const [text, setText] = useState(state.rawText);
  const [busy, setBusy] = useState(false);

  const charCount = text.length;
  const tooLong = useMemo(() => isTextInputTooLong(text), [text]);
  const empty = useMemo(() => isTextInputEmpty(text), [text]);
  const valid = useMemo(() => isTextInputValid(text), [text]);

  function onAnalyze() {
    if (busy) return;
    if (!state.host) {
      Alert.alert('خطأ', 'لم يُمرَّر عنوان راوتر صالح.');
      return;
    }
    if (empty) {
      Alert.alert('لا يوجد نص', 'الصق أو اكتب معلومات من واجهة الراوتر أولًا.');
      return;
    }
    if (tooLong) {
      Alert.alert(
        'النص طويل جدًا',
        `الحد الأقصى ${MAX_TEXT_INPUT_LENGTH.toLocaleString()} حرف.`,
      );
      return;
    }

    setBusy(true);
    try {
      actions.setRawText(text);

      const result = runScreenshotTextPipeline({
        consent: state.consent,
        text,
        capturedAt: Date.now(),
      });

      if (!result.ok) {
        if (result.reason === 'CONSENT_MISSING') {
          Alert.alert('موافقة مفقودة', 'يجب الموافقة على الشروط أولًا.', [
            { text: 'رجوع', onPress: () => nav.back() },
          ]);
        } else if (result.reason === 'EMPTY_INPUT') {
          Alert.alert('لا يوجد نص', 'لم نجد أي محتوى صالح في النص.');
        }
        return;
      }

      const reviewState = createReviewFromResult(result.result);
      actions.setReviewState(reviewState);
      nav.push('/screenshot/review');
    } catch (e: any) {
      Alert.alert('خطأ', e?.message ?? 'فشل التحليل.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView
        style={s.wrap}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        <GlassCard
          title="📋 أدخل المعلومات"
          subtitle="Manual input"
          tint={C.blue}
          collapsible={false}
        >
          <Text style={s.p}>
            انسخ ما يظهر في صفحة الراوتر والصقه هنا. سنستخرج فقط الحقول
            المسموح بها ونتجاهل البيانات الحساسة تلقائيًا.
          </Text>

          <TextInput
            style={s.textArea}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={MAX_TEXT_INPUT_LENGTH}
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={'مثال:\nRSRP: -92 dBm\nSINR: 18 dB\nBand: B3\nPCI: 123'}
            placeholderTextColor={C.muted}
            editable={!busy}
          />

          <View style={s.counterRow}>
            <Text style={[s.counter, tooLong && s.counterWarn]}>
              {charCount.toLocaleString()} / {MAX_TEXT_INPUT_LENGTH.toLocaleString()}
            </Text>
            {tooLong && <Text style={s.counterWarn}>النص طويل جدًا</Text>}
          </View>

          <View style={s.buttonsRow}>
            <Pressable
              style={[s.btn, s.btnGhost]}
              disabled={busy}
              onPress={() => nav.back()}
            >
              <Text style={[s.btnTxt, s.btnTxtGhost]}>رجوع</Text>
            </Pressable>
            <Pressable
              style={[s.btn, s.btnPrimary, (!valid || busy) && s.btnDisabled]}
              disabled={!valid || busy}
              onPress={onAnalyze}
            >
              <Text style={[s.btnTxt, s.btnTxtPrimary]}>
                {busy ? '...' : 'تحليل'}
              </Text>
            </Pressable>
          </View>
        </GlassCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: C.bg },
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: S.lg, gap: S.md, paddingBottom: 40 },
  p: {
    color: C.sub, fontSize: T.body, lineHeight: 22,
    textAlign: 'right', marginBottom: S.md,
  },
  textArea: {
    minHeight: 220, maxHeight: 420,
    backgroundColor: C.rowBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.cardBorder,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    color: C.text,
    fontSize: T.body,
    lineHeight: 22,
    textAlign: 'right',
  },
  counterRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: S.xs,
  },
  counter: { color: C.muted, fontSize: T.label },
  counterWarn: { color: C.red, fontSize: T.label, fontWeight: '600' },
  buttonsRow: {
    flexDirection: 'row-reverse',
    gap: S.sm,
    marginTop: S.lg,
  },
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
  btnDisabled: { opacity: 0.45 },
  btnTxt: { fontSize: T.body, fontWeight: '600' },
  btnTxtPrimary: { color: '#fff' },
  btnTxtGhost: { color: C.text },
});
