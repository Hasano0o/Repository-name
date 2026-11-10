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
import { listRouters, saveRouter, updateRouter, SavedRouter } from '../store/routers';
import { dropSession } from '../store/sessions';
import { NO_VERDICT, Verdict, TrialResult, fpPayload, parseVerdict, runTrial } from '../utils/autoprogCore';
import type { Fingerprint } from '../utils/probe';

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
  const payload = { name: label, host, username, driverId: v.driver!, driverName: label, readOnly: true };
  const dup = (await listRouters().catch(() => [] as SavedRouter[])).find(x => x.driverId === v.driver && norm(x.host) === norm(host));
  if (dup) {
    dropSession(dup.id);
    const up = await updateRouter(dup.id, payload, password);
    if (up) return up;
  }
  return saveRouter(payload, password);
}
