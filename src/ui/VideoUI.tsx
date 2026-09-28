/**
 * الفيديو في المكالمة:
 *  - العميل: معاينة كاميرته (صغيرة تكبر بلمسة) + مؤشر الفني يطلع فوقها + قلب الكاميرا/إيقافها
 *  - العميل: طلب الفني لتشغيل الكاميرا (يوافق أو يرفض)
 *  - الفني: بث كاميرا العميل — يلمس الصورة فيطلع مؤشر عند العميل بنفس المكان، ويقدر يلقط صورة
 * الصورة بنسبة ٣:٤ عند الطرفين وبنفس القص (cover) عشان مكان المؤشر يطابق.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Image, Easing, Modal, useWindowDimensions, ActivityIndicator } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, IconName } from './Icon';
import { P } from './Pro';
import { CallInfo } from '../services/call';

/** دائرة نابضة مكان المؤشر */
function Ping({ x, y, w, h, color = '#ffd21f', label }: { x: number; y: number; w: number; h: number; color?: string; label?: string }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    a.setValue(0);
    const loop = Animated.loop(Animated.timing(a, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [x, y, a]);
  const S = 64;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x * w - S / 2, top: y * h - S / 2, width: S, height: S, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{
        position: 'absolute', width: S, height: S, borderRadius: S / 2, borderWidth: 4, borderColor: color,
        opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0] }),
        transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1.25] }) }],
      }} />
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 4, borderColor: color, backgroundColor: 'rgba(0,0,0,0.25)' }} />
      {!!label && (
        <View style={v.pingLbl}><Text style={v.pingLblTxt}>{label}</Text></View>
      )}
    </View>
  );
}

function Mini({ icon, onPress, on, label }: { icon: IconName; onPress: () => void; on?: boolean; label?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [v.mini, on && { backgroundColor: '#fff' }, pressed && { opacity: 0.7 }]}>
      <Icon name={icon} size={17} color={on ? P.text : '#fff'} stroke={2.2} />
      {!!label && <Text style={[v.miniTxt, on && { color: P.text }]}>{label}</Text>}
    </Pressable>
  );
}

