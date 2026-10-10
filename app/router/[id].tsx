import { useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet, LayoutAnimation, RefreshControl, AppState,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter, getRouter, deleteRouter } from '../../src/store/routers';
import { withSession, dropSession } from '../../src/store/sessions';
import { Signal, Usage, ConnectedDevice, Traffic, RouterDriver, DeviceDetails, DataPlan, ActiveLock } from '../../src/drivers/types';
import {
  Level, LEVEL_COLOR, LEVEL_LABEL, overallLevel, parseBands, parseNrBands, signalScore,
  rsrpLevel, rsrqLevel, sinrLevel, rssiLevel, isNoService } from '../../src/utils/signal';
import { fmtRate, fmtDuration, fmtBytes } from '../../src/utils/format';
import {addSample, stability } from '../../src/store/history';
import { C, tBd, tBg, tFg } from '../../src/ui/theme';
import { ModeChips } from '../../src/ui/ModeChips';
import { GlassCard } from '../../src/ui/GlassCard';
import { SignalRing } from '../../src/ui/SignalRing';
import { ArcGauge } from '../../src/ui/ArcGauge';
import { RadarPoint } from '../../src/ui/SignalRadar';
import { MetricRings, RingSpec } from '../../src/ui/MetricRing';
import { Icon, IconName } from '../../src/ui/Icon';
import { HeroCard, MetricCard, Section, TileGrid, ToolTile, GroupTitle } from '../../src/ui/Cards';
import { buildAdvice } from '../../src/utils/advice';
import { linkHealth } from '../../src/utils/linkHealth';
import { LinkHealthCard } from '../../src/ui/LinkHealth';
import { CongestionCard } from '../../src/ui/Congestion';
import { DiagnosisCard } from '../../src/ui/Diagnosis';
import { UsageRing } from '../../src/ui/UsageRing';
import { DeviceRow } from '../../src/ui/DeviceRow';
import { SyncIcon } from '../../src/ui/SyncIcon';
import { StoreAd } from '../../src/ui/StoreAd';
import { ComboCard } from '../../src/ui/ComboCard';
import { canRescue, rescueRouter, freeRelease } from '../../src/utils/safeLock';
import { hostLabel } from '../../src/drivers/device';
import { rememberOperator, learnOperatorBands } from '../../src/store/operator';
import { hasInternet } from '../../src/utils/internet';
import { reportOutage } from '../../src/services/community';

interface Features {
  bands: boolean; sms: boolean; block: boolean; reboot: boolean; devices: boolean; cells: boolean; details: boolean; plan: boolean; network: boolean; carriers: boolean;
}
const NO_FEATURES: Features = {
  bands: false, sms: false, block: false, reboot: false, devices: false, cells: false, details: false, plan: false, network: false, carriers: false,
};
const featuresOf = (d: RouterDriver): Features => ({
  bands: !!d.getBandConfig,
  sms: !!d.listSms,
  block: !!d.blockDevice,
  reboot: !!d.reboot,
  devices: !!d.getDevices,
  cells: !!d.getCells,
  details: !!d.getDeviceDetails,
  plan: !!d.getDataPlan,
  network: !!d.getApnProfiles || !!d.getDns,
  carriers: !!d.getCarriers,
});

/** خلفية البطاقة الرئيسية حسب جودة الاتصال */
const HERO_BG: Record<Level, [string, string, string]> = {
  excellent: [tBg('#ffffff'), tBg('#e3f8ee'), tBg('#c9f0de')],
  good: [tBg('#ffffff'), tBg('#e6f1ff'), tBg('#d3f3e6')],
  fair: [tBg('#ffffff'), tBg('#fff4e3'), tBg('#ffe6c2')],
  poor: [tBg('#ffffff'), tBg('#ffeef0'), tBg('#ffd9de')],
  unknown: [tBg('#ffffff'), tBg('#eef2fb'), tBg('#e2e8f6')],
};

function MetricRow({ label, value, unit, level }: { label: string; value?: number; unit: string; level: Level }) {
  return (
    <View style={s.metric}>
      <View style={s.metricVal}>
        <Text style={s.metricNum}>{value !== undefined ? `${value} ${unit}` : '—'}</Text>
        <View style={[s.dot, { backgroundColor: LEVEL_COLOR[level] }]} />
      </View>
      <Text style={s.metricLabel}>{label}</Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={s.metric}>
      <Text style={[s.metricNum, { flexShrink: 1 }]}>{value || '—'}</Text>
      <Text style={s.metricLabel}>{label}</Text>
    </View>
  );
}

function InfoPill({ label, icon, value, wide }: { label: string; icon: string; value?: string; wide?: boolean }) {
  return (
    <View style={[s.pillBox, wide && { flexBasis: '100%' }]}>
      <View style={s.pillHead}>
        <Text style={s.pillIcon}>{icon}</Text>
        <Text style={s.pillLabel}>{label}</Text>
      </View>
      <Text style={s.pillValue} numberOfLines={1}>{value || '—'}</Text>
    </View>
  );
}



function Acc({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={s.acc}>
      <Pressable
        style={s.accHead}
        accessibilityRole="button"
        onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen(o => !o); }}
      >
        <Text style={s.accTitle}>{title}</Text>
        <Icon name={open ? 'up' : 'down'} size={16} color={C.muted} />
      </Pressable>
      {open && <View style={s.accBody}>{children}</View>}
    </View>
  );
}


