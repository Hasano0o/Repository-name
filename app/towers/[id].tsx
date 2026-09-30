import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet, RefreshControl, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { CellTower, CellLockState, BandConfig } from '../../src/drivers/types';
import { LEVEL_COLOR, LEVEL_LABEL, LEVEL_SOFT, overallLevel } from '../../src/utils/signal';
import { towerKey, towerTitle } from '../../src/utils/cells';
import {
  TowerGroup, groupTowers, loadConfirmed, rememberActive, rankScore, cellGrade, cellQuality,
  GRADE_LABEL, GRADE_COLOR, BADGE_LABEL, isLowBand, bandName, freqName,
} from '../../src/utils/towers';
import { C, tBd, tBg, tFg } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import { trafficBurst, collectNr, mb } from '../../src/utils/nrprobe';
import { safeApply, lastTrial, trialNote, trialMessage, loadTrials } from '../../src/utils/safeLock';
import { SeenCell, rememberSeen, seenKey } from '../../src/store/seenCells';
import { ManualLock, ManualTarget } from '../../src/ui/ManualLock';
import { bandLabel } from '../../src/utils/bands';

const BADGE_BG: Record<TowerGroup['badge'], string> = {
  active: tBg('#e8f8f0'), confirmed: tBg('#e8f8f0'), likely: tBg('#eaf0ff'), single: tBg('#f3f4fb'),
};
const BADGE_FG: Record<TowerGroup['badge'], string> = {
  active: '#12b76a', confirmed: '#12b76a', likely: '#2f6bff', single: '#6b7291',
};
const ROLE_LABEL: Record<TowerGroup['role'], string> = {
  primary: 'البرج الأساسي',
  helper: 'مساعد (مدموج)',
  neighbor: 'مجاور',
};

