import { runRouterOp } from '../../src/utils/routerOp';
import { useLeaveGuard } from '../../src/ui/useLeaveGuard';
/**
 * آي بي جديد — تصعيد تلقائي: ١) قطع بيانات سريع  ٢) لو نفس الآي بي: فصل كامل عن البرج (reattach)
 * — هذا اللي يخلي الشركة تفك الآي بي مثل الطفي — ٣) إعادة تشغيل كخيار أخير.
 * نعرض الآي بي العام (اللي تشوفه المواقع والألعاب) وآي بي الراوتر الداخلي عند الشركة، قبل وبعد.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { reportError } from '../../src/services/errors';
import { diag } from '../../src/services/diag';
import { withSession, withSessionPatient } from '../../src/store/sessions';
import { waitOnline, freeRelease } from '../../src/utils/safeLock';
import { C, R, S, tBg, tBd, tFg } from '../../src/ui/theme';
import { measureUrl, regionUrls, selectedRegion, GameRegion } from '../../src/utils/latency';
import { HuntTry, HuntGoal, huntTargets, huntStop, huntBest, huntHit, huntFastest, autoTarget } from '../../src/utils/ipHunt';
import { IpGuard, getIpGuard, setIpGuard, clearIpGuard, IP_GUARD_HOURS } from '../../src/store/ipGuard';
import { quickDown } from '../../src/utils/speedLive';

import { sheet } from '../../src/i18n';

/** وضع التجربة: ضغطة ٣ ثواني على العنوان — يفعّل الفصل عن البرج على ZTE لهالجهاز بس */
const LAB_KEY = 'bandly.lab.detach';
const ACCENT = '#0e7d93';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Ips { pub?: string; wan?: string }

