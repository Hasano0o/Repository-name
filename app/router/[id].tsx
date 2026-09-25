import { useCallback, useRef, useState, ReactNode } from 'react';
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
  rsrpLevel, rsrqLevel, sinrLevel, rssiLevel,
} from '../../src/utils/signal';
import { fmtRate, fmtDuration, fmtBytes } from '../../src/utils/format';
import {addSample, stability } from '../../src/store/history';
import { C } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import { SignalRing } from '../../src/ui/SignalRing';
import { ArcGauge } from '../../src/ui/ArcGauge';
import { RadarPoint } from '../../src/ui/SignalRadar';
import { MetricRings, RingSpec } from '../../src/ui/MetricRing';
import { Icon, IconName } from '../../src/ui/Icon';
import { HeroCard, MetricCard, Section, TileGrid, ToolTile } from '../../src/ui/Cards';
import { buildAdvice } from '../../src/utils/advice';
import { linkHealth } from '../../src/utils/linkHealth';
import { LinkHealthCard } from '../../src/ui/LinkHealth';
import { CongestionCard } from '../../src/ui/Congestion';
import { DiagnosisCard } from '../../src/ui/Diagnosis';
import { UsageRing } from '../../src/ui/UsageRing';
import { DeviceRow } from '../../src/ui/DeviceRow';
import { SyncIcon } from '../../src/ui/SyncIcon';

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
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [applySignal]);

  const poll = useCallback(async (r: SavedRouter) => {
    if (polling.current) return;
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
              else if (d.setBand) await d.setBand([], []);
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
  const primary = hasNr && signal
    ? { rsrp: signal.nrRsrp, sinr: signal.nrSinr }
    : { rsrp: signal?.rsrp, sinr: signal?.sinr };
  const level = overallLevel(signal ? primary : null);
  const nrIdle = !hasNr && !!signal?.nrAvailable;
  const netLabel = hasNr
    ? (bands.length ? '5G NSA' : '5G')
    : (bands.length > 1 ? '4G+' : signal?.network ?? '4G LTE') + (nrIdle ? ' · 5G متاح' : '');
  const disconnected = online === false;
  // التنبيه يطلع بس لراوتر يدعم 5G ومقفول على 4G — راوتر 4G فقط ما نزعجه
  const fourGOnly = mode === '03' && has5g !== false;

  return (
    <LinearGradient
      colors={error || disconnected ? [C.dangerTop, C.dangerBottom] : [C.bgTop, C.bgBottom]}
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
          <View style={s.topBar}>
            <View style={[s.statusPill, disconnected ? s.statusOff : s.statusOn]}>
              <Text style={[s.statusText, { color: disconnected ? C.red : C.green }]}>
                {disconnected ? 'منقطع' : 'متصل'}
              </Text>
              <View style={[s.statusDot, { backgroundColor: disconnected ? C.red : C.green }]} />
            </View>
            <View style={{ flex: 1 }} />
            <View style={{ flexShrink: 1 }}>
              <Text style={s.topName}>{info.name}</Text>
              <Text style={s.topSub}>{details?.operator ? `${details.operator}  ·  ` : ''}{info.host}</Text>
            </View>
            <View style={s.topIcon}><Text style={{ fontSize: 18 }}>📡</Text></View>
          </View>
        )}

        {!loading && info && (
          <LinearGradient colors={['#f4f8ff', '#e9f2ff', '#e8f8f1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroX}>
            <ArcGauge score={signalScore(primary)} label={LEVEL_LABEL[level]} color={LEVEL_COLOR[level]} size={172} />
            <Text style={s.heroLine}>{disconnected ? 'الراوتر غير متصل' : `اتصالك ${LEVEL_LABEL[level]}`}</Text>
            <Text style={s.heroSub}>
              {disconnected
                ? 'ما فيه إشارة الآن'
                : `${netLabel}${allBands.length ? '  ·  ' + allBands.join(' + ') : ''}${traffic ? '  ·  ' + fmtRate(traffic.downBytesPerSec) : ''}`}
            </Text>
            {!!traffic && traffic.connectedSecs > 0 && (
              <View style={s.sinceRow}>
                <SyncIcon active={syncing} />
                <Text style={s.sinceText}>متصل منذ {fmtDuration(traffic.connectedSecs)}</Text>
              </View>
            )}
          </LinearGradient>
        )}

        {!loading && signal && info && (() => {
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
            <Text style={s.groupTitle}>حسّن اتصالك</Text>
            <TileGrid>
              <ToolTile wide icon="aim" color="#2f6bff" title="التوجيه" sub="لقّط أقوى إشارة"
                onPress={() => router.push(`/aim/${info.id}` as Href)} />
              <ToolTile wide icon="tower" color="#12b76a" title="الأبراج" sub="النواقل والدمج"
                onPress={() => router.push(`/towers/${info.id}` as Href)} />
              <ToolTile wide icon="spark" color="#7c5cff" title="أفضل تردد" sub="أسرع نت وأقل بنق"
                onPress={() => router.push(`/finder/${info.id}` as Href)} />
              <ToolTile wide icon="antenna" color="#f97316" title="الأنتنا" sub="تحتاجها؟ وأي نوع"
                onPress={() => router.push(`/antenna/${info.id}` as Href)} />
            </TileGrid>
            <Text style={s.groupTitle}>قِس وتابع</Text>
            <TileGrid>
              <ToolTile icon="speed" color="#12b76a" title="السرعة" sub="تنزيل ورفع"
                onPress={() => router.push(`/speed/${info.id}` as Href)} />
              <ToolTile icon="game" color="#ec4899" title="البنق" sub="للألعاب"
                onPress={() => router.push(`/ping/${info.id}` as Href)} />
              <ToolTile icon="chart" color="#0891b2" title="التفاصيل" sub="كل الأرقام"
                onPress={() => router.push(`/details/${info.id}` as Href)} />
              <ToolTile icon="phone" color="#8b5cf6" title="الأجهزة" sub="المتصلين"
                onPress={() => router.push(`/device/${info.id}` as Href)} />
              <ToolTile icon="pin" color="#0ea5a4" title="الأماكن" sub="وين أحط الراوتر؟"
                onPress={() => router.push(`/places/${info.id}` as Href)} />
              <ToolTile icon="report" color="#64748b" title="التقرير" sub="شاركه بصورة"
                onPress={() => router.push(`/report/${info.id}` as Href)} />
            </TileGrid>
          </>
        )}

        {!loading && info && (
          <View style={s.moreCard}>
            <View style={s.moreHead}>
              <Icon name="layers" size={16} color={C.sub} />
              <Text style={s.moreTitle}>إعدادات وأدوات</Text>
            </View>
            <View style={s.moreGrid}>
              {feat.sms && (
                <Pressable style={s.moreTile} onPress={() => router.push(`/sms/${info.id}` as Href)}>
                  <View style={[s.moreIcon, { backgroundColor: '#16a34a18' }]}>
                    <Icon name="sms" size={18} color="#16a34a" />
                  </View>
                  <Text style={s.moreLbl}>الرسائل</Text>
                </Pressable>
              )}
              {feat.network && (
                <Pressable style={s.moreTile} onPress={() => router.push(`/network/${info.id}` as Href)}>
                  <View style={[s.moreIcon, { backgroundColor: '#0891b218' }]}>
                    <Icon name="settings" size={18} color="#0891b2" />
                  </View>
                  <Text style={s.moreLbl}>الشبكة</Text>
                </Pressable>
              )}
              <Pressable style={s.moreTile} onPress={() => router.push(`/profiles/${info.id}` as Href)}>
                <View style={[s.moreIcon, { backgroundColor: '#a1620718' }]}>
                  <Icon name="folder" size={18} color="#a16207" />
                </View>
                <Text style={s.moreLbl}>الملفات</Text>
              </Pressable>
              <Pressable style={s.moreTile} onPress={() => router.push('/monitor' as Href)}>
                <View style={[s.moreIcon, { backgroundColor: '#f43f5e18' }]}>
                  <Icon name="bell" size={18} color="#f43f5e" />
                </View>
                <Text style={s.moreLbl}>المراقبة</Text>
              </Pressable>
              {feat.reboot && (
                <Pressable style={s.moreTile} onPress={onReboot}>
                  <View style={[s.moreIcon, { backgroundColor: '#e5484d18' }]}>
                    <Icon name="power" size={18} color="#e5484d" />
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
  errorCard: { backgroundColor: C.redSoft, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  errorText: { color: C.red, fontWeight: '700', textAlign: 'right' },
  retryBtn: { alignSelf: 'flex-end', backgroundColor: C.red, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  retryText: { color: '#fff', fontWeight: '700' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card,
    borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 12,
  },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1 },
  statusOn: { backgroundColor: C.greenSoft, borderColor: C.cardBorder },
  statusOff: { backgroundColor: C.redSoft, borderColor: C.cardBorder },
  statusText: { fontWeight: '800', fontSize: 13 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  topName: { color: C.text, fontSize: 17, fontWeight: '800', textAlign: 'right' },
  topSub: { color: C.sub, fontSize: 12, textAlign: 'right', marginTop: 2 },
  topIcon: {
    width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.blueSoft, borderWidth: 1, borderColor: C.cardBorder,
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
  bandChip: { backgroundColor: C.blueSoft, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  bandChipText: { color: C.blue, fontWeight: '800', fontSize: 12.5 },
  heroX: { borderRadius: 24, padding: 16, gap: 6, borderWidth: 1, borderColor: '#e3ecff', alignItems: 'center' },
  heroMain: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  heroSide: { flex: 1, gap: 8, alignItems: 'stretch' },
  heroGauge: { alignItems: 'center', justifyContent: 'center' },
  sideCard: { backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 16, paddingVertical: 9, paddingHorizontal: 10, alignItems: 'flex-end' },
  sideLabel: { color: C.sub, fontSize: 11, fontWeight: '600' },
  sideVal: { fontSize: 22, fontWeight: '800', marginTop: 1 },
  sideUnit: { color: C.muted, fontSize: 10.5, fontWeight: '600' },
  bandsVal: { color: C.text, fontSize: 14, fontWeight: '800', marginTop: 2, textAlign: 'right' },
  netBig: { borderRadius: 18, paddingVertical: 9, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6 },
  netBigText: { color: '#fff', fontSize: 22, fontWeight: '800' },
  netCaption: { color: C.sub, fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: -4 },
  statsRow: { flexDirection: 'row-reverse', gap: 8, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 18, padding: 8 },
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
  warnBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.goldSoft, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 16, padding: 12 },
  warnText: { flex: 1, color: C.text, fontWeight: '700', textAlign: 'right', fontSize: 13 },
  warnBtn: { backgroundColor: C.gold, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  warnBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  rates: { flexDirection: 'row-reverse', gap: 8, marginTop: 10 },
  rate: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, paddingVertical: 9 },
  rateArrow: { fontSize: 18, fontWeight: '800' },
  rateVal: { color: C.text, fontWeight: '800', fontSize: 14 },
  adviceCard: {
    backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder,
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
  adviceHint: { color: '#cfe0ff', fontSize: 11, fontWeight: '700' },
  tiles: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexBasis: '31%', flexGrow: 1, backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1,
    borderRadius: 15, paddingVertical: 11, paddingHorizontal: 7, alignItems: 'center', gap: 3,
  },
  tileIconBox: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  tileIcon: { fontSize: 16 },
  tileTitle: { color: C.text, fontWeight: '700', fontSize: 11.5, textAlign: 'center' },
  tileSub: { color: C.muted, fontSize: 9.5, textAlign: 'center' },
  pillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pillBox: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: C.rowBg, borderRadius: 14,
    borderWidth: 1, borderColor: C.cardBorder, padding: 10, gap: 6,
  },
  pillHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  pillIcon: { fontSize: 13 },
  pillLabel: { color: C.muted, fontSize: 10, fontWeight: '800' },
  pillValue: { color: C.text, fontWeight: '700', fontSize: 13, textAlign: 'right' },
  pill: { borderRadius: 999, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.rowBg },
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
  planChip: { borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.rowBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  planChipOn: { backgroundColor: C.blue, borderColor: C.blue },
  planChipText: { color: C.text, fontWeight: '700', fontSize: 12 },
  blockedWrap: { borderTopWidth: 1, borderTopColor: C.cardBorder, paddingTop: 12, gap: 8 },
  blockedTitle: { color: C.red, fontWeight: '800', textAlign: 'right' },
  blockedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.redSoft, borderRadius: 14, padding: 10 },
  blockedName: { color: C.text, fontWeight: '800', textAlign: 'right' },
  blockedMac: { color: C.sub, fontSize: 11, textAlign: 'right' },
  unblockBtn: { borderColor: C.green, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
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
    backgroundColor: C.card,
    marginTop: 6,
  },
  editBtnText: { color: C.blue, fontWeight: '800', fontSize: 14 },
  groupTitle: { color: C.sub, fontSize: 13, fontWeight: '800', textAlign: 'right', marginTop: 6, marginBottom: -4, paddingHorizontal: 4 },
  moreCard: {
    backgroundColor: C.card, borderRadius: 20, padding: 14,
    borderWidth: 1, borderColor: C.cardBorder, gap: 10,
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
    borderWidth: 1.5, borderColor: '#DCE6F5',
  },
  moreIcon: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  moreLbl: { color: C.text, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  deleteText: { color: C.red, textAlign: 'center', paddingVertical: 10, opacity: 0.85 },
  fabs: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  fab: {
    flexDirection: 'row-reverse', gap: 7,
    flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 18,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder,
    shadowColor: C.shadow, shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  fabDanger: { borderColor: C.cardBorder },
  fabText: { fontWeight: '800', fontSize: 15 },
  heroLine: { color: C.text, fontSize: 18, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  heroSub: { color: C.sub, fontSize: 12.5, fontWeight: '700', textAlign: 'center', marginTop: 1 },
  cta: { height: 54, borderRadius: 16, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 9 },
  ctaSolid: { backgroundColor: C.blue },
  ctaSoft: { backgroundColor: C.blueSoft },
  ctaText: { fontWeight: '800', fontSize: 15.5 },
  acc: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' },
  accHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 15 },
  accTitle: { color: C.text, fontWeight: '800', fontSize: 14.5, textAlign: 'right' },
  accBody: { paddingHorizontal: 12, paddingBottom: 14, paddingTop: 2, gap: 10, borderTopWidth: 1, borderTopColor: C.line },
  grp: { color: C.sub, fontSize: 12, fontWeight: '800', textAlign: 'right', marginTop: 6, marginBottom: -2 },
});
