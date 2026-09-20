import { useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, PanResponder } from 'react-native';
import { ConnectedDevice } from '../drivers/types';
import { C } from './theme';

const ACTION_W = 176;

export function deviceIcon(name = ''): string {
  const n = name.toLowerCase();
  if (/(playstation|ps4|ps5|xbox|nintendo)/.test(n)) return '🎮';
  if (/(\btv\b|bravia|roku|chromecast|firestick|shield|hisense|tcl)/.test(n)) return '📺';
  if (/(laptop|macbook|desktop|\bpc\b|windows|lenovo|dell|thinkpad|surface|asus|acer)/.test(n)) return '💻';
  if (/(iphone|ipad|redmi|xiaomi|poco|galaxy|samsung|sm-|huawei|honor|oppo|vivo|realme|pixel|oneplus|infinix|tecno|nokia|android|phone)/.test(n)) return '📱';
  if (/(^re\d|repeater|extender|mesh|router|tp-?link|deco)/.test(n)) return '📶';
  if (/(printer|epson|canon|brother)/.test(n)) return '🖨️';
  if (/(cam|ezviz|imou|dahua|hikvision)/.test(n)) return '📷';
  return '🔌';
}

export function DeviceRow({ device, onBlock, onLimit }: {
  device: ConnectedDevice; onBlock: () => void; onLimit: () => void;
}) {
  const tx = useRef(new Animated.Value(0)).current;
  const open = useRef(false);

  const snap = (to: number) => {
    open.current = to !== 0;
    Animated.spring(tx, { toValue: to, useNativeDriver: true, bounciness: 4 }).start();
  };

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderMove: (_, g) => {
      const base = open.current ? ACTION_W : 0;
      tx.setValue(Math.max(0, Math.min(ACTION_W, base + g.dx)));
    },
    onPanResponderRelease: (_, g) => {
      const base = open.current ? ACTION_W : 0;
      snap(base + g.dx > ACTION_W / 2 ? ACTION_W : 0);
    },
    onPanResponderTerminate: () => snap(open.current ? ACTION_W : 0),
  })).current;

  return (
    <View style={s.wrap}>
      <View style={s.actions}>
        <Pressable style={[s.action, { backgroundColor: C.blueSoft }]} onPress={() => { snap(0); onLimit(); }}>
          <Text style={[s.actionText, { color: C.blue }]}>تحديد السرعة</Text>
        </Pressable>
        <Pressable style={[s.action, { backgroundColor: C.redSoft }]} onPress={() => { snap(0); onBlock(); }}>
          <Text style={[s.actionText, { color: C.red }]}>حظر</Text>
        </Pressable>
      </View>
      <Animated.View style={[s.row, { transform: [{ translateX: tx }] }]} {...pan.panHandlers}>
        <View style={s.info}>
          <Text style={s.name} numberOfLines={1}>{device.name || 'جهاز غير معروف'}</Text>
          <Text style={s.ip}>{device.ip || device.mac}</Text>
        </View>
        <View style={s.iconWrap}>
          <Text style={s.icon}>{deviceIcon(device.name)}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { borderRadius: 14, overflow: 'hidden' },
  actions: { position: 'absolute', left: 0, top: 0, bottom: 0, width: ACTION_W, flexDirection: 'row', gap: 6, padding: 6 },
  action: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontWeight: '700', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.rowBg, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder },
  info: { flex: 1 },
  name: { color: C.text, fontWeight: '700', fontSize: 15, textAlign: 'right' },
  ip: { color: C.sub, fontSize: 12, textAlign: 'right', marginTop: 2 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 22 },
});
