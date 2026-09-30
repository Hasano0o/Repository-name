/**
 * واجهة المكالمة: زر الاتصال · شاشة المكالمة الواردة · شريط المكالمة العائم.
 * نفس الشكل عند العميل (مساعد التوجيه) وعند الفني (وضع الفني).
 */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, IconName } from './Icon';
import { P } from './Pro';
import { CallInfo } from '../services/call';

import { tBd, tBg, tFg } from './theme';
const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** زر كبير: «اتصل بالفني» / «اتصل بالعميل» */
export function CallButton({ label, onPress, disabled, hint }: {
  label: string; onPress: () => void; disabled?: boolean; hint?: string;
}) {
  return (
    <View style={{ marginTop: 12 }}>
      <Pressable onPress={onPress} disabled={disabled}
        style={({ pressed }) => [{ borderRadius: 18, overflow: 'hidden' }, pressed && { opacity: 0.88 }, disabled && { opacity: 0.45 }]}>
        <LinearGradient colors={[tBg('#12b76a'), tBg('#0ea5a0')]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={c.big}>
          <View style={c.bigIc}><Icon name="call" size={20} color={tFg('#fff')} stroke={2.2} /></View>
          <Text style={c.bigTxt}>{label}</Text>
        </LinearGradient>
      </Pressable>
      {!!hint && <Text style={c.hint}>{hint}</Text>}
    </View>
  );
}

function Round({ icon, onPress, bg, fg = '#fff', label, size = 58 }: {
  icon: IconName; onPress: () => void; bg: string; fg?: string; label?: string; size?: number;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Pressable onPress={onPress} hitSlop={6}
        style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, pressed && { transform: [{ scale: 0.94 }] }]}>
        <Icon name={icon} size={size * 0.42} color={fg} stroke={2.2} />
      </Pressable>
      {!!label && <Text style={c.roundLbl}>{label}</Text>}
    </View>
  );
}

/** شاشة «فلان يتصل…» */
export function IncomingCall({ info, onAccept, onReject }: { info: CallInfo; onAccept: () => void; onReject: () => void }) {
  return (
    <Modal visible={info.state === 'incoming'} transparent animationType="fade" statusBarTranslucent>
      <View style={c.dim}>
        <LinearGradient colors={[tBg('#1d3fc4'), tBg('#6a45ec')]} style={c.inBox}>
          <View style={c.avatar}><Icon name="call" size={34} color={tFg('#fff')} stroke={2} /></View>
          <Text style={c.inName}>{info.peer}</Text>
          <Text style={c.inSub}>يتصل بك الحين… 📞</Text>
          <View style={c.inBtns}>
            <Round icon="hangup" bg="#ff5a5f" onPress={onReject} label="رفض" size={66} />
            <Round icon="call" bg="#16c784" onPress={onAccept} label="رد" size={66} />
          </View>
        </LinearGradient>
      </View>
    </Modal>
  );
}

/** شريط المكالمة العائم (يطلع أثناء الاتصال والمكالمة) */
export function CallBar({ info, top, onHangup, onMute, onSpeaker, onCam, camOn }: {
  info: CallInfo; top: number; onHangup: () => void; onMute: () => void; onSpeaker: () => void;
  onCam?: () => void; camOn?: boolean;   // زر الكاميرا: العميل يشغّلها، والفني يطلبها
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (info.state !== 'active') return;
    const t = setInterval(() => tick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [info.state]);
  if (info.state !== 'outgoing' && info.state !== 'connecting' && info.state !== 'active') return null;
  const status = info.state === 'outgoing' ? 'يرن…' : info.state === 'connecting' ? 'نوصل الصوت…' : mmss(Date.now() - (info.startedAt ?? Date.now()));
  return (
    <View style={[c.barWrap, { top }]} pointerEvents="box-none">
      <View style={c.bar}>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
            <View style={[c.live, info.state === 'active' ? { backgroundColor: tBg('#16c784') } : { backgroundColor: tBg('#ffb020') }]} />
            <Text style={c.barName} numberOfLines={1}>{info.peer}</Text>
          </View>
          <Text style={c.barStatus}>{status}</Text>
        </View>
        {!!onCam && info.state === 'active' && (
          <Round icon={camOn ? 'video' : 'video-off'} size={44} bg={camOn ? '#fff' : 'rgba(255,255,255,0.16)'}
            fg={camOn ? P.text : '#fff'} onPress={onCam} />
        )}
        <Round icon={info.muted ? 'mic-off' : 'mic'} size={44} bg={info.muted ? '#fff' : 'rgba(255,255,255,0.16)'}
          fg={info.muted ? P.text : '#fff'} onPress={onMute} />
        <Round icon={info.speaker ? 'speaker' : 'earpiece'} size={44} bg={info.speaker ? '#fff' : 'rgba(255,255,255,0.16)'}
          fg={info.speaker ? P.text : '#fff'} onPress={onSpeaker} />
        <Round icon="hangup" size={44} bg="#ff5a5f" onPress={onHangup} />
      </View>
    </View>
  );
}

/** تنبيه قصير بسبب انتهاء المكالمة */
export function CallEnded({ info }: { info: CallInfo }) {
  const [show, setShow] = useState<string | undefined>();
  useEffect(() => {
    if (info.state === 'idle' && info.ended) {
      setShow(info.ended);
      const t = setTimeout(() => setShow(undefined), 3500);
      return () => clearTimeout(t);
    }
  }, [info.state, info.ended]);
  if (!show) return null;
  return <View style={c.endPill}><Text style={c.endTxt}>📞 {show}</Text></View>;
}

const c = StyleSheet.create({
  big: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15 },
  bigIc: { width: 34, height: 34, borderRadius: 17, backgroundColor: tBg('rgba(255,255,255,0.22)'), alignItems: 'center', justifyContent: 'center' },
  bigTxt: { color: tFg('#fff'), fontSize: 16, fontWeight: '800' },
  hint: { color: P.sub, fontSize: 11.5, textAlign: 'center', marginTop: 6 },
  roundLbl: { color: tFg('#fff'), fontSize: 13, fontWeight: '800' },

  dim: { flex: 1, backgroundColor: tBg('rgba(8,15,40,0.55)'), justifyContent: 'center', padding: 24 },
  inBox: { borderRadius: 30, paddingVertical: 34, paddingHorizontal: 20, alignItems: 'center' },
  avatar: { width: 86, height: 86, borderRadius: 43, backgroundColor: tBg('rgba(255,255,255,0.18)'), alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: tBd('rgba(255,255,255,0.35)') },
  inName: { color: tFg('#fff'), fontSize: 24, fontWeight: '800', marginTop: 14 },
  inSub: { color: tFg('rgba(255,255,255,0.85)'), fontSize: 14, marginTop: 4 },
  inBtns: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch', marginTop: 30 },

  barWrap: { position: 'absolute', left: 12, right: 12, zIndex: 60 },
  bar: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: tBg('#0f1f45'), borderRadius: 24,
    paddingVertical: 10, paddingHorizontal: 12,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 12,
  },
  live: { width: 9, height: 9, borderRadius: 5 },
  barName: { color: tFg('#fff'), fontSize: 14.5, fontWeight: '800', flexShrink: 1 },
  barStatus: { color: tFg('rgba(255,255,255,0.75)'), fontSize: 12.5, fontWeight: '700', marginTop: 1 },

  endPill: { alignSelf: 'center', backgroundColor: tBg('#0f1f45'), borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginTop: 8 },
  endTxt: { color: tFg('#fff'), fontSize: 12.5, fontWeight: '700' },
});
