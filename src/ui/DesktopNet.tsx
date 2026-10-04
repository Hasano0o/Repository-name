/**
 * نسخة الويندوز فقط: بطاقة حالة الشبكة في شاشة إضافة الراوتر —
 * تعبّي عنوان الراوتر تلقائياً، وتصلح الاتصال بضغطة لو اللابتوب ما أخذ عنوان.
 * في الجوال ما تظهر أبداً.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { desktop, NetDiag } from '../desktop/bridge';
import { Icon } from './Icon';
import { C, tBd, tBg, tFg } from './theme';

export const hasNetTools = !!desktop?.netDiag;

export function useDesktopNet() {
  const [diag, setDiag] = useState<NetDiag | null>(null);
  const [repairing, setRepairing] = useState(false);

  const refresh = useCallback(async (): Promise<NetDiag | null> => {
    if (!desktop?.netDiag) return null;
    try {
      const d = await desktop.netDiag();
      setDiag(d);
      return d;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /** يصلح ويرجّع الحالة الجديدة (null لو رفض المستخدم أو ما فيه أدوات) */
  const repair = useCallback(async (): Promise<NetDiag | null> => {
    if (!desktop?.netRepair) return null;
    setRepairing(true);
    try {
      const ok = await desktop.netRepair();
      if (!ok) {
        Alert.alert('ما تم الإصلاح', 'الإصلاح يحتاج موافقتك على نافذة الويندوز (نعم). جرّب مرة ثانية ووافق عليها.');
        return null;
      }
      const d = await refresh();
      if (d && !d.noAddress) {
        Alert.alert('تم ✓', `رجع الاتصال — عنوان الراوتر ${d.gateway}`);
      } else {
        Alert.alert(
          'لسه ما وصل عنوان',
          'الراوتر ما عطى اللابتوب عنوان. افصل الواي فاي ورجّع اتصل، أو أعد تشغيل الراوتر، وبعدها اضغط «فحص».',
          [
            { text: 'إعدادات الواي فاي', onPress: () => desktop?.openWifiSettings?.() },
            { text: 'حسناً', style: 'cancel' },
          ],
        );
      }
      return d;
    } finally {
      setRepairing(false);
    }
  }, [refresh]);

  return { diag, refresh, repair, repairing };
}

export function openWifiSettings() {
  desktop?.openWifiSettings?.();
}

/** الرسالة المناسبة لما ما نتعرف على الراوتر في الويندوز. ترجع true لو تعاملت مع الحالة. */
export async function explainDetectFailure(
  host: string,
  net: ReturnType<typeof useDesktopNet>,
  useHost: (h: string) => void,
): Promise<boolean> {
  if (!hasNetTools) return false;
  const d = await net.refresh();
  if (!d) return false;
  const on = d.ssid ? `«${d.ssid}»` : 'الشبكة';

  if (d.noAddress) {
    Alert.alert(
      'اللابتوب ما أخذ عنوان',
      `${d.ssid ? `متصل بـ ${on} بس` : 'اللابتوب'} ما وصله عنوان من الراوتر، عشان كذا ما نقدر نوصل له. نصلحها؟`,
      [
        { text: 'إصلاح الاتصال', onPress: async () => {
          const n = await net.repair();
          if (n?.gateway) useHost(n.gateway);
        } },
        { text: 'إلغاء', style: 'cancel' },
      ],
    );
    return true;
  }

  if (d.gateway && d.gateway !== host) {
    Alert.alert(
      'العنوان مختلف',
      `عنوان راوترك الحالي على ${on} هو ${d.gateway} — مو ${host}.`,
      [
        { text: `استخدم ${d.gateway}`, onPress: () => useHost(d.gateway!) },
        { text: 'إلغاء', style: 'cancel' },
      ],
    );
    return true;
  }

  const dup = d.duplicateSsid
    ? `\n\nانتبه: فيه أكثر من جهاز يبث نفس الاسم ${on}، والويندوز ممكن يتصل بالغلط. غيّر اسم واي فاي راوترك لاسم مميز.`
    : '';
  Alert.alert(
    'هذا مو راوتر مدعوم',
    `الجهاز اللي متصل فيه (${on}) ما فيه صفحة إدارة نقدر نتعامل معها. لو عندك أكثر من راوتر، اتصل بشبكة الراوتر الصحيح.${dup}`,
    [
      { text: 'إعدادات الواي فاي', onPress: openWifiSettings },
      { text: 'حسناً', style: 'cancel' },
    ],
  );
  return true;
}