/** العميل: معاينة الكاميرا العائمة */
export function CamPreview({ info, top, onFlip, onStop }: { info: CallInfo; top: number; onFlip: () => void; onStop: () => void }) {
  const { width } = useWindowDimensions();
  const [big, setBig] = useState(false);
  const [pt, setPt] = useState<CallInfo['point']>();
  useEffect(() => {
    if (!info.point) return;
    setPt(info.point);
    setBig(true);  // نكبّر تلقائياً لما يأشر الفني
    const t = setTimeout(() => setPt(p => (p && p.at === info.point!.at ? undefined : p)), 4500);
    return () => clearTimeout(t);
  }, [info.point]);
  if (!info.cam || !info.localUrl) return null;
  const w = big ? width - 24 : Math.round(width * 0.4);
  const h = Math.round(w * 4 / 3);
  const mirror = info.facing === 'user';
  return (
    <View style={[v.float, { top, width: w }, big ? { left: 12 } : { right: 12 }]}>
      <Pressable onPress={() => setBig(b => !b)} style={{ width: w, height: h, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' }}>
        <RTCView streamURL={info.localUrl} objectFit="cover" mirror={mirror} style={{ width: w, height: h }} />
        {pt && <Ping x={mirror ? 1 - pt.x : pt.x} y={pt.y} w={w} h={h} label={big ? 'الفني يأشر هنا' : undefined} />}
        <View style={v.liveTag}><View style={v.recDot} /><Text style={v.liveTagTxt}>الفني يشوف</Text></View>
      </Pressable>
      <View style={v.ctrls}>
        <Mini icon="flip" onPress={onFlip} label={big ? 'قلب' : undefined} />
        <Mini icon={big ? 'down' : 'up'} onPress={() => setBig(b => !b)} label={big ? 'صغّر' : undefined} />
        <Mini icon="video-off" onPress={onStop} label={big ? 'إيقاف' : undefined} />
      </View>
    </View>
  );
}

/** العميل: الفني يطلب تشغيل الكاميرا */
export function CamRequest({ info, onAccept, onReject }: { info: CallInfo; onAccept: () => void; onReject: () => void }) {
  return (
    <Modal visible={!!info.camReq && !info.cam && info.state === 'active'} transparent animationType="fade" statusBarTranslucent>
      <View style={v.dim}>
        <View style={v.reqBox}>
          <View style={v.reqIc}><Icon name="video" size={30} color={P.blue} stroke={2} /></View>
          <Text style={v.reqTitle}>{info.peer} يبغى يشوف الكاميرا</Text>
          <Text style={v.reqSub}>وجّه الكاميرا الخلفية على الهوائي أو الراوتر عشان يوجّهك بدقة. تقدر توقفها أي وقت.</Text>
          <Pressable onPress={onAccept} style={{ alignSelf: 'stretch', marginTop: 16, borderRadius: 16, overflow: 'hidden' }}>
            <LinearGradient colors={['#2f6bff', '#6a45ec']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={v.reqOk}>
              <Icon name="video" size={18} color="#fff" stroke={2.2} />
              <Text style={v.reqOkTxt}>شغّل الكاميرا</Text>
            </LinearGradient>
          </Pressable>
          <Pressable onPress={onReject} style={v.reqNo}><Text style={v.reqNoTxt}>لا، بعدين</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** الفني: بث كاميرا العميل */
export function RemoteVideo({ info, onPoint, onFlip }: { info: CallInfo; onPoint: (x: number, y: number) => void; onFlip: () => void }) {
  const [w, setW] = useState(0);
  const [tap, setTap] = useState<{ x: number; y: number; at: number } | null>(null);
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const shotRef = useRef<View>(null);
  useEffect(() => {
    if (!tap) return;
    const t = setTimeout(() => setTap(p => (p && p.at === tap.at ? null : p)), 2500);
    return () => clearTimeout(t);
  }, [tap]);
  if (!info.peerCam || !info.remoteUrl) return null;
  const h = Math.round(w * 4 / 3);
  const snap = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const uri = await captureRef(shotRef, { format: 'jpg', quality: 0.9, handleGLSurfaceViewOnAndroid: true });
      setShots(s => [uri, ...s].slice(0, 8));
    } catch {} finally { setBusy(false); }
  };
  const share = (uri: string) => Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'صورة من كاميرا العميل' }).catch(() => {});
  return (
    <View style={v.card} onLayout={e => setW(e.nativeEvent.layout.width - 24)}>
      <View style={v.head}>
        <View style={v.recDot} />
        <Text style={v.title}>كاميرا العميل مباشرة</Text>
        <View style={{ flex: 1 }} />
        <Text style={v.hint}>المس الصورة عشان تأشر له</Text>
      </View>
      {w > 0 && (
        <Pressable
          onPress={e => {
            const { locationX, locationY } = e.nativeEvent;
            const x = Math.max(0, Math.min(1, locationX / w)), y = Math.max(0, Math.min(1, locationY / h));
            setTap({ x, y, at: Date.now() });
            onPoint(x, y);
          }}
          style={{ width: w, height: h, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000' }}>
          <View ref={shotRef} collapsable={false} style={{ width: w, height: h }}>
            <RTCView key={info.videoRev} streamURL={info.remoteUrl} objectFit="cover" style={{ width: w, height: h }} />
          </View>
          {tap && <Ping x={tap.x} y={tap.y} w={w} h={h} color="#ffd21f" />}
        </Pressable>
      )}
      <View style={v.row}>
        <Pressable onPress={onFlip} style={v.btn}><Icon name="flip" size={16} color={P.blue} stroke={2.2} /><Text style={v.btnTxt}>اقلب كاميرته</Text></Pressable>
        <Pressable onPress={snap} style={v.btn}>
          {busy ? <ActivityIndicator size="small" color={P.blue} /> : <Icon name="camera" size={16} color={P.blue} stroke={2.2} />}
          <Text style={v.btnTxt}>التقط صورة</Text>
        </Pressable>
      </View>
      {shots.length > 0 && (
        <View style={v.shots}>
          {shots.map(u => (
            <Pressable key={u} onPress={() => share(u)} style={v.shot}>
              <Image source={{ uri: u }} style={{ width: '100%', height: '100%' }} />
            </Pressable>
          ))}
          <Text style={v.shotHint}>المس الصورة عشان ترسلها</Text>
        </View>
      )}
    </View>
  );
}

const v = StyleSheet.create({
  float: { position: 'absolute', zIndex: 55, alignItems: 'center' },
  ctrls: { flexDirection: 'row-reverse', gap: 8, marginTop: 8, backgroundColor: '#0f1f45', borderRadius: 999, padding: 5 },
  mini: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, minWidth: 36, height: 36, borderRadius: 18, paddingHorizontal: 9, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  miniTxt: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  liveTag: { position: 'absolute', top: 8, right: 8, flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  liveTagTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff4d4f' },
  pingLbl: { position: 'absolute', top: 58, backgroundColor: '#ffd21f', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, minWidth: 110, alignItems: 'center' },
  pingLblTxt: { color: '#1b1b1b', fontSize: 12, fontWeight: '800' },

  dim: { flex: 1, backgroundColor: 'rgba(8,15,40,0.55)', justifyContent: 'center', padding: 24 },
  reqBox: { backgroundColor: P.card, borderRadius: 26, padding: 22, alignItems: 'center' },
  reqIc: { width: 64, height: 64, borderRadius: 32, backgroundColor: P.blueSoft, alignItems: 'center', justifyContent: 'center' },
  reqTitle: { color: P.text, fontSize: 18, fontWeight: '800', marginTop: 12, textAlign: 'center' },
  reqSub: { color: P.sub, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  reqOk: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  reqOkTxt: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  reqNo: { padding: 12, marginTop: 4 },
  reqNoTxt: { color: P.sub, fontSize: 14, fontWeight: '700' },

  card: { backgroundColor: P.card, borderRadius: 22, padding: 12, borderWidth: 1, borderColor: P.border },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 7, marginBottom: 10, paddingHorizontal: 2 },
  title: { color: P.text, fontSize: 15, fontWeight: '800' },
  hint: { color: P.sub, fontSize: 11.5, fontWeight: '700' },
  row: { flexDirection: 'row-reverse', gap: 8, marginTop: 10 },
  btn: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: P.blueSoft, borderRadius: 14, paddingVertical: 12 },
  btnTxt: { color: P.blue, fontSize: 13, fontWeight: '800' },
  shots: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 10, alignItems: 'center' },
  shot: { width: 54, height: 72, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000' },
  shotHint: { color: P.sub, fontSize: 11, fontWeight: '700' },
});
