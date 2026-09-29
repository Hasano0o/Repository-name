import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Updates from 'expo-updates';
import { C } from './theme';

/**
 * تحديث عن بُعد — التطبيق ينزّل التحديث بالخلفية عند الفتح،
 * ولما يجهز يطلع شريط صغير «أعد التشغيل» بدل ما ينتظر المستخدم يقفل التطبيق.
 */
export function UpdateBanner() {
  const { isUpdatePending, isUpdateAvailable, isDownloading } = Updates.useUpdates();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;
    if (isUpdateAvailable && !isUpdatePending && !isDownloading) {
      Updates.fetchUpdateAsync().catch(() => {});
    }
  }, [isUpdateAvailable, isUpdatePending, isDownloading]);

  if (!Updates.isEnabled || !isUpdatePending || hidden) return null;

  return (
    <View style={s.wrap} pointerEvents="box-none">
      <View style={s.bar}>
        <Pressable onPress={() => setHidden(true)} hitSlop={10}>
          <Text style={s.later}>لاحقاً</Text>
        </Pressable>
        <Pressable style={s.btn} onPress={() => Updates.reloadAsync().catch(() => {})}>
          <Text style={s.btnText}>حدّث الحين</Text>
        </Pressable>
        <Text style={s.text} numberOfLines={2}>✨ فيه تحديث جديد لـ Bandly جاهز</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center', paddingHorizontal: 16 },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%',
    backgroundColor: C.text, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14,
    shadowColor: C.shadow, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  text: { flex: 1, color: '#fff', fontWeight: '700', fontSize: 13, textAlign: 'right' },
  btn: { backgroundColor: C.blue, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  later: { color: '#c9d4ee', fontSize: 12, fontWeight: '700' },
});
