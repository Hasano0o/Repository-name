/**
 * تخزين المساعد على الجهاز فقط (AsyncStorage) — ما يطلع شي للسيرفر:
 *  • هل المساعد ظاهر (مفتاح مخفي للتجربة — مقفّل افتراضياً عند كل المستخدمين)
 *  • حالته: شغّال / موقف مؤقتاً / موقف بالكامل
 *  • اسم المستخدم (لو وافق يحفظه)
 * منفصل تماماً عن بيانات الراوتر — حذف أي شي هنا ما يلمس الراوتر.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { AssistantState, DEFAULT_STATE, effectiveMode, parseState } from './core';

const K_UNLOCK = 'bandly.assistant.unlocked';
const K_STATE = 'bandly.assistant.state';
const K_NAME = 'bandly.assistant.name';
/** سألناه عن اسمه قبل؟ (عشان ما نعيد السؤال لو تخطاه) */
const K_ASKED = 'bandly.assistant.asked';

// ═══ المفتاح المخفي ═══
export async function isUnlocked(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(K_UNLOCK)) === '1'; } catch { return false; }
}
export async function setUnlocked(on: boolean): Promise<void> {
  try { on ? await AsyncStorage.setItem(K_UNLOCK, '1') : await AsyncStorage.removeItem(K_UNLOCK); } catch {}
}
/** للشاشات: يتحدّث كل ما ترجع للشاشة */
export function useAssistantUnlocked(): boolean {
  const [on, setOn] = useState(false);
  useFocusEffect(useCallback(() => {
    let alive = true;
    isUnlocked().then(v => { if (alive) setOn(v); });
    return () => { alive = false; };
  }, []));
  return on;
}

// ═══ الحالة ═══
export async function loadState(): Promise<AssistantState> {
  try { return parseState(await AsyncStorage.getItem(K_STATE)); } catch { return { ...DEFAULT_STATE }; }
}
/**
 * نحفظ قبل ما نرجع — لو الحفظ فشل نرمي الخطأ عشان الشاشة ما تقول «وقفناه» وهو ما انحفظ.
 * الإيقاف المؤقت اللي انتهى وقته ينحفظ «شغّال» عشان ما يبقى معلّق.
 */
export async function saveState(s: AssistantState): Promise<AssistantState> {
  const clean: AssistantState = effectiveMode(s) === 'enabled' && s.mode === 'paused' ? { ...DEFAULT_STATE } : s;
  await AsyncStorage.setItem(K_STATE, JSON.stringify(clean));
  return clean;
}

/** الحالة + تحديث تلقائي لما ينتهي الإيقاف المؤقت */
export function useAssistantState() {
  const [state, setState] = useState<AssistantState | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    loadState().then(s => { if (alive) setState(s); });
    return () => { alive = false; };
  }, []);

  // عدّاد خفيف بس وقت الإيقاف المؤقت المحدد بوقت — ما يشتغل غير والشاشة مفتوحة
  useEffect(() => {
    if (state?.mode !== 'paused' || state.pausedUntil === null) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [state]);

  const update = useCallback(async (s: AssistantState) => {
    const saved = await saveState(s);
    setState(saved);
    setNow(Date.now());
    return saved;
  }, []);

  return { state, mode: state ? effectiveMode(state, now) : null, now, update };
}

// ═══ الاسم ═══
export async function loadName(): Promise<{ name: string | null; asked: boolean }> {
  try {
    const [n, a] = await Promise.all([AsyncStorage.getItem(K_NAME), AsyncStorage.getItem(K_ASKED)]);
    return { name: n || null, asked: a === '1' || !!n };
  } catch {
    return { name: null, asked: false };
  }
}
export async function saveName(name: string | null): Promise<void> {
  if (name) await AsyncStorage.setItem(K_NAME, name);
  else await AsyncStorage.removeItem(K_NAME);
  await AsyncStorage.setItem(K_ASKED, '1');
}
