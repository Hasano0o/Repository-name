/**
 * «برمج لي جهازي» — جهة التطبيق.
 *
 * ١) lookupProfile: بصمة صفحة الراوتر تبرمجت عند عضو قبل؟ (بدون رفع ملفات)
 * ٢) askVerdict: بعد رفع الملفات — الرسيفر يطابقها مع عائلاتنا (live-server/autoprog.py)
 * ٣) tryCandidate: نجرّب الدرايفر المقترح على الراوتر نفسه (دخول + إشارة) — الحكم من الراوتر مو من الرسيفر
 * ٤) saveAutoRouter: نجح ← ينحفظ «قراءة بس» (drivers/readOnly.ts)
 *
 * كلمة المرور ما تطلع من الجوال: الرسيفر يوصله «نجح / وين وقف» بس.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { LIVE_BASE } from './live';
import { driverById, driverIds } from '../drivers/registry';
import { assertLanHost } from '../utils/host';
import { getRouter, listRouters, patchAuto, saveRouter, updateRouter, SavedRouter } from '../store/routers';
import { dropSession, withSession } from '../store/sessions';
import {
  NO_VERDICT, Verdict, TrialResult, cleanWrites, discoverReads, discoverySummary, fpPayload, hiddenReads, parseVerdict, runTrial,
} from '../utils/autoprogCore';
import type { Fingerprint } from '../utils/probe';

/**
 * موقوفة (١٠ نوفمبر): فحص ١٨٥ ملف «جهاز جديد» حقيقي طلّع **صفر** راوتر يستفيد — التطبيق أصلاً يجرّب كل الدرايفرات (detect)،
 * فراوتر من عائلة نعرفها يتعرّف عليه بدون الرسيفر. الكود والاختبارات باقية؛ تتشغل (true) لو ظهرت حالات حقيقية
 * (فيرموير جديد لعائلة معروفة يفشّل التعرّف) — ومعها ربط autoprog.py في app.py الحي.
 */
export const AUTOPROG_ON = false;