export default function RouterDashboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [feat, setFeat] = useState<Features>(NO_FEATURES);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [history, setHistory] = useState<RadarPoint[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [devices, setDevices] = useState<ConnectedDevice[]>([]);
  const [blocked, setBlocked] = useState<ConnectedDevice[]>([]);
  const [details, setDetails] = useState<DeviceDetails | null>(null);
  const [online, setOnline] = useState<boolean | undefined>();
  const [mode, setMode] = useState<string | undefined>();
  const [has5g, setHas5g] = useState<boolean | undefined>();
  const [lock, setLock] = useState<ActiveLock | null>(null);
  const [traffic, setTraffic] = useState<Traffic | null>(null);
  const [plan, setPlan] = useState<DataPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const polling = useRef(false);
  const lastSig = useRef<Signal | null>(null);
  const moves = useRef<number[]>([]);
  const [prevSig, setPrevSig] = useState<Signal | null>(null);
  const [moving, setMoving] = useState(false);
  /** فيه إشارة بس ما فيه إنترنت (يتأكد بفحصين ورا بعض) */
  const [noNet, setNoNet] = useState(false);
  const netFails = useRef(0);
  const netDownSince = useRef<number | null>(null);
  /** آخر دمج شفناه — الدمج يشتغل وقت التحميل بس، فنعرضه بدل ما «يختفي» */
  const [lastCa, setLastCa] = useState<{ bands: string[]; n: number; at: number } | null>(null);

  // ═══ آخر دمج: نقرأه من التخزين، ونحدّثه كل ما شفنا أكثر من ناقل — ونتعلّم ترددات الشبكة ═══
  const caKey = `bandly.lastCa.${id}`;
  useEffect(() => {
    AsyncStorage.getItem(caKey).then(v => { if (v) setLastCa(JSON.parse(v)); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (!signal || !id) return;
    const lte = parseBands(signal.band);
    const nrb = parseNrBands(signal.nrBand);
    const all = [...new Set([...lte, ...nrb])];
    const n = Math.max(all.length, signal.caCount ?? 0);
    const num = (x: string) => parseInt(x.replace(/[^0-9]/g, ''), 10);
    learnOperatorBands(id, lte.map(num), nrb.map(num)).catch(() => {});
    if (n > 1 && all.length) {
      const v = { bands: all, n, at: Date.now() };
      setLastCa(v);
      AsyncStorage.setItem(caKey, JSON.stringify(v)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal?.band, signal?.nrBand, signal?.caCount, id]);

  // ═══ فحص الإنترنت: الإشارة زينة بس النت واقف؟ (كل ٤٥ ثانية والشاشة مفتوحة) ═══
  const hasSignalNow = !!signal && (signal.rsrp !== undefined || signal.nrRsrp !== undefined);
  useEffect(() => {
    if (!hasSignalNow) return;
    let alive = true;
    const check = async () => {
      if (!alive || AppState.currentState !== 'active') return;
      const ok = await hasInternet();
      if (!alive) return;
      if (ok) {
        if (netDownSince.current) {
          const sig = lastSig.current;
          const tower = sig?.enodebId || sig?.cellId;
          if (tower) reportOutage({ tower: String(tower), operator: details?.operator ?? '' }, netDownSince.current, Date.now()).catch(() => {});
        }
        netFails.current = 0;
        netDownSince.current = null;
        setNoNet(false);
      } else {
        netFails.current += 1;
        if (netFails.current >= 2) {
          if (!netDownSince.current) netDownSince.current = Date.now() - 45000;
          setNoNet(true);
        }
      }
    };
    const first = setTimeout(check, 4000);
    const iv = setInterval(check, 45000);
    return () => { alive = false; clearTimeout(first); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSignalNow]);

  const applySignal = useCallback((sig: Signal | null) => {
    const prev = lastSig.current;
    lastSig.current = sig;
    setPrevSig(prev);
    setSignal(sig);
    if (sig) setHistory(h => [...h, { rsrp: sig.rsrp, sinr: sig.sinr }].slice(-20));
    // تغيّر ٣ dB أو أكثر في قراءتين من آخر ٤ = غالباً أحد يحرّك الراوتر
    if (sig?.rsrp !== undefined && prev?.rsrp !== undefined) {
      moves.current = [...moves.current, Math.abs(sig.rsrp - prev.rsrp)].slice(-4);
      const big = moves.current.filter(d => d >= 3).length;
      if (big >= 2) setMoving(true);
      else if (moves.current.length >= 4 && big === 0) setMoving(false);
    }
  }, []);

  const loadAll = useCallback(async (r: SavedRouter) => {
    setError('');
    try {
      await withSession(r, async d => {
        setFeat(featuresOf(d));
        const [sig, use, dev, blk, net, trf, det, dp, lk] = await Promise.all([
          d.getSignal ? d.getSignal() : Promise.resolve(null),
          d.getUsage ? d.getUsage().catch(() => null) : Promise.resolve(null),
          d.getDevices ? d.getDevices().catch(() => [] as ConnectedDevice[]) : Promise.resolve([] as ConnectedDevice[]),
          d.getBlockedDevices ? d.getBlockedDevices().catch(() => [] as ConnectedDevice[]) : Promise.resolve([] as ConnectedDevice[]),
          d.getNetworkInfo ? d.getNetworkInfo().catch(() => null) : Promise.resolve(null),
          d.getTraffic ? d.getTraffic().catch(() => null) : Promise.resolve(null),
          d.getDeviceDetails ? d.getDeviceDetails().catch(() => null) : Promise.resolve(null),
          d.getDataPlan ? d.getDataPlan().catch(() => null) : Promise.resolve(null),
          d.getActiveLock ? d.getActiveLock().catch(() => null) : Promise.resolve(null),
        ]);
        const blockedMacs = new Set(blk.map(b => b.mac));
        applySignal(sig);
        setUsage(use);
        setDevices(dev.filter(x => !blockedMacs.has(x.mac)));
        setBlocked(blk);
        setOnline(net?.connected);
        setMode(net?.mode);
        setHas5g(net?.supports5g);
        setTraffic(trf);
        setPlan(dp);
        setLock(lk);
        setDetails(det ? { ...det, operator: det.operator || net?.operator } : net ? { operator: net.operator } : null);
        rememberOperator(r.id, det?.operator || net?.operator).catch(() => {});
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [applySignal]);

  /** وقت «رجّع الإشارة» / الإنقاذ نوقف التحديث الدوري — كل طلب زيادة ممكن يقفل تسجيل الدخول */
  const paused = useRef(false);
  const poll = useCallback(async (r: SavedRouter) => {
    if (polling.current || paused.current) return;
    if (AppState.currentState !== 'active') return; // ما نستهلك بطارية/باقة والتطبيق بالخلفية
    polling.current = true;
    setSyncing(true);
    try {
      const [sig, trf] = await withSession(r, async d => Promise.all([
        d.getSignal ? d.getSignal() : Promise.resolve(null),
        d.getTraffic ? d.getTraffic().catch(() => null) : Promise.resolve(null),
      ]));
      applySignal(sig);
      setTraffic(trf);
      setError('');
      addSample(r.id, {
        rsrp: sig?.rsrp,
        sinr: sig?.sinr,
        band: sig?.band ? parseBands(sig.band).join(' + ') : undefined,
        down: trf?.downBytesPerSec,
        up: trf?.upBytesPerSec,
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      polling.current = false;
      setSyncing(false);
    }
  }, [applySignal]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      await loadAll(r);
      if (!alive) return;
      setLoading(false);
      timer = setInterval(() => poll(r), 5000);
    })();
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [id, loadAll, poll]));

  const onRefresh = async () => {
    if (!info) return;
    setBusy(true);
    await loadAll(info);
    setBusy(false);
  };

  const toggleAdvanced = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setAdvanced(v => !v);
  };


  const onReboot = () => {
    if (!info) return;
    Alert.alert(
      'إعادة تشغيل الراوتر',
      'سيُقطع الاتصال مؤقتاً أثناء إعادة التشغيل — دقيقتين تقريباً حتى يرجع الإنترنت.\n\nكل الأجهزة المتصلة بالواي فاي بينقطع عنها النت خلال هالفترة.',
      [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'إعادة تشغيل', style: 'destructive', onPress: async () => {
          setBusy(true);
          try {
            await withSession(info, d => (d.reboot ? d.reboot() : Promise.resolve()), false);
            dropSession(info.id);
            Alert.alert('تم', 'الراوتر يعيد التشغيل الحين');
            router.back();
          } catch (e: any) {
            setError(e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        },
      },
      ],
    );
  };

  const onBlock = (dev: ConnectedDevice) => {
    if (!info) return;
    if (!feat.block) { Alert.alert('غير مدعوم', 'حظر الأجهزة غير مدعوم لهذا الراوتر'); return; }
    Alert.alert('حظر الجهاز', `تبي تحظر "${dev.name || dev.mac}"؟\nتنبيه: إذا حظرت جوالك نفسه بينقطع اتصالك بالراوتر.`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حظر', style: 'destructive', onPress: async () => {
          setBusy(true);
          try {
            await withSession(info, d => d.blockDevice!(dev.mac, true, dev.name), false);
            await loadAll(info);
          } catch (e: any) {
            Alert.alert('ما تم الحظر', e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const onUnblock = async (dev: ConnectedDevice) => {
    if (!info) return;
    setBusy(true);
    try {
      await withSession(info, d => d.blockDevice!(dev.mac, false), false);
      await loadAll(info);
    } catch (e: any) {
      Alert.alert('خطأ', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const onClearLock = () => {
    if (!info) return;
    Alert.alert('رجوع للتلقائي', 'بنشيل قفل التردد والبرج، ونخلي الراوتر يختار بنفسه. الإنترنت بينقطع لحظات.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'ارجع', onPress: async () => {
          setBusy(true);
          try {
            await withSession(info, async d => {
              if (d.unlockCell) await d.unlockCell();
              if (d.setBand) await d.setBand([], []);
            }, false);
            await loadAll(info);
          } catch (e: any) {
            Alert.alert('ما تم', e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  // إنقاذ: الراوتر علق بدون خدمة بعد تثبيت برج/تردد — نرجّع إعداداته الأصلية بدون إعادة ضبط مصنع
  const [rescueStep, setRescueStep] = useState('');
  /** بلا شبكة: نفك كل التثبيتات ويلقط أقوى برج (ولو ما رجع: الإعدادات الأصلية/إعادة تشغيل) */
  const onFree = () => {
    if (!info) return;
    Alert.alert('رجّع الإشارة', 'بنفك تثبيت الأبراج والترددات ونخلي الراوتر يلقط أقوى برج بنفسه. لو ما رجعت، نعيد تشغيله.\n\nاسم الواي فاي وكلمة المرور ما يتغيرون.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'رجّعها', onPress: async () => {
          setBusy(true);
          paused.current = true;
          setRescueStep('نبدأ...');
          let back = false;
          try { back = await freeRelease(info, st => setRescueStep(st)); } catch {}
          paused.current = false;
          setRescueStep('');
          setBusy(false);
          await loadAll(info).catch(() => {});
          Alert.alert(
            back ? '✅ رجعت الإشارة' : 'ما رجعت الشبكة للحين',
            back
              ? 'فكّينا التثبيتات والراوتر لقط أقوى برج. تقدر الحين تجرّب الأبراج والترددات براحتك.'
              : 'فكّينا التثبيتات بس الشبكة ما رجعت. انتظر دقيقة، وتأكد من الشريحة والتغطية.',
          );
        },
      },
    ]);
  };
  const onRescue = () => {
    if (!info) return;
    Alert.alert(
      'رجّع الإعدادات الأصلية',
      'بنفك كل التثبيتات (الأبراج، الترددات، وضع الشبكة) ونرجّع الراوتر لإعداداته الأصلية ونعيد تشغيله — بدون إعادة ضبط مصنع.\n\nاسم الواي فاي وكلمة المرور ما يتغيرون. النت بينقطع دقيقتين تقريباً.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'رجّعها', onPress: async () => {
            setBusy(true);
            paused.current = true;
            setRescueStep('نبدأ...');
            try {
              const back = await rescueRouter(info, st => setRescueStep(st));
              setError('');
              await loadAll(info).catch(() => {});
              Alert.alert(
                back ? '✅ رجع الراوتر' : 'خلصنا — بس ما رجعت الخدمة للحين',
                back
                  ? 'فكّينا كل التثبيتات ورجّعنا الإعدادات الأصلية، والراوتر متصل الحين.'
                  : 'رجّعنا الإعدادات الأصلية والراوتر أعاد التشغيل، بس الشبكة ما رجعت للحين. انتظر دقيقة وتأكد من الشريحة والتغطية. لو بقي «No Service» جرّب تطفيه وتشغّله من الزر.',
              );
            } catch (e: any) {
              Alert.alert('ما قدرنا نوصل للراوتر', `${e?.message ?? String(e)}\n\nتأكد إن جوالك متصل بواي فاي الراوتر نفسه وجرّب مرة ثانية.`);
            } finally {
              paused.current = false;
              setRescueStep('');
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const onEnableAuto = () => {
    if (!info) return;
    Alert.alert('تفعيل الوضع التلقائي', 'بنخلي الراوتر يختار بين 4G و5G بنفسه. الإنترنت بينقطع لحظات.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'فعّل', onPress: async () => {
          setBusy(true);
          try {
            await withSession(info, d => d.setNetworkMode!('00'), false);
            await loadAll(info);
          } catch (e: any) {
            Alert.alert('ما تم', e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const onSetPlan = (gb: number) => {
    if (!info) return;
    const bytes = gb * 1e9;
    Alert.alert(
      gb === 0 ? 'إلغاء حد الباقة' : `ضبط الباقة على ${gb >= 1000 ? '1 تيرا' : gb + ' جيجا'}`,
      gb === 0
        ? 'بنشيل الحد، والتطبيق بيعرض الاستهلاك بدون نسبة.'
        : 'بيتحفظ في الراوتر نفسه، فيشتغل حتى لو فتحت التطبيق من جوال ثاني.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حفظ', onPress: async () => {
            setBusy(true);
            try {
              await withSession(info, d => d.setDataPlan!({
                startDay: plan?.startDay ?? 1,
                limitBytes: bytes,
                monthThreshold: plan?.monthThreshold ?? 90,
              }), false);
              await loadAll(info);
            } catch (e: any) {
              Alert.alert('ما انحفظ', e?.message ?? String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const onLimit = () => Alert.alert('قريباً', 'تحديد السرعة غير مدعوم لهذا الراوتر حالياً');

  const onDelete = () => {
    if (!info) return;
    Alert.alert('حذف الراوتر', `تبي تحذف "${info.name}" من التطبيق؟`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف', style: 'destructive', onPress: async () => {
          dropSession(info.id);
          await deleteRouter(info.id);
          router.back();
        },
      },
    ]);
  };

  const bands = parseBands(signal?.band);
  const hasNr = !!signal && (signal.nrRsrp !== undefined || !!signal.nrBand);
  const nrList = parseNrBands(signal?.nrBand);
  const allBands = [...new Set([...bands, ...nrList])];
  // بعض الأجهزة تدمج نواقل بدون ما تكشف أرقام باندات النواقل الثانوية —
  // نعتمد عدد النواقل (caCount) كبديل عشان مؤشر الدمج يطلع صح
  const caCount = Math.max(allBands.length, signal?.caCount ?? 0);
  const caBw = signal?.caBandwidthMhz;
  // الدمج يشتغل وقت التحميل بس: لو شفناه خلال آخر ساعتين على نفس الأساسي، نقول «جاهز» بدل «تردد واحد»
  const caIdle = caCount <= 1 && !!lastCa && Date.now() - lastCa.at < 2 * 3600_000 &&
    (!bands[0] || lastCa.bands.includes(bands[0]));
  const primary = hasNr && signal
    ? { rsrp: signal.nrRsrp, sinr: signal.nrSinr }
    : { rsrp: signal?.rsrp, sinr: signal?.sinr };
  const level = overallLevel(signal ? primary : null);
  const nrIdle = !hasNr && !!signal?.nrAvailable;
  const netLabel = hasNr
    ? (bands.length ? '5G NSA' : '5G')
    : (bands.length > 1 ? '4G+' : signal?.network ?? '4G LTE') + (nrIdle ? ' · 5G متاح' : '');
  // «منقطع» بس لو ما فيه قراءة برج — بعض الرواترات تقول disconnected والأبراج شغالة
  const disconnected = online === false && signal?.rsrp === undefined && signal?.nrRsrp === undefined;
  // الأبراج طايحة (خدمة محدودة/لا خدمة) — نعرض زر «رجّع الإشارة» الأحمر بدل النصيحة
  const noService = !error && isNoService(signal, online, mode);
  // التنبيه يطلع بس لراوتر يدعم 5G ومقفول على 4G — راوتر 4G فقط ما نزعجه
  const fourGOnly = mode === '03' && has5g !== false;

  return (
    <LinearGradient
      colors={error || disconnected ? [C.dangerTop, C.dangerBottom] : [tBg('#eaf2ff'), tBg('#f3efff'), tBg('#eaf9f3')]}
      style={{ flex: 1 }}
    >
      <Stack.Screen options={{ title: info?.name ?? 'الراوتر' }} />

      <ScrollView
        contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 110 }]}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={onRefresh} tintColor={C.blue} colors={[C.blue]} />}
      >
        {loading && (
          <View style={s.center}>
            <ActivityIndicator size="large" color={C.blue} />
            <Text style={s.muted}>نتصل بالراوتر...</Text>
          </View>
        )}

        {!!error && (
          <View style={s.errorCard}>
            <Text style={s.errorText}>{error}</Text>
            <Pressable style={s.retryBtn} onPress={onRefresh} disabled={busy}>
              <Text style={s.retryText}>إعادة المحاولة</Text>
            </Pressable>
          </View>
        )}

        {!loading && !!error && !rescueStep && canRescue(info) && (
          <View style={s.rescueCard}>
            <Text style={s.rescueTitle}>الراوتر بدون خدمة؟</Text>
            <Text style={s.rescueText}>
              لو ثبّت برج أو تردد وانقطع النت، نرجّع الراوتر لإعداداته الأصلية — بدون إعادة ضبط مصنع.
            </Text>
            {rescueStep ? (
              <View style={s.rescueBusy}>
                <ActivityIndicator color={C.red} />
                <Text style={s.rescueText}>{rescueStep}</Text>
              </View>
            ) : (
              <Pressable style={[s.rescueBtn, busy && { opacity: 0.5 }]} onPress={onRescue} disabled={busy}>
                <Text style={s.rescueBtnText}>رجّع الإعدادات الأصلية</Text>
              </Pressable>
            )}
          </View>
        )}

        {!loading && noNet && !noService && (
          <View style={[s.warnBanner, { backgroundColor: tBg('#e5484d14'), borderColor: tBd('#e5484d55') }]}>
            {lock && (lock.bands.length > 0 || !!lock.pci) ? (
              <Pressable style={[s.warnBtn, { backgroundColor: '#e5484d' }, busy && { opacity: 0.5 }]} onPress={onClearLock} disabled={busy}>
                <Text style={s.warnBtnText}>رجوع للتلقائي</Text>
              </Pressable>
            ) : feat.reboot ? (
              <Pressable style={[s.warnBtn, { backgroundColor: '#e5484d' }, busy && { opacity: 0.5 }]} onPress={onReboot} disabled={busy}>
                <Text style={s.warnBtnText}>أعد التشغيل</Text>
              </Pressable>
            ) : null}
            <Text style={s.warnText}>
              ⚠️ الإشارة موجودة لكن ما فيه إنترنت{'\n'}
              <Text style={{ fontWeight: '500', fontSize: 12 }}>
                {lock && (lock.bands.length > 0 || !!lock.pci)
                  ? 'غالباً من التثبيت — رجّع للتلقائي. ولو ما رجع: أعد تشغيل الراوتر أو شيّك على الباقة'
                  : 'غالباً الباقة خلصت أو جلسة البيانات علقت — أعد تشغيل الراوتر، ولو ما رجع شيّك على الباقة'}
              </Text>
            </Text>
          </View>
        )}

        {!loading && lock && (lock.bands.length > 0 || lock.pci) && (
          <View style={s.warnBanner}>
            <Pressable style={[s.warnBtn, busy && { opacity: 0.5 }]} onPress={onClearLock} disabled={busy}>
              <Text style={s.warnBtnText}>رجوع للتلقائي</Text>
            </Pressable>
            <Text style={s.warnText}>
              {lock.pci
                ? `مثبّت على برج PCI ${lock.pci}`
                : `مقفل على ${lock.bands.map(b => 'B' + b).join(' + ')}`}
              {' — '}قد يمنع 5G ويحد السرعة
            </Text>
          </View>
        )}

        {!loading && fourGOnly && (
          <View style={s.warnBanner}>
            <Pressable
              style={[s.warnBtn, busy && { opacity: 0.5 }]}
              onPress={onEnableAuto}
              disabled={busy}
            >
              <Text style={s.warnBtnText}>فعّل التلقائي</Text>
            </Pressable>
            <Text style={s.warnText}>
              الراوتر مضبوط على 4G فقط — ما بيلتقط 5G وهو كذا
            </Text>
          </View>
        )}

        {!loading && info && (
          <LinearGradient colors={[tBg('#2f6bff'), tBg('#6a4cff')]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.topBar}>
            <View style={[s.statusPill, { backgroundColor: tBg('#ffffff') }]}>
              <Text style={[s.statusText, { color: noService ? C.red : C.green }]}>
                {disconnected ? 'منقطع' : noService ? 'بلا شبكة' : 'متصل'}
              </Text>
              <View style={[s.statusDot, { backgroundColor: noService ? C.red : C.green }]} />
            </View>
            <View style={{ flex: 1 }} />
            <View style={{ flexShrink: 1 }}>
              <Text style={s.topName}>{info.name}</Text>
              <Text style={s.topSub}>{details?.operator ? `${details.operator}  ·  ` : ''}{hostLabel(info.host)}</Text>
            </View>
            <View style={s.topIcon}><Text style={{ fontSize: 18 }}>📡</Text></View>
          </LinearGradient>
        )}

        {!loading && info && (
          <LinearGradient colors={HERO_BG[noService ? 'poor' : level]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroX}>
            <ArcGauge score={signalScore(primary)} label={LEVEL_LABEL[level]} color={LEVEL_COLOR[level]} size={172} />
            <Text style={s.heroLine}>{disconnected ? 'الراوتر غير متصل' : noService ? 'الراوتر بلا شبكة' : noNet ? `إشارتك ${LEVEL_LABEL[level]} · بدون إنترنت` : `اتصالك ${LEVEL_LABEL[level]}`}</Text>
            {noService ? (
              <Text style={s.heroSub}>الأبراج طايحة — اضغط «رجّع الإشارة» تحت</Text>
            ) : (
              <>
                <Pressable style={s.heroBox} onPress={() => router.push(`/towers/${info.id}` as Href)}>
                  <View style={s.heroCell}>
                    <Text style={s.heroCellLbl}>البرج</Text>
                    <Text style={s.heroCellVal} numberOfLines={1}>{signal?.pci ?? signal?.nrPci ?? '—'}</Text>
                    {!!signal?.pci && !!signal?.nrPci && <Text style={s.heroCellSub}>5G: {signal.nrPci}</Text>}
                  </View>
                  <View style={s.heroDiv} />
                  <View style={s.heroCell}>
                    <Text style={s.heroCellLbl}>الدمج</Text>
                    <Text style={[s.heroCellVal, { color: caCount > 1 ? C.green : C.sub }]} numberOfLines={1}>
                      {caCount > 1 ? '🔗 مدموج' : caIdle ? '💤 جاهز' : '◻️ تردد واحد'}
                    </Text>
                    {caCount > 1 && <Text style={s.heroCellSub}>{caCount} نواقل{caBw ? ` · ${caBw}MHz` : ''}</Text>}
                    {caCount <= 1 && caIdle && lastCa && (
                      <Text style={s.heroCellSub} numberOfLines={1} adjustsFontSizeToFit>آخر دمج {lastCa.bands.join('+')}</Text>
                    )}
                  </View>
                  <View style={s.heroDiv} />
                  <View style={s.heroCell}>
                    <Text style={s.heroCellLbl}>الترددات</Text>
                    <Text style={s.heroCellVal} numberOfLines={1} adjustsFontSizeToFit>{allBands.length ? allBands.join(' + ') : '—'}</Text>
                    <Text style={s.heroCellSub}>{bands.length ? `الأساسي ${bands[0]}` : netLabel}</Text>
                  </View>
                </Pressable>
                {!!traffic && <Text style={s.heroSub}>السرعة الحين {fmtRate(traffic.downBytesPerSec)}</Text>}
              </>
            )}
            {!!traffic && traffic.connectedSecs > 0 && (
              <View style={s.sinceRow}>
                <SyncIcon active={syncing} />
                <Text style={s.sinceText}>متصل منذ {fmtDuration(traffic.connectedSecs)}</Text>
              </View>
            )}
          </LinearGradient>
        )}

        {!loading && info && (noService || !!rescueStep) && (
          rescueStep ? (
            <View style={[s.cta, s.freeBusy]}>
              <ActivityIndicator color={tFg('#fff')} />
              <Text style={[s.ctaText, { color: tFg('#fff') }]} numberOfLines={2}>{rescueStep}</Text>
            </View>
          ) : (
            <Pressable style={[s.cta, s.freeBtn, busy && { opacity: 0.6 }]} onPress={onFree} disabled={busy}>
              <Icon name="refresh" size={17} color={tFg('#fff')} />
              <Text style={[s.ctaText, { color: tFg('#fff') }]}>الأبراج طايحة — رجّع الإشارة</Text>
            </Pressable>
          )
        )}

        {!loading && signal && info && !noService && !rescueStep && (() => {
          const adv = buildAdvice(signal, [], { no5g: has5g === false });
          if (!adv.action) return null;
          const soft = level === 'excellent';
          return (
            <Pressable
              style={[s.cta, soft ? s.ctaSoft : s.ctaSolid]}
              onPress={() => router.push(`/${adv.action!.route}/${info.id}` as Href)}
            >
              <Icon name="spark" size={17} color={soft ? C.blue : C.onAccent} />
              <Text style={[s.ctaText, { color: soft ? C.blue : C.onAccent }]}>{adv.action.label}</Text>
            </Pressable>
          );
        })()}

        {!loading && info && (
          <>
            {feat.bands && <ModeChips r={info} onApplied={() => loadAll(info)} />}
            {feat.bands && <ComboCard r={info} />}
            <GroupTitle title="حسّن اتصالك" color={tFg('#2f6bff')} />
            <TileGrid>
              <ToolTile wide icon="aim" color={tFg('#2f6bff')} title="التوجيه" sub="لقّط أقوى إشارة"
                onPress={() => router.push(`/aim/${info.id}` as Href)} />
              <ToolTile wide icon="tower" color={tFg('#12b76a')} title="الأبراج" sub="النواقل والدمج"
                onPress={() => router.push(`/towers/${info.id}` as Href)} />
              <ToolTile wide icon="spark" color={tFg('#7c5cff')} title="أفضل تردد" sub="أسرع نت وأقل بنق"
                onPress={() => router.push(`/finder/${info.id}` as Href)} />
              <ToolTile wide icon="game" color={tFg('#ec4899')} title="مُحسّن الألعاب" sub="أقل بنق للعبتك"
                onPress={() => router.push(`/ping/${info.id}` as Href)} />
            </TileGrid>
            <GroupTitle title="قِس وتابع" color={tFg('#12b76a')} />
            <TileGrid>
              <ToolTile icon="speed" color={tFg('#12b76a')} title="السرعة" sub="تنزيل ورفع"
                onPress={() => router.push(`/speed/${info.id}` as Href)} />
              <ToolTile icon="antenna" color={tFg('#f97316')} title="الأنتنا" sub="تحتاجها؟"
                onPress={() => router.push(`/antenna/${info.id}` as Href)} />
              <ToolTile icon="chart" color={tFg('#0891b2')} title="التفاصيل" sub="كل الأرقام"
                onPress={() => router.push(`/details/${info.id}` as Href)} />
              <ToolTile icon="phone" color={tFg('#8b5cf6')} title="الأجهزة" sub="المتصلين"
                onPress={() => router.push(`/device/${info.id}` as Href)} />
              <ToolTile icon="pin" color={tFg('#0ea5a4')} title="الأماكن" sub="وين أحط الراوتر؟"
                onPress={() => router.push(`/places/${info.id}` as Href)} />
              <ToolTile icon="report" color={tFg('#64748b')} title="التقرير" sub="شاركه بصورة"
                onPress={() => router.push(`/report/${info.id}` as Href)} />
            </TileGrid>
          </>
        )}

        {!loading && info && (
          <View style={s.moreCard}>
            <GroupTitle title="إعدادات وأدوات" color={tFg('#f97316')} />
            <View style={s.moreGrid}>
              {info.driverId !== 'device' && (
                <Pressable style={[s.moreTile, { backgroundColor: tBg('#2f6bff12'), borderColor: tBd('#2f6bff30') }]} onPress={() => router.push(`/wifi/${info.id}` as Href)}>
                  <View style={[s.moreIcon, { backgroundColor: tBg('#2f6bff') }]}>
                    <Icon name="wifi" size={18} color={tFg('#fff')} />
                  </View>
                  <Text style={s.moreLbl}>شارك الواي فاي</Text>
                </Pressable>
              )}
              {feat.sms && (
                <Pressable style={[s.moreTile, { backgroundColor: tBg('#16a34a12'), borderColor: tBd('#16a34a30') }]} onPress={() => router.push(`/sms/${info.id}` as Href)}>
                  <View style={[s.moreIcon, { backgroundColor: tBg('#16a34a') }]}>
                    <Icon name="sms" size={18} color={tFg('#fff')} />
                  </View>
                  <Text style={s.moreLbl}>الرسائل</Text>
                </Pressable>
              )}
              {feat.network && (
                <Pressable style={[s.moreTile, { backgroundColor: tBg('#0891b212'), borderColor: tBd('#0891b230') }]} onPress={() => router.push(`/network/${info.id}` as Href)}>
                  <View style={[s.moreIcon, { backgroundColor: tBg('#0891b2') }]}>
                    <Icon name="settings" size={18} color={tFg('#fff')} />
                  </View>
                  <Text style={s.moreLbl}>الشبكة</Text>
                </Pressable>
              )}
              <Pressable style={[s.moreTile, { backgroundColor: tBg('#a1620712'), borderColor: tBd('#a1620730') }]} onPress={() => router.push(`/profiles/${info.id}` as Href)}>
                <View style={[s.moreIcon, { backgroundColor: tBg('#a16207') }]}>
                  <Icon name="folder" size={18} color={tFg('#fff')} />
                </View>
                <Text style={s.moreLbl}>الملفات</Text>
              </Pressable>
              {feat.bands && (
                <>
                <Pressable style={[s.moreTile, { backgroundColor: tBg('#7c5cff12'), borderColor: tBd('#7c5cff30') }]} onPress={() => router.push(`/auto/${info.id}` as Href)}>
                  <View style={[s.moreIcon, { backgroundColor: tBg('#7c5cff') }]}>
                    <Icon name="spark" size={18} color={tFg('#fff')} />
                  </View>
                  <Text style={s.moreLbl}>الوضع الذكي</Text>
                </Pressable>
                </>
              )}
              <Pressable style={[s.moreTile, { backgroundColor: tBg('#f43f5e12'), borderColor: tBd('#f43f5e30') }]} onPress={() => router.push('/monitor' as Href)}>
                <View style={[s.moreIcon, { backgroundColor: tBg('#f43f5e') }]}>
                  <Icon name="bell" size={18} color={tFg('#fff')} />
                </View>
                <Text style={s.moreLbl}>المراقبة</Text>
              </Pressable>
              {feat.reboot && (
                <Pressable style={[s.moreTile, { backgroundColor: tBg('#e5484d12'), borderColor: tBd('#e5484d30') }]} onPress={onReboot}>
                  <View style={[s.moreIcon, { backgroundColor: tBg('#e5484d') }]}>
                    <Icon name="power" size={18} color={tFg('#fff')} />
                  </View>
                  <Text style={s.moreLbl}>إعادة التشغيل</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {!loading && info && (
          <Pressable
            onPress={() => router.push(`/add-router?id=${info.id}` as Href)}
            style={s.editBtn}
            accessibilityRole="button"
            accessibilityLabel="تعديل الراوتر"
          >
            <Icon name="user" size={16} color={C.blue} />
            <Text style={s.editBtnText}>تعديل الراوتر</Text>
          </Pressable>
        )}
        {!loading && info && (
          <Pressable onPress={onDelete}>
            <Text style={s.deleteText}>حذف الراوتر من التطبيق</Text>
          </Pressable>
        )}

        <StoreAd />
      </ScrollView>

    </LinearGradient>
  );
}

const s = StyleSheet.create({
  moveBar: { backgroundColor: C.blueSoft, borderColor: C.blue, borderWidth: 1, borderRadius: 14, padding: 12 },
  moveText: { color: C.blue, fontWeight: '800', fontSize: 13, textAlign: 'right', lineHeight: 20 },
  page: { padding: 13, gap: 10 },
  center: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  muted: { color: C.sub, textAlign: 'center' },
  hint: { color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  rescueCard: { backgroundColor: C.card, borderColor: C.red, borderWidth: 1.5, borderRadius: 16, padding: 14, gap: 8 },
  rescueTitle: { color: C.red, fontWeight: '900', fontSize: 15, textAlign: 'right' },
  rescueText: { color: C.text, fontWeight: '600', fontSize: 13, lineHeight: 20, textAlign: 'right' },
  rescueBusy: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  rescueBtn: { backgroundColor: C.red, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  rescueBtnText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  errorCard: { backgroundColor: C.redSoft, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: 16, padding: 14, gap: 10 },
  errorText: { color: C.red, fontWeight: '700', textAlign: 'right' },
  retryBtn: { alignSelf: 'flex-end', backgroundColor: C.red, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8 },
  retryText: { color: tFg('#fff'), fontWeight: '700' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 22, padding: 14,
    shadowColor: '#2f6bff', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5,
  },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1 },
  statusOn: { backgroundColor: C.greenSoft, borderColor: C.cardBorder },
  statusOff: { backgroundColor: C.redSoft, borderColor: C.cardBorder },
  statusText: { fontWeight: '800', fontSize: 13 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  topName: { color: tFg('#fff'), fontSize: 17, fontWeight: '800', textAlign: 'right' },
  topSub: { color: tFg('rgba(255,255,255,0.8)'), fontSize: 12, textAlign: 'right', marginTop: 2 },
  topIcon: {
    width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: tBg('rgba(255,255,255,0.2)'), borderWidth: 1, borderColor: tBd('rgba(255,255,255,0.35)'),
  },
  heroHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  netBadge: { backgroundColor: C.blueSoft, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 11 },
  netBadgeText: { color: C.blue, fontWeight: '800', fontSize: 12 },
  heroCenter: { alignItems: 'center', marginTop: 2, marginBottom: 4 },
  heroStats: { flexDirection: 'row-reverse', gap: 8 },
  stat: { flex: 1, backgroundColor: C.rowBg, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 1 },
  statLabel: { color: C.muted, fontSize: 11, fontWeight: '600' },
  statVal: { color: C.text, fontSize: 19, fontWeight: '800' },
  statUnit: { color: C.muted, fontSize: 10.5, fontWeight: '600' },
  rateLabel: { color: C.muted, fontSize: 10.5, fontWeight: '600' },
  heroSinceC: { color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 8 },
  sideRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  sideTxt: { flex: 1, alignItems: 'flex-end' },
  sideHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  sideIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sideIconSm: { width: 24, height: 24, borderRadius: 12 },
  bandChips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 4, marginVertical: 5, alignSelf: 'stretch' },
  bandChip: { backgroundColor: C.blueSoft, borderRadius: 14, paddingHorizontal: 6, paddingVertical: 2 },
  bandChipText: { color: C.blue, fontWeight: '800', fontSize: 12.5 },
  heroX: { borderRadius: 26, padding: 18, gap: 6, borderWidth: 1, borderColor: tBd('#ffffff'), alignItems: 'center', shadowColor: C.shadow, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  heroMain: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  heroSide: { flex: 1, gap: 8, alignItems: 'stretch' },
  heroGauge: { alignItems: 'center', justifyContent: 'center' },
  sideCard: { backgroundColor: tBg('rgba(255,255,255,0.85)'), borderRadius: 16, paddingVertical: 9, paddingHorizontal: 10, alignItems: 'flex-end' },
  sideLabel: { color: C.sub, fontSize: 11, fontWeight: '600' },
  sideVal: { fontSize: 22, fontWeight: '800', marginTop: 1 },
  sideUnit: { color: C.muted, fontSize: 10.5, fontWeight: '600' },
  bandsVal: { color: C.text, fontSize: 14, fontWeight: '800', marginTop: 2, textAlign: 'right' },
  netBig: { borderRadius: 18, paddingVertical: 9, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6 },
  netBigText: { color: tFg('#fff'), fontSize: 22, fontWeight: '800' },
  netCaption: { color: C.sub, fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: -4 },
  statsRow: { flexDirection: 'row-reverse', gap: 8, backgroundColor: tBg('rgba(255,255,255,0.9)'), borderRadius: 18, padding: 8 },
  statItem: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 7 },
  statIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  statText: { flex: 1, alignItems: 'flex-end' },
  statLbl: { color: C.muted, fontSize: 10.5, fontWeight: '600' },
  statNum: { fontSize: 14, fontWeight: '800' },
  sinceRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: -4 },
  sinceText: { color: C.muted, fontSize: 11 },
  heroRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  heroInfo: { flex: 1, alignItems: 'flex-end', gap: 7 },
  heroTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, alignSelf: 'stretch', justifyContent: 'flex-start' },
  heroCaption: { color: C.sub, fontWeight: '700', fontSize: 12.5, flex: 1, textAlign: 'right' },
  heroMetric: { color: C.text, fontWeight: '800', fontSize: 19, textAlign: 'right' },
  heroUnit: { color: C.muted, fontWeight: '600', fontSize: 11 },
  heroSince: { color: C.muted, fontSize: 10.5, textAlign: 'right' },
  gaugeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  caption: { color: C.sub, fontWeight: '700', textAlign: 'right', flex: 1 },
  chips: { flexDirection: 'row-reverse', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-start' },
  chip: { backgroundColor: C.blueSoft, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 3 },
  chipText: { color: C.blue, fontWeight: '800' },
  chipNr: { backgroundColor: C.violetSoft, borderColor: C.cardBorder },
  nrBlock: { borderTopWidth: 1, borderTopColor: C.cardBorder, paddingTop: 10, gap: 10, marginTop: 2 },
  nrTitle: { color: C.violet, fontWeight: '800', textAlign: 'right' },
  warnBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.goldSoft, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: 16, padding: 12 },
  warnText: { flex: 1, color: C.text, fontWeight: '700', textAlign: 'right', fontSize: 13 },
  warnBtn: { backgroundColor: C.gold, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8 },
  warnBtnText: { color: tFg('#fff'), fontWeight: '800', fontSize: 12 },
  rates: { flexDirection: 'row-reverse', gap: 8, marginTop: 10 },
  rate: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, paddingVertical: 9 },
  rateArrow: { fontSize: 18, fontWeight: '800' },
  rateVal: { color: C.text, fontWeight: '800', fontSize: 14 },
  freeBtn: { backgroundColor: tBg('#e5484d') },
  freeBusy: { backgroundColor: tBg('#e5484d'), opacity: 0.85 },
  adviceCard: {
    backgroundColor: C.card, borderRadius: 18, borderWidth: 1.5, borderColor: C.cardBorder,
    padding: 14, gap: 11,
  },
  adviceHead: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 9 },
  adviceIcon: {
    width: 26, height: 26, borderRadius: 9, backgroundColor: C.blueSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  adviceLabel: { color: C.muted, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  adviceText: { color: C.text, fontSize: 12.5, lineHeight: 21, textAlign: 'right', marginTop: 2 },
  adviceBtn: {
    backgroundColor: C.blue, borderRadius: 13, paddingVertical: 11, paddingHorizontal: 14,
    flexDirection: 'row-reverse', alignItems: 'center', gap: 9,
  },
  adviceBtnText: { flex: 1, color: C.onAccent, fontWeight: '800', fontSize: 13.5, textAlign: 'right' },
  adviceHint: { color: tFg('#cfe0ff'), fontSize: 11, fontWeight: '700' },
  tiles: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexBasis: '31%', flexGrow: 1, backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5,
    borderRadius: 15, paddingVertical: 11, paddingHorizontal: 7, alignItems: 'center', gap: 3,
  },
  tileIconBox: { width: 30, height: 30, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  tileIcon: { fontSize: 16 },
  tileTitle: { color: C.text, fontWeight: '700', fontSize: 11.5, textAlign: 'center' },
  tileSub: { color: C.muted, fontSize: 9.5, textAlign: 'center' },
  pillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pillBox: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: C.rowBg, borderRadius: 14,
    borderWidth: 1.5, borderColor: C.cardBorder, padding: 10, gap: 6,
  },
  pillHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  pillIcon: { fontSize: 13 },
  pillLabel: { color: C.muted, fontSize: 10, fontWeight: '800' },
  pillValue: { color: C.text, fontWeight: '700', fontSize: 13, textAlign: 'right' },
  pill: { borderRadius: 999, borderWidth: 1.5, borderColor: C.cardBorder, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.rowBg },
  pillOn: { backgroundColor: C.blue, borderColor: C.blue },
  pillText: { color: C.sub, fontSize: 12, fontWeight: '800' },
  advanced: { gap: 10, borderTopWidth: 1, borderTopColor: C.cardBorder, paddingTop: 12 },
  metric: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  metricVal: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricNum: { color: C.text, fontWeight: '700' },
  metricLabel: { color: C.sub, textAlign: 'right' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  speedRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  speedBox: { flex: 1, alignItems: 'center', borderRadius: 16, paddingVertical: 12 },
  speedVal: { fontSize: 24, fontWeight: '800' },
  speedUnit: { color: C.sub, fontSize: 11 },
  speedLabel: { color: C.muted, fontWeight: '800', fontSize: 10, marginTop: 4 },
  planWrap: { borderTopWidth: 1, borderTopColor: C.cardBorder, paddingTop: 12, gap: 8 },
  planHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planTitle: { color: C.text, fontWeight: '800', textAlign: 'right' },
  planPct: { fontWeight: '800', fontSize: 16 },
  barBg: { height: 10, borderRadius: 5, backgroundColor: C.track, overflow: 'hidden' },
  bar: { height: 10, borderRadius: 5 },
  planRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' },
  planChip: { borderWidth: 1.5, borderColor: C.cardBorder, backgroundColor: C.rowBg, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7 },
  planChipOn: { backgroundColor: C.blue, borderColor: C.blue },
  planChipText: { color: C.text, fontWeight: '700', fontSize: 12 },
  blockedWrap: { borderTopWidth: 1, borderTopColor: C.cardBorder, paddingTop: 12, gap: 8 },
  blockedTitle: { color: C.red, fontWeight: '800', textAlign: 'right' },
  blockedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.redSoft, borderRadius: 14, padding: 10 },
  blockedName: { color: C.text, fontWeight: '800', textAlign: 'right' },
  blockedMac: { color: C.sub, fontSize: 11, textAlign: 'right' },
  unblockBtn: { borderColor: C.green, borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
  unblockText: { color: C.green, fontWeight: '800', fontSize: 12 },
  editBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.blueSoft,
    backgroundColor: tBg('rgba(255,255,255,0.8)'),
    marginTop: 6,
  },
  editBtnText: { color: C.blue, fontWeight: '800', fontSize: 14 },
  groupTitle: { color: C.sub, fontSize: 13, fontWeight: '800', textAlign: 'right', marginTop: 6, marginBottom: -4, paddingHorizontal: 4 },
  moreCard: {
    backgroundColor: tBg('rgba(255,255,255,0.75)'), borderRadius: 22, padding: 12,
    borderWidth: 1, borderColor: tBd('#ffffff'), gap: 10,
  },
  moreHead: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
    paddingBottom: 6,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  moreTitle: { color: C.sub, fontSize: 13, fontWeight: '800' },
  moreGrid: {
    flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8,
  },
  moreTile: {
    flexBasis: '31%', flexGrow: 1,
    alignItems: 'center', gap: 6,
    backgroundColor: C.card,
    borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 6,
    borderWidth: 1, borderColor: tBd('#DCE6F5'),
  },
  moreIcon: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  moreLbl: { color: C.text, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  deleteText: { color: C.red, textAlign: 'center', paddingVertical: 10, opacity: 0.85 },
  fabs: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  fab: {
    flexDirection: 'row-reverse', gap: 7,
    flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 18,
    backgroundColor: C.card, borderWidth: 1.5, borderColor: C.cardBorder,
    shadowColor: C.shadow, shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  fabDanger: { borderColor: C.cardBorder },
  fabText: { fontWeight: '800', fontSize: 15 },
  heroLine: { color: C.text, fontSize: 18, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  heroBox: { flexDirection: 'row-reverse', alignSelf: 'stretch', backgroundColor: tBg('#ffffffb3'), borderRadius: 18, borderWidth: 1, borderColor: tBd('#ffffff'), paddingVertical: 10, paddingHorizontal: 6, marginTop: 6 },
  heroCell: { flex: 1, alignItems: 'center', gap: 2, minWidth: 0 },
  heroDiv: { width: 1, backgroundColor: C.line, marginVertical: 4 },
  heroCellLbl: { color: C.muted, fontSize: 11, fontWeight: '700' },
  heroCellVal: { color: C.text, fontSize: 15, fontWeight: '900' },
  heroCellSub: { color: C.sub, fontSize: 10.5, fontWeight: '700' },
  heroSub: { color: C.sub, fontSize: 12.5, fontWeight: '700', textAlign: 'center', marginTop: 1 },
  cta: { height: 54, borderRadius: 16, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 9 },
  ctaSolid: { backgroundColor: C.blue },
  ctaSoft: { backgroundColor: C.blueSoft },
  ctaText: { fontWeight: '800', fontSize: 15.5 },
  acc: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1.5, borderColor: C.cardBorder, overflow: 'hidden' },
  accHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 15 },
  accTitle: { color: C.text, fontWeight: '800', fontSize: 14.5, textAlign: 'right' },
  accBody: { paddingHorizontal: 12, paddingBottom: 14, paddingTop: 2, gap: 10, borderTopWidth: 1, borderTopColor: C.line },
  grp: { color: C.sub, fontSize: 12, fontWeight: '800', textAlign: 'right', marginTop: 6, marginBottom: -2 },
});
