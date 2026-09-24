/**
 * Screenshot Review Screen — PHASE 4C-2C-2
 *
 * عرض + تعديل Screenshot Evidence.
 * كل التعديلات تمر عبر editReviewField/editReviewIdentity.
 * لا منطق أمني، لا Integration (يُؤجل إلى 4C-2C-3).
 */

import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
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
  editReviewField,
  editReviewIdentity,
  FieldBucket,
  IdentityKey,
  ReviewedField,
} from '../../src/router-discovery/screenshot/review';
import {
  BUCKET_LABELS,
  formatReviewedField,
  shouldShowBucket,
  shouldShowIdentity,
  translateEditReason,
  translateWarning,
} from '../../src/router-discovery/screenshot/ui-helpers';

type EditTarget =
  | { kind: 'identity'; key: IdentityKey }
  | { kind: 'bucket'; bucket: FieldBucket; key: string };

// ────────────── Local components ──────────────

function FieldRow({
  fieldKey,
  field,
  onEdit,
}: {
  fieldKey: string;
  field: ReviewedField;
  onEdit: () => void;
}) {
  const fmt = formatReviewedField(fieldKey, field);
  return (
    <View style={s.row}>
      <View style={s.rowLabel}>
        <Text style={s.fieldLabel}>{fmt.label}</Text>
        {fmt.edited && <Text style={s.editedTag}>✎</Text>}
      </View>
      <View style={s.rowValue}>
        <Text style={s.fieldValue}>{fmt.value}</Text>
        {fmt.unit ? <Text style={s.fieldUnit}>{fmt.unit}</Text> : null}
        <Pressable style={s.editBtn} onPress={onEdit} hitSlop={10}>
          <Text style={s.editBtnTxt}>✎</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <GlassCard title={title} subtitle="" tint={C.blue} collapsible={false}>
      <View style={s.sectionBody}>{children}</View>
    </GlassCard>
  );
}

function IdentitySection({
  identity,
  onEdit,
}: {
  identity: { vendor: ReviewedField | null; model: ReviewedField | null };
  onEdit: (target: EditTarget) => void;
}) {
  return (
    <Section title="بيانات الجهاز">
      {identity.vendor && (
        <FieldRow
          fieldKey="vendor"
          field={identity.vendor}
          onEdit={() => onEdit({ kind: 'identity', key: 'vendor' })}
        />
      )}
      {identity.model && (
        <FieldRow
          fieldKey="model"
          field={identity.model}
          onEdit={() => onEdit({ kind: 'identity', key: 'model' })}
        />
      )}
    </Section>
  );
}

function FieldsSection({
  bucketKey,
  bucket,
  onEdit,
}: {
  bucketKey: FieldBucket;
  bucket: Record<string, ReviewedField>;
  onEdit: (target: EditTarget) => void;
}) {
  return (
    <Section title={BUCKET_LABELS[bucketKey] ?? bucketKey}>
      {Object.entries(bucket).map(([k, field]) => (
        <FieldRow
          key={k}
          fieldKey={k}
          field={field}
          onEdit={() => onEdit({ kind: 'bucket', bucket: bucketKey, key: k })}
        />
      ))}
    </Section>
  );
}

function WarningsSection({ warnings }: { warnings: string[] }) {
  return (
    <Section title="⚠️ تنبيهات">
      {warnings.map((code, i) => (
        <Text key={i} style={s.warningText}>• {translateWarning(code as any)}</Text>
      ))}
    </Section>
  );
}

function EndpointHintsSection({ hints }: { hints: { path: string }[] }) {
  return (
    <Section title="🔗 مؤشرات الواجهات">
      <Text style={s.hintNote}>للاطلاع فقط — لا تُنفَّذ.</Text>
      {hints.map((h, i) => (
        <Text key={i} style={s.hintPath}>{h.path}</Text>
      ))}
    </Section>
  );
}

// ────────────── Edit Modal ──────────────

