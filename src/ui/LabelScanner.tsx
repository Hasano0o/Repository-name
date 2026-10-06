/**
 * ماسح ملصق الراوتر: يقرأ رمز QR للواي فاي تلقائياً، أو يصوّر الملصق ويقرأ النص.
 * لا تستورد هذا الملف مباشرة — استخدم LabelScannerHost من ./scanner (يتأكد إن الكاميرا موجودة).
 */
import { useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Icon } from './Icon';
import { C, tBg, tBd, tFg } from './theme';
import type { ScannerProps } from './scanner';
import { LabelData, labelCount, parseLabelText, parseWifiQr } from '../utils/routerLabel';
import { ocrAvailable, recognizeText } from '../../modules/bandly-cell/src';

type Field = { key: keyof Flat; label: string; secret?: boolean };
interface Flat { host: string; username: string; adminPassword: string; ssid: string; wifiPassword: string }

const FULL: Field[] = [
  { key: 'host', label: 'عنوان الراوتر' },
  { key: 'username', label: 'اسم المستخدم' },
  { key: 'adminPassword', label: 'كلمة مرور الإدارة', secret: true },
  { key: 'ssid', label: 'اسم الواي فاي' },
  { key: 'wifiPassword', label: 'كلمة سر الواي فاي', secret: true },
];
const WIFI_ONLY = FULL.slice(3);

const toFlat = (d: LabelData): Flat => ({
  host: d.host ?? '', username: d.username ?? '', adminPassword: d.adminPassword ?? '',
  ssid: d.wifi?.ssid ?? '', wifiPassword: d.wifi?.password ?? '',
});

