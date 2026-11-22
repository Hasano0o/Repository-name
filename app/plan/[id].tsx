/**
 * «باقتي» (٢٢ نوفمبر — اقتراح عضو): البطاقة الكاملة انتقلت من صفحة الراوتر لـ«كل المزايا» ← الأجهزة والباقة.
 * صفحة الراوتر صار فيها سطر الاستهلاك بس (PlanUsageStrip).
 */
import { ScrollView } from '../../src/i18n/rn';
import { useLocalSearchParams } from 'expo-router';
import { C, S } from '../../src/ui/theme';
import { ManualPlanCard } from '../../src/ui/ManualPlanCard';

export default function Plan() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {!!id && <ManualPlanCard routerId={String(id)} full />}
    </ScrollView>
  );
}
