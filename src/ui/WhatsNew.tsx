/**
 * «وش الجديد» — بطاقة تطلع مرة وحدة بعد كل نشرة فيها مزايا جديدة.
 * لنشرة جديدة: غيّر WN_ID والعناصر. اللي ثبّت التطبيق لأول مرة ما تطلع له (يشوف كل شي جديد أصلاً).
 */
import { useEffect, useState } from 'react';
import { Modal, } from 'react-native';
import { Pressable, Text, View } from '../i18n/rn';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Href } from 'expo-router';
import { listRouters } from '../store/routers';
import { DEMO_DRIVER_ID } from '../drivers/demo';
import { Icon, IconName } from './Icon';
import { FONT } from './fonts';
import { C, tBg, tFg } from './theme';

import { sheet } from '../i18n';
const WN_ID = '2026-10-11';
const KEY = 'bandly.whatsnew';
const FIRST_KEY = 'bandly.firstSeen';

interface Item { icon: IconName; colors: [string, string]; title: string; text: string; go: (rid: string | null) => string | null }

const ITEMS: Item[] = [
  {
    icon: 'settings', colors: ['#6366f1', '#3b2f8f'], title: 'مركز التحكم',
    text: 'وضع الألعاب، شبكة الضيوف، أوقات النت للعيال، وحجب المواقع — من مكان واحد.',
    go: rid => (rid ? `/control/${rid}` : null),
  },
  {
    icon: 'wifi', colors: ['#38bdf8', '#2563eb'], title: 'قناة الواي فاي',
    text: 'يجرّب القنوات ويثبّت الأنظف — بنق أثبت وتقطيع أقل داخل البيت.',
    go: rid => (rid ? `/wifich/${rid}` : null),
  },
  {
    icon: 'user', colors: ['#fb923c', '#ea580c'], title: 'فنيين قريبين منك',
    text: 'فنيين أنتينا في مدينتك — ويقدرون يساعدونك عن بُعد: يشوفون إشارتك مباشرة ويوجّهونك.',
    go: () => '/techs',
  },
];

export function WhatsNew() {
  const [show, setShow] = useState(false);
  const [rid, setRid] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(KEY);
        const first = await AsyncStorage.getItem(FIRST_KEY);
        const rs = await listRouters().catch(() => []);
        if (!first) {
          await AsyncStorage.setItem(FIRST_KEY, WN_ID);
          // مستخدم جديد تماماً (ما عنده راوترات ولا استخدم التطبيق قبل): ما نزعجه
          const old = rs.length > 0 || !!(await AsyncStorage.getItem('bandly.stats.lastDay'));
          if (!old) { await AsyncStorage.setItem(KEY, WN_ID); return; }
        }
        if (seen === WN_ID) return;
        const real = rs.find(r => r.driverId !== DEMO_DRIVER_ID && ['huawei-lte', 'zte'].includes(r.driverId));
        setRid(real?.id ?? rs.find(r => r.driverId === DEMO_DRIVER_ID)?.id ?? null);
        setShow(true);
      } catch {}
    })();
  }, []);

  const close = () => {
    setShow(false);
    AsyncStorage.setItem(KEY, WN_ID).catch(() => {});
  };

  return (
    <Modal visible={show} transparent animationType="fade" onRequestClose={close}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <LinearGradient colors={['#1d2b64', '#3b2f8f']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.head}>
            <View style={s.ring} />
            <Text style={s.kicker}>تحديث جديد ✨</Text>
            <Text style={s.title}>وش الجديد في Bandly</Text>
          </LinearGradient>
          <View style={s.body}>
            {ITEMS.map(it => {
              const to = it.go(rid);
              return (
                <Pressable key={it.title} disabled={!to} onPress={() => { close(); if (to) router.push(to as Href); }}
                  style={({ pressed }) => [s.item, pressed && { opacity: 0.8 }]}>
                  <LinearGradient colors={it.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.icon}>
                    <Icon name={it.icon} size={20} color="#fff" stroke={2.2} />
                  </LinearGradient>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.itTitle}>{it.title}</Text>
                    <Text style={s.itText}>{it.text}</Text>
                  </View>
                  {!!to && <Text style={s.try}>جرّب</Text>}
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={close} style={({ pressed }) => [s.ok, pressed && { opacity: 0.85 }]}>
            <Text style={s.okTxt}>تمام</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = sheet({
  backdrop: { flex: 1, backgroundColor: 'rgba(8,12,30,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 440, backgroundColor: C.card, borderRadius: 28, overflow: 'hidden' },
  head: { padding: 22, paddingBottom: 20, gap: 4, overflow: 'hidden' },
  ring: { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 22, borderColor: 'rgba(255,255,255,0.07)', left: -50, top: -60 },
  kicker: { fontFamily: FONT.medium, color: '#c7d2fe', fontSize: 13, textAlign: 'right' },
  title: { fontFamily: FONT.bold, color: '#ffffff', fontSize: 22, textAlign: 'right' },
  body: { padding: 14, gap: 8 },
  item: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, padding: 10, borderRadius: 18, backgroundColor: C.rowBg },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  itTitle: { fontFamily: FONT.bold, color: C.text, fontSize: 15, textAlign: 'right' },
  itText: { fontFamily: FONT.regular, color: '#6b7796', fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  try: { fontFamily: FONT.bold, color: tFg('#2563eb'), fontSize: 12.5, backgroundColor: tBg('#e8efff'), paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden' },
  ok: { margin: 14, marginTop: 4, backgroundColor: tBg('#2f6bff'), borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  okTxt: { fontFamily: FONT.bold, color: tFg('#ffffff'), fontSize: 16 },
});