export function LabelScanner({ mode = 'full', onClose, onResult }: ScannerProps) {
  const insets = useSafeAreaInsets();
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [review, setReview] = useState<Flat | null>(null);
  const [source, setSource] = useState<'qr' | 'text'>('qr');
  const lock = useRef(false);
  const canOcr = ocrAvailable();
  const fields = mode === 'wifi' ? WIFI_ONLY : FULL;

  const onQr = ({ data }: { data: string }) => {
    if (lock.current || review) return;
    const w = parseWifiQr(data);
    if (!w) { setNote('هذا الرمز مو للواي فاي — جرّب «اقرأ النص»'); return; }
    lock.current = true;
    setSource('qr');
    setReview(toFlat({ wifi: w }));
  };

  const readText = async () => {
    if (!cam.current || busy) return;
    lock.current = true;
    setNote('');
    try {
      setBusy('نصوّر الملصق...');
      const pic = await cam.current.takePictureAsync({ quality: 0.85, skipProcessing: false });
      if (!pic?.uri) throw new Error('ما قدرنا نصوّر');
      setBusy('نقرأ النص...');
      const { lines } = await recognizeText(pic.uri);
      const d = parseLabelText(lines);
      if (labelCount(d) === 0) {
        setNote('ما قدرنا نقرأ شي واضح — قرّب الكاميرا من الملصق وخل الإضاءة زينة');
        lock.current = false;
        return;
      }
      setSource('text');
      setReview(toFlat(d));
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      setNote(/download|model|waiting/i.test(msg)
        ? 'نجهّز أداة القراءة أول مرة — تأكد إن النت شغّال وجرّب بعد دقيقة'
        : 'تعذّرت القراءة — جرّب مرة ثانية أو اكتب البيانات بنفسك');
      lock.current = false;
    } finally {
      setBusy('');
    }
  };

  const again = () => { setReview(null); setNote(''); lock.current = false; };

  const use = () => {
    if (!review) return;
    const t = (v: string) => v.trim() || undefined;
    onResult({
      host: mode === 'full' ? t(review.host) : undefined,
      username: mode === 'full' ? t(review.username) : undefined,
      adminPassword: mode === 'full' ? t(review.adminPassword) : undefined,
      wifi: review.ssid.trim() ? { ssid: review.ssid.trim(), password: review.wifiPassword.trim() } : undefined,
    });
    onClose();
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.top}>
          <Pressable onPress={onClose} hitSlop={10} style={s.close}>
            <Text style={s.closeTxt}>✕</Text>
          </Pressable>
          <Text style={s.title}>{review ? 'راجع البيانات' : 'امسح ملصق الراوتر'}</Text>
          <View style={{ width: 36 }} />
        </View>

        {review ? (
          <ScrollView contentContainerStyle={[s.review, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
            <Text style={s.reviewHint}>
              {source === 'qr'
                ? 'قرأنا رمز الواي فاي ✓'
                : 'قرأنا الملصق — تأكد من كل حرف، القراءة ممكن تخلط بين 0 و O أو 1 و l'}
            </Text>
            {fields.map(f => (
              <View key={f.key} style={s.field}>
                <Text style={s.label}>{f.label}</Text>
                <TextInput
                  value={review[f.key]}
                  onChangeText={v => setReview(r => (r ? { ...r, [f.key]: v } : r))}
                  placeholder="ما انقرأ — اكتبه لو تعرفه"
                  placeholderTextColor={C.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[s.input, !review[f.key] && s.inputEmpty]}
                />
              </View>
            ))}
            <Pressable onPress={use} style={({ pressed }) => [s.useBtn, pressed && { opacity: 0.85 }]}>
              <Text style={s.useTxt}>✓ استخدمها</Text>
            </Pressable>
            <Pressable onPress={again} style={s.againBtn}>
              <Text style={s.againTxt}>امسح مرة ثانية</Text>
            </Pressable>
          </ScrollView>
        ) : !perm ? (
          <View style={s.center}><ActivityIndicator color={tFg('#fff')} /></View>
        ) : !perm.granted ? (
          <View style={s.center}>
            <Text style={s.permTxt}>نحتاج الكاميرا عشان نقرأ الملصق. الصورة ما تطلع من جوالك.</Text>
            <Pressable onPress={requestPerm} style={s.useBtn}>
              <Text style={s.useTxt}>اسمح بالكاميرا</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <CameraView
              ref={cam}
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={review ? undefined : onQr}
            />
            <View style={s.frame} pointerEvents="none" />
            <View style={[s.bottom, { paddingBottom: insets.bottom + 18 }]}>
              <Text style={s.tip}>
                {note || (canOcr
                  ? 'لو فيه رمز QR يقراه لحاله. لو ما فيه، وجّه الكاميرا على الكتابة واضغط «اقرأ النص»'
                  : 'وجّه الكاميرا على رمز QR اللي على الملصق')}
              </Text>
              {canOcr && (
                <Pressable onPress={readText} disabled={!!busy} style={({ pressed }) => [s.shot, (pressed || !!busy) && { opacity: 0.8 }]}>
                  {busy ? (
                    <View style={s.row}>
                      <ActivityIndicator color={tFg('#fff')} />
                      <Text style={s.shotTxt}>{busy}</Text>
                    </View>
                  ) : (
                    <View style={s.row}>
                      <Text style={s.shotTxt}>اقرأ النص</Text>
                      <Icon name="camera" size={18} color={tFg('#fff')} />
                    </View>
                  )}
                </Pressable>
              )}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1020' },
  top: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  closeTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  title: { color: '#fff', fontSize: 16, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  permTxt: { color: '#fff', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  frame: {
    position: 'absolute', left: '10%', right: '10%', top: '18%', height: '38%',
    borderRadius: 20, borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.85)',
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 18, gap: 12, backgroundColor: 'rgba(11,16,32,0.72)' },
  tip: { color: '#fff', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  shot: { backgroundColor: '#2f6bff', borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  shotTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },

  review: { padding: 16, gap: 12, backgroundColor: C.bg, flexGrow: 1 },
  reviewHint: { color: C.sub, fontSize: 12.5, textAlign: 'right', lineHeight: 20 },
  field: { gap: 6 },
  label: { color: C.text, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  input: {
    backgroundColor: C.card, borderWidth: 1.5, borderColor: tBd('#d8e0eb'), borderRadius: 14,
    paddingHorizontal: 12, minHeight: 48, color: C.text, fontSize: 15, fontWeight: '700',
    textAlign: 'left', writingDirection: 'ltr',
  },
  inputEmpty: { borderStyle: 'dashed', backgroundColor: tBg('#f6f8fb') },
  useBtn: { backgroundColor: '#2f6bff', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center', marginTop: 6 },
  useTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  againBtn: { alignItems: 'center', paddingVertical: 10 },
  againTxt: { color: C.sub, fontSize: 13.5, fontWeight: '700' },
});
