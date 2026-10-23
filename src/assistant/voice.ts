/**
 * صوت المساعد — على الجهاز نفسه:
 *  • السماع: expo-speech-recognition (محرّك الجوال: Siri على الآيفون، قوقل على الأندرويد)
 *  • الرد بالصوت: expo-speech
 *
 * ⚠️ المكتبتين أصليّتين (native) — تشتغل بس في النسخة المبنية بعدهم. النسخ القديمة تاخذ هالكود بالتحديث
 *    عن بُعد، فما نستورد المكتبات مباشرة (كانت بتطيّح التطبيق): نطلب الموديول «اختيارياً»، ولو مو موجود
 *    زر المايك ما يظهر وكل شي ثاني يشتغل.
 * • ما نسجّل ولا نحفظ الصوت — المحرك يرجّع نص بس، والنص ما يطلع من الجوال (الفهم محلي).
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type Sub = { remove(): void };
interface SRNative {
  start(o: Record<string, unknown>): void;
  stop(): void;
  abort(): void;
  requestPermissionsAsync(): Promise<{ granted: boolean; canAskAgain?: boolean }>;
  isRecognitionAvailable?(): boolean;
  addListener(event: string, fn: (e: any) => void): Sub;
}
interface TTSNative {
  speak(id: string, text: string, o: Record<string, unknown>): void;
  stop(): Promise<void> | void;
}

const SR = Platform.OS === 'web' ? null : requireOptionalNativeModule<SRNative>('ExpoSpeechRecognition');
const TTS = Platform.OS === 'web' ? null : requireOptionalNativeModule<TTSNative>('ExpoSpeech');

/** النسخة المثبتة فيها السماع؟ */
export function voiceAvailable(): boolean {
  if (!SR) return false;
  try { return SR.isRecognitionAvailable ? SR.isRecognitionAvailable() : true; } catch { return false; }
}

/** كلمات تساعد المحرك يلقط أوامر Bandly صح */
const HINTS = ['افحص إشارتي', 'أفضل تردد', 'أفضل برج', 'أقل بنق', 'اختبار السرعة', 'وجّه الأنتنا', 'أعد تشغيل الراوتر', 'الأبراج', 'الترددات', 'البنق', 'آي بي جديد', 'Bandly'];

export interface ListenHandlers {
  /** النص وهو يتكلم (مؤقت) */
  onPartial(text: string): void;
  /** الجملة النهائية */
  onFinal(text: string): void;
  /** خطأ بالعربي */
  onError(msg: string): void;
  /** خلص السماع (بأي سبب) */
  onEnd(): void;
}

const ERR: Record<string, string> = {
  'not-allowed': 'لازم تسمح للتطبيق بالمايك والتعرّف على الكلام من الإعدادات.',
  'service-not-allowed': 'التعرّف على الكلام مقفل في جوالك — شغّل Siri/الإملاء (آيفون) أو تطبيق Google (أندرويد).',
  'language-not-supported': 'جوالك ما يدعم التعرف على العربي — نزّل اللغة العربية للإملاء من الإعدادات.',
  'no-speech': 'ما سمعت شي — اضغط المايك وتكلم.',
  'speech-timeout': 'ما سمعت شي — اضغط المايك وتكلم.',
  'network': 'التعرف على الكلام يحتاج نت الحين — جرّب مرة ثانية.',
  'audio-capture': 'المايك مشغول (مكالمة؟) — جرّب بعدها.',
  'busy': 'المايك مشغول — جرّب بعد ثواني.',
  'interrupted': 'انقطع السماع (مكالمة أو Siri) — جرّب مرة ثانية.',
  'aborted': '',
};

let subs: Sub[] = [];
const clear = () => { subs.forEach(s => { try { s.remove(); } catch {} }); subs = []; };

/** يبدأ السماع — يرجع false لو ما بدأ (والسبب يوصل لـ onError) */
export async function startListening(h: ListenHandlers): Promise<boolean> {
  if (!SR) { h.onError('السماع يحتاج آخر نسخة من Bandly.'); return false; }
  stopSpeaking();
  try {
    const p = await SR.requestPermissionsAsync();
    if (!p.granted) { h.onError(ERR['not-allowed']); return false; }
  } catch (e: any) {
    h.onError(`ما قدرنا نطلب إذن المايك: ${String(e?.message ?? e).slice(0, 80)}`);
    return false;
  }
  clear();
  let final = false;
  subs.push(SR.addListener('result', (e: any) => {
    const t: string = e?.results?.[0]?.transcript ?? '';
    if (!t) return;
    if (e?.isFinal) {
      if (final) return;
      final = true;
      h.onFinal(t.trim());
    } else h.onPartial(t);
  }));
  subs.push(SR.addListener('error', (e: any) => {
    const code = String(e?.error ?? '');
    const msg = code in ERR ? ERR[code] : `ما قدرت أسمع: ${String(e?.message ?? code).slice(0, 80)}`;
    if (msg) h.onError(msg);
  }));
  subs.push(SR.addListener('end', () => { clear(); h.onEnd(); }));
  try {
    SR.start({
      lang: 'ar-SA',
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
      contextualStrings: HINTS,
      addsPunctuation: false,
      // ما نحفظ الصوت
      recordingOptions: { persist: false },
      iosTaskHint: 'search',
    });
    return true;
  } catch (e: any) {
    clear();
    h.onError(`ما قدرت أشغّل المايك: ${String(e?.message ?? e).slice(0, 80)}`);
    h.onEnd();
    return false;
  }
}

/** يوقف ويعطي النتيجة اللي سمعها لين الحين */
export function stopListening(): void {
  try { SR?.stop(); } catch {}
}
/** يوقف بدون نتيجة (طلع من الشاشة / وقف المساعد) */
export function abortListening(): void {
  try { SR?.abort(); } catch {}
  clear();
}

// ═══ الرد بالصوت ═══
let speakId = 0;
export function canSpeak(): boolean { return !!TTS; }
export function speak(text: string): void {
  if (!TTS || !text) return;
  // نقرأ أول جزء بس (السطور الأولى) — التفاصيل تبقى مكتوبة
  const short = text.split('\n').filter(Boolean).slice(0, 2).join('. ').replace(/[•⚠️✓🎮⭐📌]/g, '').slice(0, 220);
  try { TTS.speak(String(++speakId), short, { language: 'ar-SA', rate: 1.0 }); } catch {}
}
export function stopSpeaking(): void {
  try { void TTS?.stop(); } catch {}
}