/** الآي بي العام كما تشوفه المواقع — مصدرين، أي واحد يرد يكفي */
async function publicIp(): Promise<string | undefined> {
  const one = async (url: string, parse: (t: string) => string | undefined) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}b=${Date.now()}`, { signal: ctrl.signal });
      return parse(await r.text());
    } catch {
      return undefined;
    } finally {
      clearTimeout(t);
    }
  };
  const a = await one('https://api.ipify.org?format=json', t => { try { return JSON.parse(t).ip; } catch { return undefined; } });
  if (a) return a;
  return one('https://1.1.1.1/cdn-cgi/trace', t => t.match(/^ip=(.+)$/m)?.[1]?.trim());
}

async function readIps(r: SavedRouter): Promise<Ips> {
  const [pub, wan] = await Promise.all([
    publicIp(),
    withSession(r, async d => (d.getDeviceDetails ? (await d.getDeviceDetails()).wanIp : undefined), false).catch(() => undefined),
  ]);
  return { pub, wan: wan || undefined };
}

export default function NewIp() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [supported, setSupported] = useState(true);
  const [before, setBefore] = useState<Ips | null>(null);
  const [after, setAfter] = useState<Ips | null>(null);
  const [busy, setBusy] = useState(false);
  // خروج وقت الفحص ← تأكيد (كان يكمل بالخلفية ويطلع «الراوتر مشغول» لو رجع)
  useLeaveGuard(busy, { what: 'آي بي جديد' });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const r = await getRouter(id);
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try {
        const [can, det, reb] = await withSession(r, async d => [!!d.reconnectData, !!d.reattach, !!d.reboot] as const, false).catch(() => [false, false, false] as const);
        if (!mounted.current) return;
        setSupported(can || det);
        setCanQuick(can);
        // الفصل عن البرج (reattach) موقوف لين نتأكد منه على راوتر حقيقي — على ZTE خلّى الراوتر بدون أبراج
        // الفصل عن البرج: هواوي بس (يحوّل وضع الشبكة لـ 3G ثواني ويرجّعه — نفس مدة ١٠–١٥ ثانية اللي تغيّر الآي بي).
        // ZTE موقوف — خلّى الراوتر بدون أبراج في التجربة
        // وضع التجربة (ضغطة طويلة على العنوان): يفعّل الفصل على ZTE لجهاز المطوّر بس
        let labOn = false;
        try { labOn = (await AsyncStorage.getItem(LAB_KEY)) === '1'; } catch {}
        if (!mounted.current) return;
        setLab(labOn);
        // الراوتر قال قبل إنه ما يقدر ينفصل (لا وضع مؤقت ولا تردد نوقفه عليه) — ما نجرّب كل مرة
        let noDetach = false;
        try { noDetach = (await AsyncStorage.getItem(`newip.nodetach2.${r.id}`)) === '1'; } catch {}
        // FiberHome الجديد: وضع الطيران من صفحة الراوتر نفسها (networkSet.js) — reattach موجود بس في v2
        setCanDetach(!noDetach && det && (/huawei|fiberhome/i.test(r.driverId) || (labOn && /zte/i.test(r.driverId))));
        try { setSkipQuick((await AsyncStorage.getItem(`newip.reboot.${r.id}`)) === '1'); } catch {}
        try { setDetachFirst(labOn || (await AsyncStorage.getItem(`newip.detach.${r.id}`)) === '1'); } catch {}
        setCanReboot(reb && r.driverId !== 'device');
        setBefore(await readIps(r));
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => { mounted.current = false; };
  }, [id]);

  const [canReboot, setCanReboot] = useState(false);
  const [canQuick, setCanQuick] = useState(false);
  const [canDetach, setCanDetach] = useState(false);
  const [lab, setLab] = useState(false);
  /** مدة الفصل والرجوع بالثواني (تظهر في وضع التجربة) */
  const [detachSecs, setDetachSecs] = useState<number | null>(null);
  const toggleLab = async () => {
    const next = !lab;
    try { await AsyncStorage.setItem(LAB_KEY, next ? '1' : '0'); } catch {}
    setLab(next);
    Alert.alert('وضع التجربة', next
      ? 'تفعّل: الفصل عن البرج شغّال على ZTE في هالجهاز بس. اطلع من الشاشة وارجع لها.'
      : 'انطفى وضع التجربة. اطلع من الشاشة وارجع لها.');
  };
  /** القطع السريع ما نفع مع هالراوتر قبل؟ نروح لإعادة التشغيل على طول (أسرع دقيقة) */
  const [skipQuick, setSkipQuick] = useState(false);
  /** الفصل عن البرج نجح قبل مع هالراوتر؟ نبدأ فيه على طول (القطع السريع ما ينفع عند شركته) */
  const [detachFirst, setDetachFirst] = useState(false);
  const [mode, setMode] = useState<'normal' | 'reboot'>('normal');

  const [step, setStep] = useState<'' | 'quick' | 'detach' | 'reboot'>('');

  /** هل تغيّر شي عن القديم؟ (العام أو آي بي الراوتر عند الشركة) */
  const differs = (o: Ips, n: Ips) =>
    (!!o.pub && !!n.pub && o.pub !== n.pub) || (!!o.wan && !!n.wan && o.wan !== n.wan);

  /** ننتظر الراوتر يرجع ونقرأ الآي بي — كم محاولة لأن أول ثواني ممكن ما فيه نت */
  const settle = async (ms: number): Promise<Ips> => {
    setStatus('ننتظر الراوتر يتصل...');
    const ok = await waitOnline(info!, ms, () => !mounted.current);
    if (!ok) throw new Error('الراوتر ما رجع يتصل — انتظر دقيقة أو أعد تشغيله');
    setStatus('نقرأ الآي بي الجديد...');
    let fresh: Ips = {};
    for (let i = 0; i < 4 && mounted.current; i++) {
      await sleep(2500);
      fresh = await readIps(info!);
      if (fresh.pub) break;
    }
    return fresh;
  };

  const run = (m: 'auto' | 'reboot' = 'auto') => {
    if (!info) return;
    const direct = m === 'reboot' || (skipQuick && canReboot && !detachFirst);
    const msg = direct
      ? 'نعيد تشغيل الراوتر من التطبيق — هذي الطريقة اللي تغيّر الآي بي عند شركتك. النت بينقطع حوالي دقيقتين، ونعرض لك الآي بي الجديد لما يرجع.'
      : 'نجرّب أول قطع سريع للبيانات (ثواني). لو الشركة رجّعت نفس الآي بي، نعيد تشغيل الراوتر من التطبيق تلقائي (دقيقتين تقريباً).';
    setMode(direct ? 'reboot' : 'normal');
    Alert.alert('آي بي جديد', msg, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'يلا', onPress: async () => {
          // كل خطوات تغيير الآي بي (قطع/فصل/إعادة تشغيل/فك) عملية وحدة على الراوتر
          await runRouterOp(info, 'آي بي جديد', async op => {
          setBusy(true); setError(''); setAfter(null); setStep('');
          // آي بي جديد يدوي ← الحماية حق الآي بي القديم ما لها معنى
          clearIpGuard(info.id).catch(() => {}); setGuard(null);
          try {
            const old = before ?? await readIps(info);
            if (mounted.current) setBefore(old);
            let fresh: Ips = {};

            const doReboot = async (label: string) => {
              setStep('reboot');
              setStatus(label);
              await withSession(info, d => d.reboot!(), false);
              await sleep(30000);
              return settle(150000).catch(async e3 => {
                // رجع من إعادة التشغيل بدون أبراج: غالباً وضع شبكة/ترددات عالقة — نفكها
                setStatus('الراوتر ما رجع يمسك برج — نفك التثبيتات ونرجّع وضع الشبكة...');
                if (!(await freeRelease(info, t => mounted.current && setStatus(t), undefined, op).catch(() => false))) throw e3;
                return readIps(info);
              });
            };
            if (direct) {
              setStep('reboot');
              fresh = await doReboot('نعيد تشغيل الراوتر...');
            } else {
              // ١) قطع سريع للبيانات
              if (canQuick && !(detachFirst && canDetach)) {
                setStep('quick');
                setStatus(canDetach ? '١/٣ — نقطع البيانات ونرجّعها...' : '١/٢ — نقطع البيانات ونرجّعها...');
                try {
                  await withSession(info, d => d.reconnectData!({ holdSecs: 10 }), false);
                  await sleep(3000);
                  fresh = await settle(60000);
                } catch (e: any) {
                  // الراوتر ما يسمح بقطع الاتصال اليدوي (ZTE MC801A العادي — ما انقطع شي) ← نكمّل لإعادة التشغيل ونتذكره
                  if (!e?.quickUnsupported || !canReboot) throw e;
                  diag(`[newip] quick unsupported → reboot: ${String(e?.message ?? e).slice(0, 80)}`);
                  AsyncStorage.setItem(`newip.reboot.${info.id}`, '1').catch(() => {});
                  setSkipQuick(true);
                }
              }
              // ٢) الشركة رجّعت نفس الآي بي → إعادة تشغيل من التطبيق (الطريقة المؤكدة عند أغلب الشركات)
              if (mounted.current && canReboot && !canDetach && !differs(old, fresh)) {
                setMode('reboot');
                fresh = await doReboot('٢/٢ — الشركة رجّعت نفس الآي بي، نعيد تشغيل الراوتر (دقيقتين تقريباً)...');
                // نتذكّر: المرة الجاية نروح لإعادة التشغيل على طول
                if (differs(old, fresh)) { AsyncStorage.setItem(`newip.reboot.${info.id}`, '1').catch(() => {}); setSkipQuick(true); }
              }
              // (موقوف) فصل كامل عن البرج
              if (mounted.current && canDetach && !differs(old, fresh)) {
                setStep('detach');
                setStatus(detachFirst
                  ? 'نفصل الراوتر عن البرج ثواني ونرجّعه (الطريقة اللي تنفع مع شركتك)...'
                  : '٢/٣ — الشركة رجّعت نفس الآي بي، نفصل الراوتر عن البرج ثواني ونرجّعه...');
                const t0 = Date.now();
                setDetachSecs(null);
                try {
                  diag(`newip detach start driver=${info.driverId} lab=${lab ? 1 : 0}`);
                  await withSession(info, d => d.reattach!(10), false);
                  await sleep(5000);
                  fresh = await settle(90000).catch(async e3 => {
                    // ما رجع يمسك برج: نطلّعه من الوضع المؤقت ونفك التثبيتات — ما نخليه بلا نت
                    setStatus('الراوتر ما رجع يمسك برج — نرجّعه...');
                    await withSessionPatient(info, d => (d.wakeRadio ? d.wakeRadio() : Promise.resolve()), 60_000).catch(() => {});
                    if (await waitOnline(info, 60000, () => !mounted.current)) return readIps(info);
                    if (!(await freeRelease(info, t => mounted.current && setStatus(t), undefined, op).catch(() => false))) throw e3;
                    return readIps(info);
                  });
                  const secs = Math.round((Date.now() - t0) / 1000);
                  setDetachSecs(secs);
                  diag(`newip detach done secs=${secs} changed=${differs(old, fresh) ? 1 : 0}`);
                  if (lab) reportError('newip-lab', new Error(`detach ${info.driverId} ${secs}s changed=${differs(old, fresh) ? 1 : 0}`), info);
                  if (differs(old, fresh)) {
                    AsyncStorage.setItem(`newip.detach.${info.id}`, '1').catch(() => {});
                    setDetachFirst(true);
                  }
                } catch (e2: any) {
                  // الفصل ما زبط على هالموديل — نعرض نتيجة القطع السريع وزر إعادة التشغيل بدل خطأ بس
                  // «ما يسمح بالفصل» = الموديل ما فيه وضع مؤقت (تقرير ٢٥ أكتوبر، هواوي 4G/5G) — مو عطل:
                  // ما نرسله تقرير، ونتذكره عشان المرة الجاية نروح لإعادة التشغيل على طول
                  if (/ما يسمح بالفصل/.test(String(e2?.message ?? e2))) {
                    AsyncStorage.setItem(`newip.nodetach2.${info.id}`, '1').catch(() => {});
                    setCanDetach(false);
                  } else reportError('newip-detach', e2, info);
                  // لو علق في الوضع المؤقت نرجّعه قبل أي شي
                  setStatus('نرجّع وضع الشبكة...');
                  await withSessionPatient(info, d => (d.wakeRadio ? d.wakeRadio() : Promise.resolve()), 60_000).catch(() => {});
                  setStep('quick');
                  if (!canQuick) throw e2;
                  fresh = await readIps(info).catch(() => fresh);
                }
                // الفصل ما غيّر الآي بي → إعادة تشغيل (الطريقة المؤكدة)
                if (mounted.current && canReboot && !differs(old, fresh)) {
                  setMode('reboot');
                  fresh = await doReboot('الشركة رجّعت نفس الآي بي — نعيد تشغيل الراوتر (دقيقتين تقريباً)...');
                  // شركتك ما تغيّر الآي بي إلا بإعادة التشغيل ← المرة الجاية نروح لها على طول (نوفر القطع والفصل)
                  if (differs(old, fresh)) {
                    AsyncStorage.setItem(`newip.reboot.${info.id}`, '1').catch(() => {});
                    setSkipQuick(true);
                  }
                }
              }
            }
            if (mounted.current) setAfter(fresh);
          } catch (e: any) {
            if (mounted.current) setError(e?.message ?? String(e));
            reportError('newip', e, info);
          } finally {
            if (mounted.current) { setBusy(false); setStatus(''); }
          }
          });
        },
      },
    ]);
  };

  // ═══ «دوّر لي على آي بي ممتاز» — يكرر آي بي جديد + قياس بنق لين يوصل الهدف (utils/ipHunt) ═══
  const [region, setRegion] = useState<GameRegion | null>(null);
  const [base, setBase] = useState<number | undefined>();
  /** 'auto' = نوقف أول ما يطلع آي بي أحسن من الحين بوضوح (الافتراضي) */
  const [target, setTarget] = useState<number | 'auto'>('auto');
  const [goalUsed, setGoalUsed] = useState<HuntGoal | null>(null);
  const [guard, setGuard] = useState<IpGuard | null>(null);
  useEffect(() => { if (id) getIpGuard(String(id)).then(g => mounted.current && setGuard(g)).catch(() => {}); }, [id]);
  const [tries, setTries] = useState<HuntTry[]>([]);
  const [huntEnd, setHuntEnd] = useState<'hit' | 'max' | 'stuck' | 'cancel' | null>(null);
  const [hunting, setHunting] = useState(false);
  /** نقيس سرعة التنزيل مع كل محاولة (اختياري — ~٢٥ ميقا لكل محاولة) */
  const [withSpeed, setWithSpeed] = useState(false);
  useEffect(() => { AsyncStorage.getItem('bandly.iphunt.speed').then(v => mounted.current && setWithSpeed(v === '1')).catch(() => {}); }, []);
  const stopHunt = useRef(false);
  useEffect(() => { selectedRegion().then(r => mounted.current && setRegion(r)).catch(() => {}); }, []);
  // الطريقة: الفصل عن البرج لو هو اللي ينفع عندك · القطع السريع · وإلا إعادة التشغيل (دقيقتين لكل محاولة — حد أقل)
  const huntWay: 'detach' | 'quick' | 'reboot' | null =
    detachFirst && canDetach ? 'detach' : canQuick && !skipQuick ? 'quick' : canReboot ? 'reboot' : canDetach ? 'detach' : null;
  // إعادة التشغيل: كل محاولة دقيقتين — العضو يختار (٣ / ٥ / ٨)، الافتراضي ٣
  const [rebootMax, setRebootMax] = useState(3);
  const huntMax = huntWay === 'reboot' ? rebootMax : 8;
  const measureBase = async () => {
    if (!region) return;
    const r0 = await measureUrl(regionUrls(region), 8);
    if (mounted.current && r0.samples) setBase(r0.median);
  };
  useEffect(() => { if (region && !loading && supported) measureBase().catch(() => {}); }, [region, loading, supported]);

  const hunt = () => {
    if (!info || !region || !huntWay) return;
    const auto = target === 'auto';
    if (auto && base === undefined) { Alert.alert('آي بي ممتاز', 'ما قدرنا نقيس بنقك الحالي — تأكد إن جوالك على واي فاي الراوتر، أو اختر رقم.'); return; }
    Alert.alert('آي بي ممتاز',
      (auto
        ? `نغيّر الآي بي ونقيس البنق لـ ${region.name}، ونوقف أول ما يطلع آي بي أحسن من الحين بوضوح (${autoTarget({ auto: true, base: base! })}ms أو أقل${withSpeed ? ' والسرعة ما نزلت' : ''}) — حد أقصى ${huntMax} محاولات.`
        : `نغيّر الآي بي ونقيس البنق لـ ${region.name} لين يصير ${target}ms أو أقل — حد أقصى ${huntMax} محاولات.`) +
      (huntWay === 'reboot' ? '\n\n⚠️ شركتك ما تغيّر الآي بي إلا بإعادة تشغيل — كل محاولة دقيقتين تقريباً والنت ينقطع.' : '\n\nالنت ينقطع ثواني مع كل محاولة.') +
      (withSpeed ? `\n\n📶 ونقيس سرعة التنزيل مع كل محاولة (حتى ٢٥ ميقا لكل وحدة — يعني حتى ${huntMax * 25} ميقا من باقتك).` : '') +
      '\n\nما نقدر نرجع لآي بي قديم — لو ما وصلنا الهدف تبقى على آخر واحد.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'دوّر', onPress: async () => {
            stopHunt.current = false;
            setTries([]); setHuntEnd(null); setError(''); setAfter(null);
            let goal: HuntGoal = auto ? { auto: true, base: base! } : (target as number);
            if (auto && withSpeed) {
              setStatus('نقيس سرعتك الحالية عشان نقارن...');
              const d0 = await quickDown(4000, 25_000_000).catch(() => null);
              if (d0?.mbps) goal = { auto: true, base: base!, baseDown: d0.mbps };
            }
            setGoalUsed(goal);
            await runRouterOp(info, 'آي بي ممتاز', async () => {
              setHunting(true); setBusy(true);
              const list: HuntTry[] = [];
              let prev = (before ?? await readIps(info)).pub;
              try {
                for (let n = 1; n <= huntMax; n++) {
                  if (stopHunt.current || !mounted.current) { setHuntEnd('cancel'); break; }
                  setStatus(`محاولة ${n}/${huntMax} — نغيّر الآي بي...`);
                  if (huntWay === 'reboot') {
                    await withSession(info, d => d.reboot!(), false);
                    await sleep(30000);
                  } else if (huntWay === 'detach') {
                    await withSession(info, d => d.reattach!(10), false);
                    await sleep(5000);
                  } else {
                    try {
                      await withSession(info, d => d.reconnectData!({ holdSecs: 10 }), false);
                    } catch (e: any) {
                      // الراوتر ما يسمح بالقطع السريع (ZTE MC801A…) ← نتذكر ونرجع لإعادة التشغيل
                      if (e?.quickUnsupported) {
                        AsyncStorage.setItem(`newip.reboot.${info.id}`, '1').catch(() => {});
                        if (mounted.current) setSkipQuick(true);
                        throw new Error('راوترك ما يسمح بالقطع السريع — اختر عدد محاولات إعادة التشغيل (فوق) وجرّب مرة ثانية.');
                      }
                      throw e;
                    }
                    await sleep(3000);
                  }
                  const fresh = await settle(huntWay === 'reboot' ? 150000 : 90000);
                  setStatus(`محاولة ${n}/${huntMax} — نقيس البنق لـ ${region.name}...`);
                  await sleep(1500);
                  const m = await measureUrl(regionUrls(region), 10);
                  let down: number | undefined;
                  if (withSpeed && !stopHunt.current) {
                    setStatus(`محاولة ${n}/${huntMax} — نقيس سرعة التنزيل...`);
                    down = (await quickDown(4000, 25_000_000, () => stopHunt.current).catch(() => null))?.mbps;
                  }
                  const t: HuntTry = {
                    n, ip: fresh.pub, median: m.samples ? m.median : undefined, down,
                    loss: m.samples ? Math.round(m.lossPct) : 100,
                    // ما قرينا الآي بي ← غير معروف (مو «نفسه»)
                    changed: fresh.pub && prev ? fresh.pub !== prev : undefined,
                  };
                  prev = fresh.pub ?? prev;
                  list.push(t);
                  if (mounted.current) { setTries([...list]); setAfter(fresh); }
                  diag(`[iphunt] ${n}/${huntMax} ${huntWay} · ${t.changed === undefined ? 'آي بي ما انقرى' : t.changed ? 'آي بي جديد' : 'نفس الآي بي'} · ${t.median ?? '—'}ms فقد ${t.loss}%${down !== undefined ? ` · ${down}Mbps` : ''}`);
                  const end = huntStop(list, goal, huntMax);
                  if (end) {
                    setHuntEnd(end);
                    // لقينا آي بي ممتاز ← نحميه ٣ ساعات (ما نسوي شي تلقائي يقطع الاتصال)
                    if (end === 'hit') {
                      const g: IpGuard = { until: Date.now() + IP_GUARD_HOURS * 3600_000, ip: t.ip, ms: t.median };
                      await setIpGuard(info.id, g);
                      if (mounted.current) setGuard(g);
                    }
                    break;
                  }
                }
              } catch (e: any) {
                if (mounted.current) setError(e?.message ?? String(e));
                reportError('newip', e, info);
              } finally {
                if (mounted.current) { setHunting(false); setBusy(false); setStatus(''); }
              }
            });
          },
        },
      ]);
  };
  const best = huntBest(tries);
  const fastest = huntFastest(tries);

  const pubChanged = !!before?.pub && !!after?.pub && before.pub !== after.pub;
  const wanChanged = !!before?.wan && !!after?.wan && before.wan !== after.wan;

  const IpRow = ({ label, oldV, newV, changed }: { label: string; oldV?: string; newV?: string; changed: boolean }) => (
    <View style={s.ipRow}>
      <Text style={s.ipLbl}>{label}</Text>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Text style={[s.ip, after && s.ipOld]}>{oldV ?? '—'}</Text>
        {after && (
          <>
            <Text style={s.arrow}>←</Text>
            <Text style={[s.ip, { color: changed ? tFg('#0f7a52') : C.text }]}>{newV ?? '—'}</Text>
          </>
        )}
      </View>
    </View>
  );

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        <View style={s.card}>
          <Pressable onLongPress={toggleLab} delayLongPress={3000}>
            <Text style={s.title}>🔄 آي بي جديد{lab ? ' 🧪' : ''}</Text>
          </Pressable>
          <Text style={s.body}>
            ضغطة وحدة: نقطع البيانات ثواني، ولو الشركة رجّعت نفس الآي بي نعيد تشغيل الراوتر من التطبيق ونعرض لك الآي بي الجديد — بدون ما تقوم للراوتر.
            يفيد لو لعبة أو موقع حاط عليك حظر مؤقت، أو النت علق على مسار بطيء.
          </Text>

          {loading ? <ActivityIndicator color={ACCENT} /> : (
            <View style={s.ipBox}>
              <IpRow label="الآي بي العام" oldV={before?.pub} newV={after?.pub} changed={pubChanged} />
              <IpRow label="آي بي الراوتر عند الشركة" oldV={before?.wan} newV={after?.wan} changed={wanChanged} />
            </View>
          )}

          {!loading && !supported && (
            <Text style={s.warn}>راوترك ما يسمح بقطع البيانات من التطبيق — أعد تشغيله يدوي عشان تاخذ آي بي جديد.</Text>
          )}

          {!loading && supported && (
            <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={() => run('auto')} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{after ? '🔄 جرّب مرة ثانية' : '🔄 خذ آي بي جديد'}</Text>}
            </Pressable>
          )}
          {!!status && <Text style={s.statusText}>{status}</Text>}
          {!!error && <Text style={s.err}>{error}</Text>}
        </View>

        {!loading && supported && !!huntWay && !!region && (
          <View style={s.card}>
            <Text style={s.title}>🎯 دوّر لي على آي بي ممتاز</Text>
            <Text style={s.body}>
              نغيّر الآي بي ونقيس البنق لسيرفر لعبتك ({region.name}) لين يطلع الرقم اللي تبيه — بدل ما تجرّب بنفسك مرة ورا مرة.
              {base !== undefined ? ` البنق الحين ${base}ms.` : ''}
            </Text>
            <Text style={s.ipLbl}>البنق اللي تبيه (أو أقل):</Text>
            <View style={s.targets}>
              <Pressable onPress={() => setTarget('auto')} disabled={busy}
                style={[s.tgt, target === 'auto' && { backgroundColor: ACCENT, borderColor: ACCENT }]}>
                <Text style={[s.tgtTxt, target === 'auto' && { color: '#fff' }]}>✨ تلقائي</Text>
              </Pressable>
              {huntTargets(base).map(t => (
                <Pressable key={t} onPress={() => setTarget(t)} disabled={busy}
                  style={[s.tgt, target === t && { backgroundColor: ACCENT, borderColor: ACCENT }]}>
                  <Text style={[s.tgtTxt, target === t && { color: '#fff' }]}>{t}ms</Text>
                </Pressable>
              ))}
            </View>
            {huntWay === 'reboot' && (
              <>
                <Text style={s.ipLbl}>شركتك ما تغيّر الآي بي إلا بإعادة تشغيل — كل محاولة دقيقتين تقريباً. كم محاولة؟</Text>
                <View style={s.targets}>
                  {[3, 5, 8].map(n => (
                    <Pressable key={n} onPress={() => setRebootMax(n)} disabled={busy}
                      style={[s.tgt, rebootMax === n && { backgroundColor: ACCENT, borderColor: ACCENT }]}>
                      <Text style={[s.tgtTxt, rebootMax === n && { color: '#fff' }]}>{n} (~{n * 2} د)</Text>
                    </Pressable>
                  ))}
                </View>
                {canQuick && skipQuick && (
                  <Pressable hitSlop={6} disabled={busy} onPress={() => {
                    AsyncStorage.removeItem(`newip.reboot.${info!.id}`).catch(() => {});
                    setSkipQuick(false);
                  }}>
                    <Text style={s.guardOff}>القطع السريع ما نفع قبل — جرّبه مرة ثانية (ثواني بدل دقيقتين، و٨ محاولات)</Text>
                  </Pressable>
                )}
              </>
            )}
            <Pressable disabled={busy} onPress={() => {
              const v = !withSpeed;
              setWithSpeed(v);
              AsyncStorage.setItem('bandly.iphunt.speed', v ? '1' : '0').catch(() => {});
            }} style={s.speedRow}>
              <View style={[s.check, withSpeed && { backgroundColor: ACCENT, borderColor: ACCENT }]}>
                {withSpeed && <Text style={s.checkMark}>✓</Text>}
              </View>
              <Text style={s.speedTxt}>📶 قِس سرعة التنزيل كمان (حتى ٢٥ ميقا لكل محاولة)</Text>
            </Pressable>
            {hunting ? (
              <Pressable style={s.btn2} onPress={() => { stopHunt.current = true; setStatus('نوقف بعد هالمحاولة...'); }}>
                <Text style={s.btn2Text}>⏹ وقّف</Text>
              </Pressable>
            ) : (
              <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={hunt} disabled={busy}>
                <Text style={s.btnText}>🎯 دوّر (حد أقصى {huntMax} محاولات)</Text>
              </Pressable>
            )}
            {tries.length > 0 && (
              <View style={s.ipBox}>
                {tries.map(t => (
                  <View key={t.n} style={s.tryRow}>
                    <Text style={[s.tryMs, { color: goalUsed !== null && huntHit(t, goalUsed) ? tFg('#0f7a52') : t.median !== undefined && base !== undefined && t.median < base ? ACCENT : C.text }]}>
                      {t.median !== undefined ? `${t.median}ms` : '—'}{t.loss >= 20 ? ` · فقد ${t.loss}%` : ''}
                      {t.down !== undefined ? <Text style={[s.tryDown, fastest?.n === t.n && { color: tFg('#0f7a52') }]}>{`  ·  ${t.down} Mbps`}</Text> : null}
                    </Text>
                    <Text style={s.tryIp} numberOfLines={1}>{t.n}. {t.ip ?? 'ما قرينا الآي بي'}{t.changed === false ? ' (نفسه)' : ''}</Text>
                  </View>
                ))}
              </View>
            )}
            {huntEnd === 'hit' && <Text style={[s.verdict, { color: tFg('#0f7a52') }]}>✓ لقينا آي بي ممتاز: {tries[tries.length - 1]?.median}ms — العب عليه</Text>}
            {huntEnd === 'max' && (
              <Text style={s.note}>
                ما وصلنا {goalUsed && typeof goalUsed !== 'number' ? `آي بي أحسن من اللي كان (${autoTarget(goalUsed)}ms)` : `${goalUsed}ms`} بعد {tries.length} محاولات{best ? ` — أفضل رقم طلع ${best.median}ms (محاولة ${best.n})` : ''}. البنق يعتمد على البرج والشركة أكثر من الآي بي — جرّب بعد شوي، أو ارفع الهدف.
              </Text>
            )}
            {huntEnd === 'stuck' && (
              <Text style={s.note}>
                الشركة ترجّع نفس الآي بي مع القطع السريع — {canReboot ? 'استخدم «أعد تشغيل الراوتر» تحت، أو جرّب بعد ٥–١٠ دقايق.' : 'جرّب بعد ٥–١٠ دقايق.'}
              </Text>
            )}
            {huntEnd === 'cancel' && <Text style={s.note}>وقفنا — أنت الحين على آخر آي بي.</Text>}
            {!!guard && !hunting && (
              <View style={s.guardBox}>
                <Text style={s.guardTxt}>
                  🛡️ آي بيك محمي لين {new Date(guard.until).toLocaleTimeString('ar-SA', { hour: 'numeric', minute: '2-digit' })}
                  {guard.ms !== undefined ? ` (${guard.ms}ms)` : ''} — التطبيق ما يسوي شي تلقائي يقطع الاتصال (الحارس، الإصلاح، الصيانة). لو النت طاح ترجع تشتغل عادي.
                </Text>
                <Pressable hitSlop={8} onPress={() => { clearIpGuard(info!.id).catch(() => {}); setGuard(null); }}>
                  <Text style={s.guardOff}>شيل الحماية</Text>
                </Pressable>
              </View>
            )}
            {!!fastest && !hunting && (
              <Text style={s.note}>📶 أسرع تنزيل: {fastest.down} Mbps (محاولة {fastest.n}{fastest.median !== undefined ? ` · بنق ${fastest.median}ms` : ''}){fastest.n === tries[tries.length - 1]?.n ? ' — وهو اللي أنت عليه الحين' : ''}</Text>
            )}
          </View>
        )}

        {after && !tries.length && (
          <View style={[s.card, { borderColor: pubChanged || wanChanged ? tBd('#7fd4b8') : tBd('#f5cf8a') }]}>
            {pubChanged ? (
              <>
                <Text style={[s.verdict, { color: tFg('#0f7a52') }]}>✓ صار عندك آي بي جديد</Text>
                {step === 'detach' && <Text style={s.note}>القطع السريع ما كفى، فصلنا الراوتر عن البرج ورجّعناه — وأخذ آي بي جديد بدون إعادة تشغيل.</Text>}
                {lab && detachSecs !== null && <Text style={s.note}>🧪 الفصل والرجوع أخذ {detachSecs} ثانية</Text>}
              </>
            ) : wanChanged ? (
              <>
                <Text style={[s.verdict, { color: tFg('#0f7a52') }]}>✓ الراوتر أخذ جلسة جديدة</Text>
                <Text style={s.note}>
                  الآي بي العام بقى نفسه لأن الشركة تشارك الآي بي العام بين مشتركين كثير. هذا طبيعي، وجرّب مرة ثانية بعد دقيقة لو تحتاج آي بي عام مختلف.
                </Text>
              </>
            ) : (
              <>
                <Text style={[s.verdict, { color: tFg('#a15c00') }]}>الشركة رجّعت نفس الآي بي</Text>
                <Text style={s.note}>
                  {mode === 'reboot'
                    ? 'حتى بعد إعادة التشغيل — الشركة مثبّتة نفس الآي بي لشريحتك حالياً. جرّب بعد ساعة.'
                    : step === 'detach'
                      ? 'فصلنا الراوتر عن البرج ورجع بنفس الآي بي — الشركة حاجزته لشريحتك فترة. جرّب إعادة التشغيل، أو انتظر ٥–١٠ دقايق وجرّب.'
                      : 'الشركة تحفظ آي بي الشريحة فترة قصيرة بعد الانقطاع. جرّب إعادة تشغيل الراوتر.'}
                </Text>
                {mode !== 'reboot' && canReboot && (
                  <Pressable style={[s.btn2, busy && { opacity: 0.6 }, { marginTop: 4 }]} onPress={() => run('reboot')} disabled={busy}>
                    <Text style={s.btn2Text}>⏻ أعد تشغيل الراوتر (أقوى طريقة)</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        )}

        <Text style={s.foot}>
          الآي بي العام نقرأه من جوالك — لو جوالك مو متصل بواي فاي الراوتر، بيطلع آي بي شريحة الجوال بداله.
        </Text>
      </ScrollView>
    </LinearGradient>
  );
}

const s = sheet({
  page: { padding: S.lg, gap: S.md },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: R.lg, padding: S.lg, gap: S.sm },
  title: { color: C.text, fontWeight: '800', fontSize: 17, textAlign: 'right' },
  body: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  ipBox: { backgroundColor: tBg('#f1f6fb'), borderColor: tBd('#d4e2f0'), borderWidth: 1.5, borderRadius: 14, padding: 12, gap: 10 },
  ipRow: { gap: 3 },
  ipLbl: { color: C.muted, fontSize: 11.5, fontWeight: '700', textAlign: 'right' },
  ip: { color: C.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  ipOld: { color: C.muted, textDecorationLine: 'line-through', fontWeight: '600', fontSize: 13 },
  arrow: { color: C.muted, fontSize: 14, fontWeight: '800' },
  warn: { color: tFg('#b45309'), fontSize: 12.5, textAlign: 'right', fontWeight: '700', lineHeight: 19 },
  btn: { backgroundColor: ACCENT, borderRadius: R.md, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  btn2: { borderColor: ACCENT, borderWidth: 1.5, borderRadius: R.md, paddingVertical: 11, alignItems: 'center' },
  btn2Text: { color: tFg(ACCENT), fontWeight: '800', fontSize: 13.5 },
  statusText: { color: ACCENT, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  err: { color: C.red, fontSize: 12.5, textAlign: 'right', lineHeight: 19 },
  verdict: { fontWeight: '800', fontSize: 15, textAlign: 'right', lineHeight: 23 },
  note: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  foot: { color: C.muted, fontSize: 11.5, textAlign: 'center', lineHeight: 18, paddingHorizontal: 8 },
  targets: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  tgt: { borderWidth: 1.5, borderColor: tBd('#cfe3ea'), borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  tgtTxt: { color: C.text, fontWeight: '800', fontSize: 13.5 },
  tryRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  tryIp: { color: C.sub, fontSize: 12.5, fontWeight: '700', flexShrink: 1, fontVariant: ['tabular-nums'] },
  tryMs: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tryDown: { color: C.sub, fontSize: 12.5, fontWeight: '700' },
  guardBox: { backgroundColor: tBg('#ecf8f3'), borderColor: tBd('#9bd8bf'), borderWidth: 1.5, borderRadius: 12, padding: 10, gap: 6 },
  guardTxt: { color: tFg('#0f7a52'), fontSize: 12.5, fontWeight: '700', textAlign: 'right', lineHeight: 19 },
  guardOff: { color: C.muted, fontSize: 12, fontWeight: '800', textAlign: 'left' },
  speedRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: tBd('#9fc6d1'), alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '900', lineHeight: 14 },
  speedTxt: { color: C.text, fontSize: 12.5, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
});