async function post(path: string, body: object, ms = 20000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${LIVE_BASE}/live-api/app/autoprog/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, signal: ctrl.signal, body: JSON.stringify(body),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

/** بصمة الصفحة معروفة؟ أي فشل (نت، سيرفر قديم) = «لا» ونكمّل الطريق العادي */
export async function lookupProfile(fp: Fingerprint | null, model: string): Promise<Verdict> {
  const p = fpPayload(fp);
  if (!p) return NO_VERDICT;
  return parseVerdict(await post('lookup', { fp: p, model: model.slice(0, 60) }, 8000), driverIds());
}

/** بعد ما وصلت الملفات: وش يقول الرسيفر؟ */
export async function askVerdict(model: string, host: string, fp: Fingerprint | null): Promise<Verdict> {
  const have = driverIds();
  return parseVerdict(await post('verdict', { model: model.slice(0, 60), host: host.slice(0, 40), fp: fpPayload(fp), drivers: have }, 45000), have);
}

export async function reportTrial(v: Verdict, res: TrialResult): Promise<void> {
  if (!v.id) return;
  await post('result', { id: v.id, ok: res.ok, stage: res.stage, err: res.err, got: res.got, os: Platform.OS, ver: Constants.expoConfig?.version ?? '' }, 10000);
}

/** نجرّب الدرايفر المقترح على راوتر العضو — دخول وقراءة إشارة بس */
export async function tryCandidate(v: Verdict, host: string, username: string, password: string): Promise<TrialResult> {
  assertLanHost(host);
  const d = v.driver ? driverById(v.driver) : null;
  if (!d) return { ok: false, stage: 'login', err: 'الدرايفر مو موجود في هالنسخة', got: [] };
  return runTrial(d, host, username, password);
}

/** نحفظه «قراءة بس». نفس الراوتر محفوظ بنفس الدرايفر؟ نحدّثه بدل نسخة ثانية (النسختين يطردون بعض) */
export async function saveAutoRouter(v: Verdict, name: string, host: string, username: string, password: string): Promise<SavedRouter> {
  const norm = (x: string) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const label = name.trim() || v.label || 'راوتر';
  // أوامر التغيير اللي الرسيفر لقاها في كود صفحة الراوتر تنفتح من أول — والقراءات تنكتشف بعد الحفظ (discoverFeatures)
  const payload = {
    name: label, host, username, driverId: v.driver!, driverName: label, readOnly: true,
    auto: { key: v.key ?? '', writes: v.writes ?? [], checkedAt: Date.now() },
  };
  const dup = (await listRouters().catch(() => [] as SavedRouter[])).find(x => x.driverId === v.driver && norm(x.host) === norm(host));
  if (dup) {
    dropSession(dup.id);
    const up = await updateRouter(dup.id, payload, password);
    if (up) return up;
  }
  return saveRouter(payload, password);
}

export interface FeatureReport { router: SavedRouter; found: string[]; missing: string[]; aborted: boolean }

/**
 * اكتشاف الميزات: نجرّب كل قراءة في الدرايفر على راوتر العضو (قراءة بس) — اللي ما ترد تنخفي من التطبيق.
 * النتيجة توصل الرسيفر بأسماء الدوال بس (نجحت/لا) — نعرف منها وش يشتغل على كل موديل.
 */
export async function discoverFeatures(r: SavedRouter, onStep?: (done: number, total: number) => void): Promise<FeatureReport> {
  if (!r.readOnly) throw new Error('اكتشاف الميزات لراوترات «برمج لي جهازي» بس');
  // نعيد تجربة كل شي: نشيل الإخفاء القديم أول (الغلاف يخفي القراءات الفاشلة، فما تنجرّب)
  const prevHide = r.auto?.hide ?? [];
  let cur = (await patchAuto(r.id, { hide: [] })) ?? r;
  dropSession(r.id);
  let res;
  try {
    res = await withSession(cur, d => discoverReads(d, onStep), false);
  } catch (e) {
    await patchAuto(r.id, { hide: prevHide });
    dropSession(r.id);
    throw e;
  }
  if (res.aborted) {
    // الاتصال طاح في النص — ما نبني على نتيجة ناقصة
    cur = (await patchAuto(r.id, { hide: prevHide })) ?? cur;
    dropSession(r.id);
    return { router: cur, ...discoverySummary(res.reads), aborted: true };
  }
  cur = (await patchAuto(r.id, { hide: hiddenReads(res.reads), reads: res.reads, discoveredAt: Date.now() })) ?? cur;
  dropSession(r.id);
  post('discovered', {
    key: cur.auto?.key ?? '', driver: cur.driverId, model: cur.name.slice(0, 60), reads: res.reads, writes: cur.auto?.writes ?? [],
    os: Platform.OS, ver: Constants.expoConfig?.version ?? '',
  }, 10000).catch(() => {});
  return { router: cur, ...discoverySummary(res.reads), aborted: false };
}

const CAPS_EVERY = 20 * 3600_000;
const capsBusy = new Set<string>();

/**
 * مرة باليوم: وش أوامر التغيير المفتوحة لبصمة هالراوتر عند الرسيفر؟ لو قفلنا أمر (أو وقّفنا الكل) يسري هنا.
 * السيرفر ما رد / ما يعرف البصمة ← نبقى على اللي عندنا.
 */
export async function refreshCaps(id: string): Promise<void> {
  if (capsBusy.has(id)) return;
  capsBusy.add(id);
  try {
    const r = await getRouter(id);
    if (!r?.readOnly || Date.now() - (r.auto?.checkedAt ?? 0) < CAPS_EVERY) return;
    const j = (await post('caps', { key: r.auto?.key ?? '' }, 8000)) as { writes?: unknown } | null;
    if (!j) return;
    if (!Array.isArray(j.writes)) { await patchAuto(id, { checkedAt: Date.now() }); return; }
    const next = cleanWrites(j.writes).sort();
    const prev = [...(r.auto?.writes ?? [])].sort();
    await patchAuto(id, { writes: next, checkedAt: Date.now() });
    // تغيّر اللي مفتوح ← الجلسة الجاية تنبني بالغلاف الجديد
    if (next.join() !== prev.join()) dropSession(id);
  } catch { /* مرة ثانية بكرة */ } finally { capsBusy.delete(id); }
}