function EditModal({
  visible,
  title,
  value,
  onChangeValue,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  value: string;
  onChangeValue: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.modalCard}>
          <Text style={s.modalTitle}>{title}</Text>
          <TextInput
            style={s.modalInput}
            value={value}
            onChangeText={onChangeValue}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            placeholder="القيمة الجديدة"
            placeholderTextColor={C.muted}
            textAlign="right"
          />
          <View style={s.modalButtons}>
            <Pressable style={[s.btn, s.btnGhost]} onPress={onClose}>
              <Text style={[s.btnTxt, s.btnTxtGhost]}>إلغاء</Text>
            </Pressable>
            <Pressable style={[s.btn, s.btnPrimary]} onPress={onSave}>
              <Text style={[s.btnTxt, s.btnTxtPrimary]}>حفظ</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ────────────── Main ──────────────

export default function ScreenshotReviewScreen() {
  const nav = useRouter();
  const { state, actions } = useScreenshotFlow();
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [editValue, setEditValue] = useState('');

  function openEdit(target: EditTarget) {
    const reviewState = state.reviewState;
    if (!reviewState) return;
    let current = '';
    if (target.kind === 'identity') {
      current = reviewState.identity[target.key]?.currentValue ?? '';
    } else {
      current = reviewState[target.bucket][target.key]?.currentValue ?? '';
    }
    setEditValue(current);
    setEditing(target);
  }

  function closeEdit() {
    setEditing(null);
    setEditValue('');
  }

  function onSave() {
    if (!editing || !state.reviewState) return;
    const reviewState = state.reviewState;
    const result =
      editing.kind === 'identity'
        ? editReviewIdentity(reviewState, editing.key, editValue)
        : editReviewField(reviewState, editing.bucket, editing.key, editValue);
    if (result.ok) {
      actions.setReviewState(result.state);
      closeEdit();
    } else {
      Alert.alert('تعذّر التعديل', translateEditReason(result.reason));
    }
  }

  if (!state.host) {
    return (
      <View style={s.center}>
        <Text style={s.emptyText}>عنوان الراوتر مفقود.</Text>
        <Pressable style={[s.btn, s.btnPrimary]} onPress={() => nav.back()}>
          <Text style={[s.btnTxt, s.btnTxtPrimary]}>رجوع</Text>
        </Pressable>
      </View>
    );
  }

  if (!state.reviewState) {
    return (
      <View style={s.center}>
        <Text style={s.emptyText}>لا توجد بيانات للمراجعة.</Text>
        <Pressable style={[s.btn, s.btnPrimary]} onPress={() => nav.back()}>
          <Text style={[s.btnTxt, s.btnTxtPrimary]}>رجوع</Text>
        </Pressable>
      </View>
    );
  }

  const reviewState = state.reviewState;
  const showIdentity = shouldShowIdentity(reviewState.identity);
  const showSignal = shouldShowBucket(reviewState.signalFields);
  const showBand = shouldShowBucket(reviewState.bandFields);
  const showCell = shouldShowBucket(reviewState.cellFields);
  const showWarnings = reviewState.warnings.length > 0;
  const showHints = reviewState.endpointHints.length > 0;
  const allEmpty =
    !showIdentity && !showSignal && !showBand && !showCell && !showWarnings && !showHints;

  let modalTitle = '';
  if (editing) {
    if (editing.kind === 'identity') {
      modalTitle = editing.key === 'vendor' ? 'تعديل الشركة' : 'تعديل الموديل';
    } else {
      modalTitle = `تعديل ${editing.key}`;
    }
  }

  return (
    <>
      <ScrollView style={s.wrap} contentContainerStyle={s.content}>
        {allEmpty && (
          <View style={s.centerInline}>
            <Text style={s.emptyText}>لم نجد حقولًا قابلة للعرض.</Text>
          </View>
        )}

        {showIdentity && (
          <IdentitySection identity={reviewState.identity} onEdit={openEdit} />
        )}
        {showSignal && (
          <FieldsSection bucketKey="signalFields" bucket={reviewState.signalFields} onEdit={openEdit} />
        )}
        {showBand && (
          <FieldsSection bucketKey="bandFields" bucket={reviewState.bandFields} onEdit={openEdit} />
        )}
        {showCell && (
          <FieldsSection bucketKey="cellFields" bucket={reviewState.cellFields} onEdit={openEdit} />
        )}
        {showWarnings && <WarningsSection warnings={reviewState.warnings} />}
        {showHints && <EndpointHintsSection hints={reviewState.endpointHints} />}

        <View style={s.bottomBar}>
          <Pressable style={[s.btn, s.btnDisabled]} disabled>
            <Text style={[s.btnTxt, s.btnTxtDisabled]}>إضافة للتشخيص (قريبًا)</Text>
          </Pressable>
          <Pressable style={[s.btn, s.btnGhost]} onPress={() => nav.back()}>
            <Text style={[s.btnTxt, s.btnTxtGhost]}>رجوع</Text>
          </Pressable>
        </View>
      </ScrollView>

      <EditModal
        visible={editing !== null}
        title={modalTitle}
        value={editValue}
        onChangeValue={setEditValue}
        onSave={onSave}
        onClose={closeEdit}
      />
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: S.lg, gap: S.md, paddingBottom: 40 },
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: S.lg, gap: S.md, backgroundColor: C.bg,
  },
  centerInline: { alignItems: 'center', padding: S.md },
  emptyText: { color: C.sub, fontSize: T.body, textAlign: 'center' },
  sectionBody: { gap: S.xs },
  row: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: S.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.cardBorder,
  },
  rowLabel: { flexDirection: 'row-reverse', alignItems: 'center', gap: S.xs },
  rowValue: { flexDirection: 'row-reverse', alignItems: 'center', gap: S.xs },
  fieldLabel: { color: C.sub, fontSize: T.body },
  fieldValue: { color: C.text, fontSize: T.body, fontWeight: '600' },
  fieldUnit: { color: C.muted, fontSize: T.label },
  editedTag: { color: C.gold, fontSize: T.label },
  editBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.rowBg, marginLeft: S.xs,
  },
  editBtnTxt: { color: C.blue, fontSize: 16, fontWeight: '700' },
  warningText: { color: C.gold, fontSize: T.body, textAlign: 'right', lineHeight: 22 },
  hintNote: { color: C.muted, fontSize: T.label, textAlign: 'right', marginBottom: S.xs },
  hintPath: {
    color: C.text, fontSize: T.label, textAlign: 'left',
    paddingVertical: 2, fontWeight: '500',
  },
  bottomBar: { flexDirection: 'row-reverse', gap: S.sm, marginTop: S.lg },
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
  btnDisabled: { backgroundColor: C.rowBg, opacity: 0.7 },
  btnTxt: { fontSize: T.body, fontWeight: '600' },
  btnTxtPrimary: { color: '#fff' },
  btnTxtGhost: { color: C.text },
  btnTxtDisabled: { color: C.muted },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: S.lg,
  },
  modalCard: {
    backgroundColor: C.card, borderRadius: R.lg, padding: S.lg,
    width: '100%', maxWidth: 420, gap: S.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.cardBorder,
  },
  modalTitle: { color: C.text, fontSize: T.h1, fontWeight: '700', textAlign: 'right' },
  modalInput: {
    backgroundColor: C.rowBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.cardBorder,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    color: C.text,
    fontSize: T.body,
    minHeight: 48,
  },
  modalButtons: { flexDirection: 'row-reverse', gap: S.sm },
});