export function DesktopNetCard({ net }: { net: ReturnType<typeof useDesktopNet> }) {
  const { diag, repairing, repair, refresh } = net;
  if (!hasNetTools || !diag) return null;

  const bad = diag.noAddress;
  const where = diag.ssid ? `«${diag.ssid}»` : diag.wired ? 'الشبكة السلكية' : null;

  return (
    <View style={[s.card, bad ? s.cardBad : s.cardOk]}>
      <View style={s.row}>
        <View style={[s.dot, { backgroundColor: bad ? '#f79009' : '#12b76a' }]}>
          <Icon name="wifi" size={15} color="#fff" />
        </View>
        <View style={s.textCol}>
          {bad ? (
            <>
              <Text style={s.title}>{where ? `متصل بـ ${where} بدون عنوان` : 'اللابتوب مو متصل بأي شبكة'}</Text>
              <Text style={s.sub}>{where ? 'الراوتر ما عطى اللابتوب عنوان — نقدر نصلحها' : 'اتصل بواي فاي الراوتر أول'}</Text>
            </>
          ) : (
            <>
              <Text style={s.title}>{where ? `متصل بـ ${where}` : 'متصل بالشبكة'}</Text>
              <Text style={s.sub}>عنوان الراوتر <Text style={s.ip}>{diag.gateway}</Text></Text>
            </>
          )}
          {!bad && diag.duplicateSsid && (
            <Text style={s.warn}>فيه أكثر من جهاز بنفس اسم الشبكة — لو ما اتصل، غيّر اسم واي فاي راوترك</Text>
          )}
        </View>
      </View>

      <View style={s.btns}>
        {bad && where && (
          <Pressable onPress={repair} disabled={repairing} style={({ pressed }) => [s.btn, s.btnMain, pressed && s.pressed]}>
            {repairing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.btnMainText}>إصلاح الاتصال</Text>}
          </Pressable>
        )}
        {(bad || diag.duplicateSsid) && (
          <Pressable onPress={openWifiSettings} style={({ pressed }) => [s.btn, pressed && s.pressed]}>
            <Text style={s.btnText}>إعدادات الواي فاي</Text>
          </Pressable>
        )}
        <Pressable onPress={() => refresh()} style={({ pressed }) => [s.btn, pressed && s.pressed]}>
          <Text style={s.btnText}>فحص</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 12, marginBottom: 14, gap: 10 },
  cardOk: { backgroundColor: tBg('#ecfdf3'), borderColor: tBd('#c6f0d8') },
  cardBad: { backgroundColor: tBg('#fff7ea'), borderColor: tBd('#fbdcae') },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  dot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  textCol: { flex: 1, alignItems: 'flex-end', gap: 2 },
  title: { color: C.text, fontSize: 13.5, fontWeight: '800', textAlign: 'right' },
  sub: { color: C.sub, fontSize: 12, fontWeight: '600', textAlign: 'right' },
  ip: { color: C.blue, fontWeight: '800' },
  warn: { color: tFg('#b54708'), fontSize: 11.5, fontWeight: '700', textAlign: 'right', marginTop: 2 },
  btns: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  btn: {
    borderRadius: 10, borderWidth: 1, borderColor: tBd('#d6e2ff'), backgroundColor: tBg('#ffffff'),
    paddingHorizontal: 12, paddingVertical: 6, minHeight: 30, justifyContent: 'center',
  },
  btnText: { color: C.blue, fontSize: 12, fontWeight: '800' },
  btnMain: { backgroundColor: '#f79009', borderColor: '#f79009' },
  btnMainText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