/** شريط الجودة ٠–١ */
function QualityBar({ q, color }: { q?: number; color: string }) {
  const w = q === undefined ? 0 : Math.max(0.04, Math.min(1, q));
  return (
    <View style={s.qTrack}>
      <View style={[s.qFill, { width: `${Math.round(w * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

function Chip({ label, value, color }: { label: string; value?: number; color?: string }) {
  return (
    <View style={s.chip}>
      <Text style={s.chipLabel}>{label}</Text>
      <Text style={[s.chipVal, color ? { color } : null]}>{value !== undefined ? value : '—'}</Text>
    </View>
  );
}

/** بطاقة برج واحد — مضغوطة: سطر العنوان + شريط الجودة + سطر القيم وزر التثبيت */
function TowerGroupCard({ g, rank, lockedHere, canPin, busy, onLock, onCopy, note }: {
  g: TowerGroup; rank?: number; lockedHere: boolean; canPin: boolean; busy: boolean;
  onLock: (g: TowerGroup) => void; onCopy?: (g: TowerGroup) => void; note?: { text: string; ok: boolean };
}) {
  const copyable = !!onCopy && canPin && !!g.pci && g.cells.some(c => !!c.arfcn);
  const gr = cellGrade(g.best);
  const color = GRADE_COLOR[gr];
  const freq = freqName(g.best);
  const bands = g.cells.length > 1
    ? g.cells.map(c => bandName(c)).filter((x, i, a) => a.indexOf(x) === i).join(' + ')
    : `${bandName(g.best)}${freq ? ` · ${freq}` : ''}`;

  return (
    <View style={[s.tower, g.inUse && s.towerInUse, lockedHere && s.towerLocked]}>
      <View style={s.head}>
        <View style={[s.avatar, { backgroundColor: LEVEL_SOFT[gr] }]}>
          <Text style={[s.avatarRank, { color }]}>
            {lockedHere ? '📌' : rank !== undefined ? rank : g.tech === 'NR' ? '5G' : '4G'}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.titleRow}>
            <Text style={s.towerName} numberOfLines={1}>{g.pci ? `برج ${g.pci}` : 'برج بدون رقم'}</Text>
            <View style={[s.techTag, g.tech === 'NR' && { backgroundColor: C.violet }]}>
              <Text style={s.techTagText}>{g.tech === 'NR' ? '5G' : '4G'}</Text>
            </View>
          </View>
          <Text style={s.role} numberOfLines={1}>
            {bands}{g.role !== 'neighbor' ? ` · ${ROLE_LABEL[g.role]}` : ''}{isLowBand(g.best) ? ' · تردد بعيد المدى' : ''}
          </Text>
        </View>
        <View style={s.rsrpBox}>
          <Text style={[s.rsrpVal, { color }]}>{g.best.rsrp ?? '—'}</Text>
          <Text style={[s.rsrpUnit, { color }]}>{GRADE_LABEL[gr]}</Text>
        </View>
      </View>

      <QualityBar q={cellQuality(g.best)} color={color} />

      {!!note && (
        <View style={[s.pinNote, { backgroundColor: note.ok ? tBg('#e8f8f0') : tBg('#fff4e0') }]}>
          <Text style={[s.pinNoteText, { color: note.ok ? tFg('#0b7a47') : tFg('#a15c00') }]}>{note.text}</Text>
        </View>
      )}

      <View style={s.foot}>
        <View style={s.chips}>
          <Chip label="SINR" value={g.best.sinr} />
          <Chip label="RSRQ" value={g.best.rsrq} />
          {(g.badge === 'active' || g.badge === 'confirmed') && (
            <View style={[s.badge, { backgroundColor: BADGE_BG[g.badge] }]}>
              <Text style={[s.badgeText, { color: BADGE_FG[g.badge] }]}>{g.badge === 'active' ? 'مدموج' : 'يدمج'}</Text>
            </View>
          )}
        </View>
        {copyable && (
          <Pressable style={({ pressed }) => [s.copyBtn, pressed && { opacity: 0.6 }]} onPress={() => onCopy!(g)} hitSlop={6}>
            <Text style={s.copyBtnText}>📋 انسخ</Text>
          </Pressable>
        )}
        {canPin && (
          <Pressable
            style={({ pressed }) => [s.pinBtn, lockedHere && s.pinBtnOn, (busy || pressed) && { opacity: 0.6 }]}
            onPress={() => onLock(g)}
            disabled={busy}
            hitSlop={6}
          >
            <Text style={[s.pinBtnText, lockedHere && { color: C.onAccent }]}>
              {lockedHere ? 'فك التثبيت' : '📌 ثبّت'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

type LockOpt = { key: string; title: string; desc: string; tag?: string; note?: string; run: () => void };

/** قائمة خيارات التثبيت — بدل Alert (أندرويد يعرض ٣ أزرار بس) */
function LockSheet({ sheet, onClose, bottom }: {
  sheet: { title: string; sub: string; opts: LockOpt[] } | null; onClose: () => void; bottom: number;
}) {
  return (
    <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      {sheet && (
        <View style={[s.sheet, { paddingBottom: bottom + 16 }]}>
          <View style={s.grabber} />
          <Text style={s.sheetTitle}>{sheet.title}</Text>
          <Text style={s.sheetSub}>{sheet.sub}</Text>
          {sheet.opts.map((o, i) => (
            <Pressable
              key={o.key}
              style={({ pressed }) => [s.opt, i === 0 && s.optMain, pressed && { opacity: 0.7 }]}
              onPress={() => { onClose(); o.run(); }}
            >
              <View style={s.optHead}>
                <Text style={[s.optTitle, i === 0 && { color: C.blue }]}>{o.title}</Text>
                {!!o.tag && (
                  <View style={[s.optTag, i === 0 && { backgroundColor: C.blue }]}>
                    <Text style={[s.optTagText, i === 0 && { color: C.onAccent }]}>{o.tag}</Text>
                  </View>
                )}
              </View>
              <Text style={s.optDesc}>{o.desc}</Text>
              {!!o.note && <Text style={s.optNote}>🧠 {o.note}</Text>}
            </Pressable>
          ))}
          <Pressable style={s.cancel} onPress={onClose}>
            <Text style={s.cancelText}>إلغاء</Text>
          </Pressable>
        </View>
      )}
    </Modal>
  );
}

export default function TowersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cells, setCells] = useState<CellTower[]>([]);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [nrAvail, setNrAvail] = useState<number | undefined>();
  const [nrFound, setNrFound] = useState<CellTower[] | null>(null);
  const [nrScan, setNrScan] = useState<{ left: number } | null>(null);
  const nrStop = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [locks, setLocks] = useState<CellLockState[]>([]);
  const alive = useRef(true);
  const reloadTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { alive.current = false; reloadTimers.current.forEach(clearTimeout); }, []);
  const [canLock, setCanLock] = useState(false);
  const [bandCfg, setBandCfg] = useState<BandConfig | null>(null);
  const [trialCount, setTrialCount] = useState(0);
  const [seen, setSeen] = useState<SeenCell[]>([]);
  const [prefill, setPrefill] = useState<{ tech: 'LTE' | 'NR'; arfcn: string; pci: string; n: number } | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const manualY = useRef(0);
  const [sheet, setSheet] = useState<{ title: string; sub: string; opts: LockOpt[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const lockOf = (g: TowerGroup) => locks.find(l => !!g.pci && l.pci === g.pci && (!l.tech || l.tech === g.tech));

  const load = useCallback(async (r: SavedRouter) => {
    setError('');
    try {
      // بالتسلسل: بعض الراوترات (ZTE) ما تحب الطلبات المتوازية
      const [list, lock, supports, sig, cfg] = await withSession(r, async d => [
        d.getCells ? await d.getCells() : ([] as CellTower[]),
        d.getCellLocks
          ? await d.getCellLocks().catch(() => [] as CellLockState[])
          : d.getCellLock ? await d.getCellLock().then(x => (x ? [x] : [])).catch(() => [] as CellLockState[]) : [],
        typeof d.lockCell === 'function' && typeof d.unlockCell === 'function',
        d.getSignal ? await d.getSignal().catch(() => null) : null,
        d.getBandConfig && d.setBand ? await d.getBandConfig().catch(() => null) : null,
      ] as const);
      const known = await loadConfirmed(r.id);
      const next = await rememberActive(r.id, list, known);
      setConfirmed(next);
      setCells(list);
      setSeen(await rememberSeen(r.id, list));
      setNrAvail(sig?.nrAvailable);
      setLocks(lock);
      setCanLock(supports);
      setBandCfg(cfg);
      setTrialCount((await loadTrials(r.id)).length);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      await load(r);
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, load]));

  const onRefresh = async () => {
    if (!info) return;
    setRefreshing(true);
    await load(info);
    setRefreshing(false);
  };

  /** بعد التثبيت/الفك الراوتر يحتاج وقت ينتقل — نعيد القراءة تلقائياً كم مرة */
  const followUp = (r: SavedRouter) => {
    reloadTimers.current.forEach(clearTimeout);
    reloadTimers.current = [12000, 35000, 70000].map(ms => setTimeout(() => { if (alive.current) load(r); }, ms));
  };

  /** يجرب التغيير بأمان: يقيس قبل وبعد ويرجع لو صار أسوأ */
  const runSafe = async (o: Omit<Parameters<typeof safeApply>[0], 'r' | 'onStatus'>) => {
    if (!info) return;
    setBusy(true);
    setError('');
    try {
      const res = await safeApply({ ...o, r: info, onStatus: setStatus });
      const m = trialMessage(res, o.label);
      Alert.alert(m.title, m.body);
      await load(info);
      followUp(info);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  const onUnlock = (tech?: 'LTE' | 'NR') => {
    if (!info) return;
    const what = tech ? (tech === 'NR' ? 'تثبيت 5G' : 'تثبيت 4G') : 'كل التثبيتات';
    Alert.alert(`فك ${what}`, 'بنرجع الراوتر يختار البرج بنفسه ويرجع يدمج الترددات. ممكن النت ينقطع دقيقة.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'فك', onPress: async () => {
          setBusy(true);
          setError('');
          setStatus('نفك التثبيت...');
          try {
            await withSession(info, d => d.unlockCell!(tech), false);
            await load(info);
            followUp(info);
            Alert.alert('تم', 'انفك التثبيت — الراوتر رجع يختار بنفسه');
          } catch (e: any) {
            setError(e?.message ?? String(e));
          } finally {
            setBusy(false);
            setStatus('');
          }
        },
      },
    ]);
  };

  /** ينسخ أرقام البرج لبطاقة القفل اليدوي وينزل لها */
  const onCopy = (g: TowerGroup) => {
    const c = g.cells.find(x => x === g.best && x.arfcn) ?? g.cells.find(x => x.arfcn);
    if (!c?.arfcn || !g.pci) return;
    setPrefill({ tech: c.tech, arfcn: c.arfcn, pci: g.pci, n: Date.now() });
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, manualY.current - 12), animated: true }), 150);
  };

  /** القفل اليدوي — نفس الأمان: قياس قبل وبعد ورجوع تلقائي */
  const onManualLock = (t: ManualTarget) => {
    if (!info) return;
    const prevSame = locks.find(l => (l.tech ?? 'LTE') === t.tech && l.pci);
    const name = `${bandLabel(t.tech, t.band)} · خلية ${t.pci} · قناة ${t.arfcn}`;
    Alert.alert('القفل اليدوي', `بنثبّت الراوتر على ${name}.\n\nإذا الخلية مو موجودة عندك أو صارت أسوأ، نرجّع إعدادك لحاله. ممكن الراوتر يعيد التشغيل (دقيقة إلى دقيقتين).`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'ثبّت', onPress: () => runSafe({
          key: `cell:${t.tech}:${t.pci}:${t.arfcn}`,
          label: `التثبيت اليدوي على ${name}`,
          withNr: t.tech === 'NR',
          apply: d => d.lockCell!({ tech: t.tech, band: t.band, arfcn: t.arfcn, pci: t.pci }),
          revert: d => (prevSame
            ? d.lockCell!({ tech: t.tech, band: prevSame.band, arfcn: prevSame.arfcn, pci: prevSame.pci! })
            : d.unlockCell!(t.tech)),
        }),
      },
    ]);
  };

  const onLock = async (g: TowerGroup) => {
    if (!info) return;
    const mine = lockOf(g);
    if (mine) { onUnlock(mine.tech ?? g.tech); return; }

    // نختار الخلية اللي عندها رقم تردد (ARFCN) — التثبيت يحتاجه
    const tower = g.cells.find(c => c === g.best && c.arfcn) ?? g.cells.find(c => c.arfcn) ?? g.best;
    const isNr = tower.tech === 'NR';
    const bandTxt = bandName(tower);
    const cfg = bandCfg;
    const canBand = !!cfg && !!tower.band &&
      (isNr ? cfg.nrSupported.includes(tower.band) : cfg.supported.includes(tower.band));
    const canCell = canLock && !!tower.pci && !!tower.arfcn;

    const cellKey = `cell:${tower.tech}:${tower.pci}:${tower.arfcn ?? tower.band ?? ''}`;
    const bandKey = `band:${tower.tech}:${tower.band}`;
    const [tCell, tBand] = await Promise.all([lastTrial(info.id, cellKey), lastTrial(info.id, bandKey)]);
    // لو فيه تثبيت سابق على نفس النوع (4G/5G) نرجّعه لو التجربة طلعت أسوأ — وما نلمس تثبيت النوع الثاني
    const prevSame = locks.find(l => (l.tech ?? 'LTE') === tower.tech && l.pci);

    const opts: LockOpt[] = [];

    if (canCell) {
      opts.push({
        key: 'cell',
        title: `ثبّت على برج ${tower.pci} (${bandTxt})`,
        tag: 'البرج نفسه',
        desc: 'الراوتر يبقى على هذا البرج بالذات حتى لو ظهر غيره. غالباً يوقف دمج الترددات، وممكن يعيد تشغيل الراوتر عشان يطبّق (دقيقة إلى دقيقتين).',
        note: tCell ? trialNote(tCell) : undefined,
        run: () => runSafe({
          key: cellKey,
          label: `التثبيت على ${towerTitle(tower)}`,
          withNr: isNr,
          apply: d => d.lockCell!({ tech: tower.tech, band: tower.band, arfcn: tower.arfcn, pci: tower.pci! }),
          revert: d => (prevSame
            ? d.lockCell!({ tech: tower.tech, band: prevSame.band, arfcn: prevSame.arfcn, pci: prevSame.pci! })
            : d.unlockCell!(tower.tech)),
        }),
      });
    }

    if (canBand && cfg) {
      const prevLte = cfg.locked;
      const prevNr = cfg.nrLocked;
      opts.push({
        key: 'band',
        title: `ثبّت التردد ${bandTxt} فقط`,
        tag: 'أأمن',
        desc: 'الراوتر يبقى حر يختار أقوى برج على نفس التردد — أقل خطر يوقف الدمج.',
        note: tBand ? trialNote(tBand) : undefined,
        run: () => runSafe({
          key: bandKey,
          label: `تثبيت التردد ${bandTxt}`,
          withNr: isNr,
          apply: d => (isNr ? d.setBand!(prevLte, [tower.band!]) : d.setBand!([tower.band!], prevNr)),
          revert: d => d.setBand!(prevLte, prevNr),
        }),
      });

      // 4G + 5G معاً (NSA) لو البرج 4G والراوتر يدعم 5G
      if (!isNr && cfg.nrSupported.length > 0) {
        const nrSame = tower.pci ? cells.find(c => c.tech === 'NR' && c.pci === tower.pci && c.band) : undefined;
        const nrAny = cells
          .filter(c => c.tech === 'NR' && c.band && cfg.nrSupported.includes(c.band))
          .sort((a, b) => (b.rsrp ?? -999) - (a.rsrp ?? -999))[0];
        const prefer = [78, 41, 40, 77];
        const nrBand = (nrSame?.band && cfg.nrSupported.includes(nrSame.band) ? nrSame.band : undefined)
          ?? nrAny?.band ?? prefer.find(b => cfg.nrSupported.includes(b));
        if (nrBand) {
          const combinedKey = `band:LTE:${tower.band}+NR:${nrBand}`;
          opts.push({
            key: 'combo',
            title: `ثبّت ${bandTxt} + n${nrBand}`,
            tag: 'أسرع',
            desc: 'تثبيت تردد 4G مع 5G معاً — أعلى سرعة لو 5G قوي عندك، ويستهلك شوي باقة وقت القياس.',
            run: () => runSafe({
              key: combinedKey,
              label: `تثبيت ${bandTxt} + n${nrBand}`,
              withNr: true,
              apply: d => d.setBand!([tower.band!], [nrBand]),
              revert: d => d.setBand!(prevLte, prevNr),
            }),
          });
        }
      }
    }

    if (!opts.length) {
      Alert.alert(
        'ما نقدر نثبّت هنا',
        !tower.pci
          ? 'الراوتر ما أعطانا رقم هذا البرج، وما يدعم تثبيت التردد.'
          : 'راوترك ما يدعم التثبيت على برج أو تردد من التطبيق.',
      );
      return;
    }

    setSheet({
      title: g.pci ? `برج ${g.pci} · ${bandTxt}` : `تردد ${bandTxt}`,
      sub: 'نجرب بأمان: نقيس قبل وبعد، ولو صار أسوأ نرجع إعدادك تلقائياً.',
      opts,
    });
  };

  const revealNr = () => {
    if (!info || nrScan) return;
    Alert.alert(
      'اكشف أبراج 5G',
      'بنحمّل ملف لمدة ١٠ ثواني تقريباً عشان نصحّي 5G ونقرأ خلاياه.\n\nيستهلك تقريباً ١٠–٤٠ ميقا من باقتك.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'ابدأ', onPress: async () => {
            nrStop.current = false;
            const found = new Map<string, CellTower>();
            const DURATION = 10000;
            const started = Date.now();
            let used = 0;
            setNrScan({ left: 10 });
            const burst = trafficBurst(DURATION, 40_000_000, () => nrStop.current).then(b => { used = b; });
            try {
              await new Promise(r => setTimeout(r, 2500));
              while (Date.now() - started < DURATION + 1500 && !nrStop.current) {
                try { await withSession(info, d => collectNr(d, found), false); } catch {}
                setNrScan({ left: Math.max(0, Math.ceil((DURATION - (Date.now() - started)) / 1000)) });
                await new Promise(r => setTimeout(r, 1800));
              }
              await burst;
              const list = [...found.values()].sort((a, b) => (b.rsrp ?? -999) - (a.rsrp ?? -999));
              setNrFound(list);
              await load(info);
              if (list.length) {
                Alert.alert('تم ✅', `ظهرت ${list.length} خلية 5G. استهلك الفحص حوالي ${mb(used)} ميقا.`);
              } else {
                Alert.alert(
                  'ما تفعّل 5G',
                  'البرج يدعم 5G، لكنه ما تفعّل لراوترك حتى تحت التحميل.\n\nالأرجح أن شريحتك أو باقتك ما تدعم 5G — جرّب شريحة ثانية أو اسأل مشغّلك.',
                );
              }
            } finally {
              setNrScan(null);
            }
          },
        },
      ],
    );
  };

  const groups = groupTowers(cells, confirmed);
  const nrNow = cells.find(c => c.tech === 'NR' && (c.kind === 'serving' || c.kind === 'secondary'));
  const primary = groups.find(g => g.role === 'primary');
  const pinnedGroups = groups.filter(g => !!lockOf(g));
  const inUse = groups.filter(g => g.inUse && !lockOf(g));
  const others = groups.filter(g => !g.inUse && !lockOf(g));
  // تثبيت على برج ما ظهر في القراءة الحالية
  const orphanLocks = locks.filter(l => !groups.some(g => lockOf(g) === l));
  const bestOther = others[0];
  const currentScore = primary ? rankScore(primary.best) : 0;
  const worthIt = !!bestOther && bestOther.score > currentScore + 0.08;
  const lowCand = !!bestOther && isLowBand(bestOther.best);
  const canPin = canLock || !!bandCfg;
  const isPinned = (g: TowerGroup) => !!lockOf(g);

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.blue} colors={[C.blue]} />}
      >
        {loading && (
          <View style={s.center}>
            <ActivityIndicator size="large" color={C.blue} />
            <Text style={s.muted}>نقرأ الأبراج من الراوتر...</Text>
          </View>
        )}

        {!!error && (
          <View style={s.errorCard}>
            <Text style={s.errorText}>{error}</Text>
            {info && (
              <Pressable style={s.retryBtn} onPress={() => load(info)}>
                <Text style={s.retryText}>إعادة المحاولة</Text>
              </Pressable>
            )}
          </View>
        )}

        {busy && !!status && (
          <View style={s.lockBanner}>
            <ActivityIndicator color={C.blue} />
            <Text style={s.lockBannerText}>{status}</Text>
          </View>
        )}

        {!loading && info && (
          <Pressable style={s.carrLink} onPress={() => router.push(`/carriers/${info.id}` as Href)}>
            <Text style={s.carrLinkText}>📶 النواقل المدموجة بالتفصيل (عرض كل ناقل وجودته) ‹</Text>
          </Pressable>
        )}

        {!loading && info && trialCount > 0 && (
          <Pressable style={[s.carrLink, { backgroundColor: C.goldSoft }]} onPress={() => router.push(`/trials/${info.id}` as Href)}>
            <Text style={[s.carrLinkText, { color: tFg('#b76e00') }]}>⭐ وش نجح عندي — نتائج {trialCount} تجربة تثبيت سابقة ‹</Text>
          </Pressable>
        )}

        {!loading && (pinnedGroups.length > 0 || orphanLocks.length > 0) && (
          <GlassCard
            title={pinnedGroups.length + orphanLocks.length > 1 ? `الأبراج المثبّتة (${pinnedGroups.length + orphanLocks.length})` : 'البرج المثبّت'}
            icon="📌" tint={C.blueSoft} collapsible={false}
          >
            {pinnedGroups.map(g => (
              <TowerGroupCard key={'pin' + g.key} g={g} lockedHere canPin={canPin} busy={busy} onLock={onLock}
                note={g.inUse
                  ? { ok: true, text: '✓ مثبّت والراوتر متصل عليه الحين' }
                  : { ok: false, text: '⏳ مثبّت، بس الراوتر للحين ما انتقل له — ينتقل خلال دقيقة أو بعد إعادة التشغيل. نحدّث القراءة تلقائياً.' }} />
            ))}
            {orphanLocks.map(l => (
              <View key={`orph-${l.tech}-${l.pci}`} style={[s.tower, s.towerLocked]}>
                <View style={s.head}>
                  <View style={[s.avatar, { backgroundColor: C.blueSoft }]}><Text style={s.avatarRank}>📌</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={s.titleRow}>
                      <Text style={s.towerName}>برج {l.pci}</Text>
                      <View style={[s.techTag, l.tech === 'NR' && { backgroundColor: C.violet }]}>
                        <Text style={s.techTagText}>{l.tech === 'NR' ? '5G' : '4G'}</Text>
                      </View>
                    </View>
                    <Text style={s.role}>{l.band ? `${l.tech === 'NR' ? 'n' : 'B'}${l.band} · ` : ''}{l.arfcn ? `ARFCN ${l.arfcn}` : ''}</Text>
                  </View>
                </View>
                <View style={[s.pinNote, { backgroundColor: tBg('#fff4e0') }]}>
                  <Text style={[s.pinNoteText, { color: tFg('#a15c00') }]}>⏳ مثبّت، بس البرج ما ظهر في القراءة الحالية — الراوتر يحاول يتصل عليه.</Text>
                </View>
                <View style={s.foot}>
                  <View style={s.chips} />
                  <Pressable style={[s.pinBtn, s.pinBtnOn, busy && { opacity: 0.6 }]} onPress={() => onUnlock(l.tech)} disabled={busy}>
                    <Text style={[s.pinBtnText, { color: C.onAccent }]}>فك التثبيت</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            {pinnedGroups.length + orphanLocks.length > 1 && (
              <Pressable style={[s.unlockAll, busy && { opacity: 0.5 }]} onPress={() => onUnlock()} disabled={busy}>
                <Text style={s.unlockAllText}>فك كل التثبيتات</Text>
              </Pressable>
            )}
          </GlassCard>
        )}

        {!loading && (canLock || !!bandCfg) && primary && (
          <GlassCard title="هل فيه برج أفضل؟" icon="⭐" tint={C.goldSoft} collapsible={false}>
            {!worthIt || !bestOther ? (
              <Text style={s.recOk}>
                ✓ أنت على أفضل برج متاح حسب القوة والجودة معاً — التثبيت على غيره ما بيحسّن شي.
              </Text>
            ) : (
              <>
                <Text style={s.recName}>
                  برج {bestOther.pci} · {bandName(bestOther.best)}
                </Text>
                <Text style={s.hint}>
                  جودته أعلى من برجك الحالي بحسب القوة والجودة معاً.
                  {lowCand ? ` لكنه على ${bandName(bestOther.best)} — تردد منخفض، فممكن تكون سرعته أقل رغم قوة إشارته.` : ''}
                  {' '}تذكّر: التثبيت على برج واحد غالباً يوقف الدمج، فجرّب وقارن السرعة.
                </Text>
                <Pressable style={[s.recBtn, busy && { opacity: 0.5 }]} onPress={() => onLock(bestOther)} disabled={busy}>
                  <Text style={s.recBtnText}>📌 جرّب هذا البرج</Text>
                </Pressable>
                {info && (
                  <Pressable onPress={() => router.push(`/bands/${info.id}` as Href)} hitSlop={8}>
                    <Text style={s.link}>أو قارن الترددات من شاشة الترددات ‹</Text>
                  </Pressable>
                )}
              </>
            )}
          </GlassCard>
        )}

        {!loading && !nrNow && !!nrAvail && (
          <GlassCard title="أبراج 5G" icon="🛰️" tint={C.violetSoft} collapsible={false}>
            {nrFound === null && (
              <Text style={s.hint}>
                البرج يدعم 5G لكنه غير نشط الحين، فالراوتر ما يقيس خلاياه. الكشف يحمّل ملف قصير عشان يصحّيه ويقرأ خلاياه.
              </Text>
            )}
            {nrFound && nrFound.length === 0 && (
              <Text style={s.lowNote}>
                آخر فحص: ما تفعّل 5G حتى تحت التحميل — الأرجح شريحتك أو باقتك ما تدعمه.
              </Text>
            )}
            {nrFound?.map((t, i) => (
              <View key={'nr' + towerKey(t, i)} style={s.nrRow}>
                <Text style={[s.freqBand, { color: C.violet }]}>{towerTitle(t)}</Text>
                <Text style={s.freqRsrp}>{t.rsrp ?? '—'} dBm · SINR {t.sinr ?? '—'}</Text>
              </View>
            ))}
            {nrScan ? (
              <View style={s.nrBusy}>
                <ActivityIndicator color={C.violet} />
                <Text style={s.nrBusyText}>نصحّي 5G ونقرأ الخلايا… {nrScan.left} ث</Text>
                <Pressable onPress={() => { nrStop.current = true; }} hitSlop={8}>
                  <Text style={s.nrStop}>إيقاف</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={[s.recBtn, { backgroundColor: C.violet }, busy && { opacity: 0.5 }]} onPress={revealNr} disabled={busy}>
                <Text style={s.recBtnText}>{nrFound ? 'اكشف مرة ثانية' : '🛰️ اكشف أبراج 5G'}</Text>
              </Pressable>
            )}
          </GlassCard>
        )}

        {!loading && inUse.length > 0 && (
          <GlassCard
            title={inUse.length > 1 ? `الأبراج اللي تستخدمها (${inUse.length})` : 'برجك الحالي'}
            icon="🗼" tint={C.greenSoft} collapsible={false}
          >
            {inUse.map(g => (
              <TowerGroupCard key={g.key} g={g} lockedHere={isPinned(g)} canPin={canPin} busy={busy} onLock={onLock} onCopy={onCopy} />
            ))}
          </GlassCard>
        )}

        {!loading && (
          <GlassCard title={`الأبراج حولك (${others.length})`} icon="📡" tint={C.blueSoft}>
            {others.length === 0 && (
              <Text style={s.muted}>
                ما رجّع الراوتر أبراج مجاورة. بعض الإصدارات ما تدعم هذي القراءة، وبعضها ترجعها فقط وقت البحث عن شبكة.
              </Text>
            )}
            {others.map((g, i) => (
              <TowerGroupCard key={g.key} g={g} rank={i + 1} lockedHere={isPinned(g)} canPin={canPin} busy={busy} onLock={onLock} onCopy={onCopy} />
            ))}
            {others.length > 0 && (
              <Text style={s.hint}>مرتّبة حسب الجودة الفعلية (القوة + الجودة + نوع التردد)، مو القوة لحالها. ◻️ الأبراج اللي ظهرت على تردد واحد غالباً ما تدمج.</Text>
            )}
          </GlassCard>
        )}

        {!loading && canLock && (
          <View onLayout={e => { manualY.current = e.nativeEvent.layout.y; }}>
          <ManualLock
            key={prefill?.n ?? 0}
            initial={prefill ?? undefined}
            seen={seen}
            visible={new Set(cells.filter(c => c.pci && c.arfcn).map(c => seenKey({ tech: c.tech, pci: c.pci!, arfcn: c.arfcn! })))}
            busy={busy}
            onLock={onManualLock}
          />
          </View>
        )}

        {!loading && (
          <GlassCard title="كيف نقرأ الأبراج؟" icon="ℹ️" tint={C.goldSoft} defaultOpen={false}>
            <Text style={s.hint}>
              كل بطاقة = برج واحد. نجمع الترددات اللي لها نفس رقم البرج (PCI)، لأنها غالباً على نفس العمود.
            </Text>
            <Text style={s.hint}>
              📌 التثبيت: اضغط «ثبّت على هذا البرج» على أي برج — مستخدم أو مجاور. تقدر تثبّت البرج نفسه، أو تردده فقط (أأمن).
            </Text>
            <Text style={s.hint}>
              ✅ مدموج الآن: الراوتر يدمج ترددات من هذا البرج حالياً. ✅ دمج مؤكد: شفناه يدمج عليه من قبل.
              🔗 يدعم الدمج غالباً: ظهر على تردّدين أو أكثر. ◻️ تردد واحد: ما شفناه إلا على تردد واحد.
            </Text>
            <Text style={s.hint}>
              التقييم (ممتاز/جيد/مقبول/ضعيف) يجمع القوة (RSRP) والجودة (RSRQ) والتشويش (SINR) — لأن برج قوي بس مشوّش أسوأ من برج أضعف ونظيف.
            </Text>
            <Text style={s.hint}>
              الترددات المنخفضة مثل B20 (800) وB28 (700) توصل أبعد وتخترق الجدران، لكن سعتها أقل. والعالية مثل B3 (1800) وB1 (2100) أسرع لكن مداها أقصر.
            </Text>
          </GlassCard>
        )}
      </ScrollView>
      <LockSheet sheet={sheet} onClose={() => setSheet(null)} bottom={insets.bottom} />
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  copyBtn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: C.violetSoft },
  copyBtnText: { color: C.violet, fontWeight: '800', fontSize: 12 },
  page: { padding: 16, gap: 14 },
  center: { alignItems: 'center', gap: 10, paddingVertical: 30 },
  muted: { color: C.sub, textAlign: 'center', lineHeight: 22 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  lowNote: { color: tFg('#b76e00'), fontSize: 12, textAlign: 'right', lineHeight: 19, fontWeight: '700' },
  link: { color: C.blue, fontSize: 12.5, textAlign: 'center', fontWeight: '700', marginTop: 2 },
  errorCard: { backgroundColor: C.redSoft, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  errorText: { color: C.red, fontWeight: '700', textAlign: 'right' },
  retryBtn: { alignSelf: 'flex-end', backgroundColor: C.red, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  retryText: { color: tFg('#fff'), fontWeight: '700' },

  pinNote: { borderRadius: 12, paddingVertical: 7, paddingHorizontal: 10 },
  pinNoteText: { fontSize: 12, fontWeight: '700', textAlign: 'right', lineHeight: 18 },
  unlockAll: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16 },
  unlockAllText: { color: C.red, fontWeight: '800', fontSize: 13 },
  tower: {
    backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: tBd('#e7eefb'), padding: 12, gap: 9,
    shadowColor: C.shadow, shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  towerInUse: { borderColor: C.green, borderWidth: 1.5 },
  towerLocked: { borderColor: C.blue, borderWidth: 2, backgroundColor: tBg('#f5f8ff') },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarRank: { fontWeight: '900', fontSize: 13 },
  titleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  towerName: { color: C.text, fontWeight: '800', fontSize: 16.5, textAlign: 'right', flexShrink: 1 },
  techTag: { backgroundColor: C.blue, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 1 },
  techTagText: { color: tFg('#fff'), fontWeight: '800', fontSize: 10.5 },
  role: { color: C.sub, fontSize: 12, textAlign: 'right', marginTop: 3 },
  rsrpBox: { alignItems: 'center', minWidth: 54 },
  rsrpVal: { fontWeight: '900', fontSize: 20, lineHeight: 24 },
  rsrpUnit: { fontSize: 10.5, fontWeight: '800' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pinBtn: {
    borderRadius: 999, borderWidth: 1.5, borderColor: C.blue, backgroundColor: tBg('#f5f8ff'),
    paddingHorizontal: 14, paddingVertical: 6,
  },
  pinBtnOn: { backgroundColor: C.blue },
  pinBtnText: { color: C.blue, fontWeight: '800', fontSize: 12.5 },
  qTrack: { height: 6, borderRadius: 3, backgroundColor: tBg('#edf1f8'), overflow: 'hidden', flexDirection: 'row-reverse' },
  qFill: { height: 6, borderRadius: 3 },
  chips: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
    backgroundColor: C.rowBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: tBd('#e7eefb'),
  },
  chipLabel: { color: C.muted, fontSize: 10.5, fontWeight: '700' },
  chipVal: { color: C.text, fontSize: 12, fontWeight: '800' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontWeight: '800', fontSize: 11 },
  freqBand: { color: C.text, fontWeight: '800', fontSize: 12.5 },
  freqRsrp: { color: C.sub, fontSize: 10.5, fontWeight: '700' },

  pinBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: tBg('#eef3ff'), borderColor: C.blue, borderWidth: 1.5, borderRadius: 18, padding: 14,
  },
  pinBannerTitle: { color: C.text, fontWeight: '900', fontSize: 15, textAlign: 'right' },
  pinBannerSub: { color: C.sub, fontSize: 12, textAlign: 'right', marginTop: 2 },

  backdrop: { flex: 1, backgroundColor: tBg('rgba(13,35,80,0.35)') },
  sheet: {
    backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 16, paddingTop: 10, gap: 10,
  },
  grabber: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: tBg('#d9e1ef'), marginBottom: 4 },
  sheetTitle: { color: C.text, fontWeight: '900', fontSize: 18, textAlign: 'right' },
  sheetSub: { color: C.sub, fontSize: 12.5, textAlign: 'right', lineHeight: 19, marginBottom: 2 },
  opt: { borderRadius: 16, borderWidth: 1, borderColor: tBd('#e7eefb'), backgroundColor: C.rowBg, padding: 12, gap: 4 },
  optMain: { borderColor: C.blue, borderWidth: 1.5, backgroundColor: tBg('#f5f8ff') },
  optHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  optTitle: { flex: 1, color: C.text, fontWeight: '800', fontSize: 15, textAlign: 'right' },
  optTag: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: tBg('#e7eefb') },
  optTagText: { color: C.sub, fontWeight: '800', fontSize: 10.5 },
  optDesc: { color: C.sub, fontSize: 12, textAlign: 'right', lineHeight: 18 },
  optNote: { color: C.violet, fontSize: 11.5, textAlign: 'right', fontWeight: '700' },
  cancel: { paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: C.red, fontWeight: '800', fontSize: 14 },


  nrRow: {
    flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder, padding: 10,
  },
  nrBusy: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    backgroundColor: C.violetSoft, borderRadius: 14, padding: 12,
  },
  nrBusyText: { flex: 1, color: C.violet, fontWeight: '700', textAlign: 'right' },
  nrStop: { color: C.red, fontWeight: '800' },

  recOk: { color: C.green, fontWeight: '700', fontSize: 13, textAlign: 'right', lineHeight: 21 },
  recName: { color: C.text, fontWeight: '800', fontSize: 16, textAlign: 'right' },
  recBtn: { backgroundColor: C.blue, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  recBtnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  carrLink: { backgroundColor: C.blueSoft, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14 },
  carrLinkText: { color: C.blue, fontWeight: '700', fontSize: 13, textAlign: 'right' },
  lockBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.blueSoft, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 16, padding: 12 },
  lockBannerText: { flex: 1, color: C.text, fontWeight: '700', textAlign: 'right', fontSize: 13 },
  unlockBtn: { borderWidth: 1, borderColor: C.blue, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  unlockText: { color: C.blue, fontWeight: '800', fontSize: 12 },
});
