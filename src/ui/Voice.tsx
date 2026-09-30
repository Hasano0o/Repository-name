/**
 * رسائل صوتية بين الفني والعميل — «اضغط مطوّل وتكلم» (مثل الواتساب/اللاسلكي)
 * التسجيل m4a (AAC) أحادي ويرفع للسيرفر، والطرف الثاني يشغّله تلقائياً.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Vibration, Alert, ActivityIndicator, Platform } from 'react-native';
import {
  useAudioRecorder, RecordingPresets, RecordingOptions, requestRecordingPermissionsAsync,
  setAudioModeAsync, createAudioPlayer, AudioPlayer,
} from 'expo-audio';
import { Icon } from './Icon';
import { P } from './Pro';

import { tBd, tBg, tFg } from './theme';
const PRESET: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 48000,
};
const MAX_SEC = 60;
const MIN_SEC = 0.6;

// ═══ تشغيل الرسائل الواردة بالدور ═══
const queue: string[] = [];
let current: AudioPlayer | null = null;

async function next() {
  if (current || !queue.length) return;
  const url = queue.shift()!;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, interruptionMode: 'duckOthers' });
  } catch {}
  try {
    const p = createAudioPlayer({ uri: url });
    current = p;
    const done = () => {
      try { sub.remove(); } catch {}
      try { p.remove(); } catch {}
      if (current === p) current = null;
      next();
    };
    const sub = p.addListener('playbackStatusUpdate', st => { if (st.didJustFinish) done(); });
    p.volume = 1;
    p.play();
    // حماية: لو ما وصل حدث النهاية
    setTimeout(() => { if (current === p) done(); }, (MAX_SEC + 30) * 1000);
  } catch {
    current = null;
    next();
  }
}

export function playVoice(url: string) {
  queue.push(url);
  next();
}

// ═══ زر اضغط وتكلم ═══
export function PushToTalk({ onSend, label = 'اضغط مطوّل وتكلّم', color = P.blue, disabled }: {
  onSend: (uri: string, dur: number) => Promise<void>;
  label?: string; color?: string; disabled?: boolean;
}) {
  const rec = useAudioRecorder(PRESET);
  const [state, setState] = useState<'idle' | 'rec' | 'send'>('idle');
  const [sec, setSec] = useState(0);
  const t0 = useRef(0);
  const starting = useRef<Promise<boolean> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const allowed = useRef<boolean | null>(null);
  const active = useRef(false);

  useEffect(() => () => { if (tick.current) clearInterval(tick.current); }, []);

  const begin = async (): Promise<boolean> => {
    if (allowed.current !== true) {
      const p = await requestRecordingPermissionsAsync();
      allowed.current = p.granted;
      if (!p.granted) {
        Alert.alert('الميكروفون مقفل', 'اسمح للتطبيق باستخدام الميكروفون من الإعدادات عشان ترسل رسائل صوتية.');
        return false;
      }
      // أول مرة: نافذة الإذن قطعت الضغطة — المستخدم يضغط مرة ثانية
      if (!active.current) return false;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await rec.prepareToRecordAsync();
      rec.record();
      t0.current = Date.now();
      setSec(0);
      setState('rec');
      Vibration.vibrate(Platform.OS === 'android' ? 30 : 10);
      tick.current = setInterval(() => {
        const s = (Date.now() - t0.current) / 1000;
        setSec(s);
        if (s >= MAX_SEC) finish();
      }, 200);
      return true;
    } catch (e: any) {
      Alert.alert('ما قدرنا نسجّل', String(e?.message ?? e));
      return false;
    }
  };

  const finish = async () => {
    active.current = false;
    const ok = await (starting.current ?? Promise.resolve(false));
    starting.current = null;
    if (tick.current) { clearInterval(tick.current); tick.current = null; }
    if (!ok) { setState('idle'); return; }
    const dur = (Date.now() - t0.current) / 1000;
    try { await rec.stop(); } catch {}
    try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch {}
    const uri = rec.uri;
    if (dur < MIN_SEC || !uri) { setState('idle'); return; }
    setState('send');
    try {
      await onSend(uri, Math.min(dur, MAX_SEC));
      Vibration.vibrate(Platform.OS === 'android' ? [0, 20, 60, 20] : 10);
    } catch (e: any) {
      Alert.alert('ما انرسل التسجيل', String(e?.message ?? e));
    } finally {
      setState('idle');
    }
  };

  const onIn = () => {
    if (disabled || state !== 'idle') return;
    active.current = true;
    starting.current = begin();
  };
  const onOut = () => { if (state !== 'send') finish(); };

  const recOn = state === 'rec';
  return (
    <Pressable onPressIn={onIn} onPressOut={onOut} disabled={disabled || state === 'send'}
      style={[v.btn, { borderColor: color + '55', backgroundColor: color + '12' }, recOn && { backgroundColor: tBg('#ff5a5f'), borderColor: tBd('#ff5a5f') }, disabled && { opacity: 0.5 }]}>
      {state === 'send' ? (
        <>
          <ActivityIndicator size="small" color={color} />
          <Text style={[v.txt, { color }]}>نرسل التسجيل…</Text>
        </>
      ) : recOn ? (
        <>
          <View style={v.recDot} />
          <Text style={[v.txt, { color: tFg('#fff') }]}>يسجّل… {Math.floor(sec)}ث — اترك الزر للإرسال</Text>
        </>
      ) : (
        <>
          <View style={[v.mic, { backgroundColor: color }]}>
            <Icon name="mic" size={16} color={tFg('#fff')} stroke={2.2} />
          </View>
          <Text style={[v.txt, { color }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

// ═══ آخر رسالة صوتية وصلت ═══
export function VoiceNote({ from, dur, onReplay }: { from: string; dur: number; onReplay: () => void }) {
  return (
    <Pressable onPress={onReplay} style={v.note}>
      <View style={[v.mic, { backgroundColor: P.green }]}>
        <Icon name="sound" size={15} color={tFg('#fff')} stroke={2.2} />
      </View>
      <Text style={v.noteTxt} numberOfLines={1}>رسالة صوتية من {from}{dur ? ` · ${Math.round(dur)}ث` : ''}</Text>
      <Text style={v.noteReplay}>إعادة ↻</Text>
    </Pressable>
  );
}

const v = StyleSheet.create({
  btn: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderRadius: 18, borderWidth: 1.5, paddingVertical: 14, paddingHorizontal: 14, marginTop: 12,
  },
  mic: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: tBg('#fff') },
  txt: { fontSize: 14, fontWeight: '800' },
  note: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10,
    backgroundColor: P.greenSoft, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 10,
  },
  noteTxt: { flex: 1, color: tFg('#0b7a47'), fontSize: 13, fontWeight: '700', textAlign: 'right' },
  noteReplay: { color: tFg('#0b7a47'), fontSize: 12, fontWeight: '800' },
});
