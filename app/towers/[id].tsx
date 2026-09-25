import { useCallback, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { CellTower, CellLockState, BandConfig } from '../../src/drivers/types';
import { LEVEL_COLOR, LEVEL_LABEL, overallLevel } from '../../src/utils/signal';
import { towerKey, towerTitle } from '../../src/utils/cells';
import {
  TowerGroup, groupTowers, loadConfirmed, rememberActive, rankScore, cellGrade,
  GRADE_LABEL, GRADE_COLOR, BADGE_LABEL, isLowBand, bandName, freqName,
} from '../../src/utils/towers';
import { C } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import { trafficBurst, collectNr, mb } from '../../src/utils/nrprobe';
import { safeApply, lastTrial, trialNote, trialMessage } from '../../src/utils/safeLock';

const BADGE_BG: Record<TowerGroup['badge'], string> = {
  active: '#e8f8f0', confirmed: '#e8f8f0', likely: '#eaf0ff', single: '#f3f4fb',
};
const BADGE_FG: Record<TowerGroup['badge'], string> = {
  active: '#12b76a', confirmed: '#12b76a', likely: '#2f6bff', single: '#6b7291',
};
const ROLE_LABEL: Record<TowerGroup['role'], string> = {
  primary: 'متصل عليه — البرج الأساسي',
  helper: 'شغّال كمساعد مع برجك الأساسي',
  neighbor: 'برج مجاور',
};

function Metric({ label, value, unit }: { label: string; value?: number; unit: string }) {
  return (
    <View style={s.metric}>
      <Text style={s.metricVal}>{value !== undefined ? value : '—'}</Text>
      <Text style={s.metricUnit}>{unit}</Text>
      <Text style={s.metricLabel}>{label}</Text>
    </View>
  );
}

/** بطاقة برج واحد (كل ترددات نفس رقم PCI) */
function TowerGroupCard({ g, rank, cellLock, canLock, busy, onLock }: {
  g: TowerGroup; rank?: number; cellLock: CellLockState | null; canLock: boolean; busy: boolean;
  onLock: (c: CellTower) => void;
}) {
  const gr = cellGrade(g.best);
  const lockedHere = !!cellLock && !!g.pci && cellLock.pci === g.pci;
  const low = isLowBand(g.best);

  return (
    <View style={[s.tower, g.inUse && s.towerInUse]}>
      <View style={s.towerHead}>
        <View style={{ flexShrink: 1, flex: 1 }}>
          <View style={s.titleRow}>
            <Text style={s.towerName}>{g.pci ? `برج ${g.pci}` : 'برج'}</Text>
            <View style={[s.techTag, g.tech === 'NR' && { backgroundColor: C.violet }]}>
              <Text style={s.techTagText}>{g.tech === 'NR' ? '5G' : '4G'}</Text>
            </View>
          </View>
          <Text style={s.role}>{ROLE_LABEL[g.role]}</Text>
        </View>
        {rank !== undefined && (
          <View style={[s.rank, { backgroundColor: GRADE_COLOR[gr] }]}>
            <Text style={s.rankText}>{rank}</Text>
          </View>
        )}
      </View>

      <View style={s.badgeRow}>
        <View style={[s.badge, { backgroundColor: BADGE_BG[g.badge] }]}>
          <Text style={[s.badgeText, { color: BADGE_FG[g.badge] }]}>{BADGE_LABEL[g.badge]}</Text>
        </View>
        <View style={[s.grade, { backgroundColor: GRADE_COLOR[gr] }]}>
          <Text style={s.gradeText}>{GRADE_LABEL[gr]}</Text>
        </View>
      </View>

      <View style={s.freqRow}>
        {g.cells.map((c, i) => {
          const cg = cellGrade(c);
          return (
            <View key={i} style={[s.freq, c.kind !== 'neighbor' && s.freqOn]}>
              <View style={[s.freqDot, { backgroundColor: GRADE_COLOR[cg] }]} />
              <Text style={[s.freqBand, c.tech === 'NR' && { color: C.violet }]}>{bandName(c)}</Text>
              {!!freqName(c) && <Text style={s.freqMhz}>{freqName(c)}</Text>}
              {c.rsrp !== undefined && <Text style={s.freqRsrp}>{c.rsrp}</Text>}
            </View>
          );
        })}
      </View>

      <View style={s.metrics}>
        <Metric label="RSRP" value={g.best.rsrp} unit="dBm" />
        <Metric label="SINR" value={g.best.sinr} unit="dB" />
        <Metric label="RSRQ" value={g.best.rsrq} unit="dB" />
      </View>

      {low && (
        <Text style={s.lowNote}>
          {bandName(g.best)} تردد منخفض — يوصل بعيد ويخترق الجدران، لكن سرعته محدودة.
        </Text>
      )}
      {g.badge === 'single' && (
        <Text style={s.hint}>ما ظهر هذا البرج إلا على تردد واحد — غالباً ما يدمج، أو ما شفنا ترددات ثانية له.</Text>
      )}

      {canLock && !!g.pci && (
        <Pressable
          style={[s.lockBtn, lockedHere && s.lockBtnOn, busy && { opacity: 0.5 }]}
          onPress={() => onLock(g.best)}
          disabled={busy}
        >
          <Text style={[s.lockText, lockedHere && { color: C.onAccent }]}>
            {lockedHere ? '✓ مثبّت على هذا البرج — اضغط للفك' : `📌 ثبّت على ${bandName(g.best)} في هذا البرج`}
          </Text>
        </Pressable>
      )}
    </View>
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
  const [cellLock, setCellLock] = useState<CellLockState | null>(null);
  const [canLock, setCanLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async (r: SavedRouter) => {
    setError('');
    try {
      const [list, lock, supports, sig] = await withSession(r, async d => Promise.all([
        d.getCells ? d.getCells() : Promise.resolve([] as CellTower[]),
        d.getCellLock ? d.getCellLock().catch(() => null) : Promise.resolve(null),
        Promise.resolve(typeof d.lockCell === 'function' && typeof d.unlockCell === 'function'),
        d.getSignal ? d.getSignal().catch(() => null) : Promise.resolve(null),
      ]));
      const known = await loadConfirmed(r.id);
      const next = await rememberActive(r.id, list, known);
      setConfirmed(next);
      setCells(list);
      setNrAvail(sig?.nrAvailable);
      setCellLock(lock);
      setCanLock(supports);
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
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  const onLock = async (tower: CellTower) => {
    if (!info) return;
    const isLocked = !!cellLock && cellLock.pci === tower.pci;

    if (isLocked) {
      Alert.alert('فك التثبيت', 'بنرجع الراوتر يختار البرج بنفسه — ويرجع يدمج الترددات لو البرج يدعم.', [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'فك', onPress: async () => {
            setBusy(true);
            setError('');
            try {
              await withSession(info, d => d.unlockCell!(), false);
              await load(info);
              Alert.alert('تم', 'انفك التثبيت');
            } catch (e: any) {
              setError(e?.message ?? String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ]);
      return;
    }

    const isNr = tower.tech === 'NR';
    const bandTxt = tower.band ? (isNr ? `n${tower.band}` : `B${tower.band}`) : '';
    const cellKey = `cell:${tower.tech}:${tower.pci}:${tower.arfcn ?? tower.band ?? ''}`;
    const bandKey = `band:${tower.tech}:${tower.band}`;

    // هل نقدر نقفل التردد بدل البرج؟ (أأمن: يبقى الراوتر حر يختار البرج)
    let cfg: BandConfig | null = null;
    try {
      cfg = await withSession(info, d => (d.getBandConfig && d.setBand ? d.getBandConfig() : Promise.resolve(null)));
    } catch {}
    const canBand = !!cfg && !!tower.band &&
      (isNr ? cfg.nrSupported.includes(tower.band) : cfg.supported.includes(tower.band));

    const [tCell, tBand] = await Promise.all([lastTrial(info.id, cellKey), lastTrial(info.id, bandKey)]);
    const notes = [
      tCell ? `🧠 البرج: ${trialNote(tCell)}` : '',
      tBand ? `🧠 التردد ${bandTxt}: ${trialNote(tBand)}` : '',
    ].filter(Boolean).join('\n');

    const cellLabel = `التثبيت على ${towerTitle(tower)}`;
    const bandLabel = `تثبيت التردد ${bandTxt}`;

    // ═══ هل نعرض خيار 4G + 5G؟ ═══
    // نعرضه إذا البرج 4G والراوتر يدعم 5G (حتى لو ما شفنا NR حالياً)
    if (!isNr && cfg && cfg.nrSupported.length > 0) {
      // ١) نبحث عن NR على نفس PCI
      // ٢) وإلا أي NR مرصود في cells (الأقوى)
      // ٣) وإلا نختار من nrSupported (الأولوية: 78, 41, 40)
      let pickedBand: number | null = null;
      let pickedRsrp: number | undefined;
      let pickedPci: string | undefined;
      const nrSamePci = tower.pci
        ? cells.find(c => c.tech === 'NR' && c.pci === tower.pci && c.band)
        : null;
      if (nrSamePci?.band && cfg.nrSupported.includes(nrSamePci.band)) {
        pickedBand = nrSamePci.band;
        pickedRsrp = nrSamePci.rsrp;
        pickedPci = nrSamePci.pci;
      } else {
        const anyNr = cells
          .filter(c => c.tech === 'NR' && c.band && cfg.nrSupported.includes(c.band!))
          .sort((a, b) => (b.rsrp ?? -999) - (a.rsrp ?? -999))[0];
        if (anyNr?.band) {
          pickedBand = anyNr.band;
          pickedRsrp = anyNr.rsrp;
          pickedPci = anyNr.pci;
        } else {
          // ما شفنا NR — نستخدم الأكثر شيوعاً من المدعومة
          const prefer = [78, 41, 40, 77, 1, 3, 5, 8, 20, 28];
          pickedBand = prefer.find(b => cfg.nrSupported.includes(b)) ?? cfg.nrSupported[0];
        }
      }

      if (pickedBand !== null) {
        const nrBand = pickedBand;
        const nrBandTxt = `n${nrBand}`;
        const nrRsrpTxt = pickedRsrp !== undefined ? `${pickedRsrp} dBm` : 'غير مقيس — سنقيسه';
        const combinedKey = `band:LTE:${tower.band}+NR:${nrBand}`;
        const combinedLabel = `تثبيت ${bandTxt} + ${nrBandTxt}`;
        const cfgRef = cfg;

        Alert.alert(
          `برج ${tower.pci} — فيه 4G و 5G`,
          `هذا البرج يدعم 4G و 5G على نفس الموقع.\n\n` +
          `📶 4G: ${bandTxt}\n` +
          `📡 5G: ${nrBandTxt} (${nrRsrpTxt})\n\n` +
          `تثبيت 4G + 5G معاً = أقصى سرعة (NSA).\n` +
          `تثبيت 4G فقط = أضمن ثبات — استخدمها إذا 5G ضعيف أو يقطع.` +
          (notes ? `\n\n${notes}` : ''),
          [
            { text: 'إلغاء', style: 'cancel' },
            {
              text: `4G فقط (${bandTxt})`,
              onPress: () => runSafe({
                key: bandKey,
                label: bandLabel,
                withNr: false,
                apply: d => d.setBand!([tower.band!], cfgRef.nrLocked),
                revert: d => d.setBand!(cfgRef.locked, cfgRef.nrLocked),
              }),
            },
            {
              text: `4G + 5G (أنصح)`,
              onPress: () => runSafe({
                key: combinedKey,
                label: combinedLabel,
                withNr: true,
                apply: d => d.setBand!([tower.band!], [nrBand]),
                revert: d => d.setBand!(cfgRef.locked, cfgRef.nrLocked),
              }),
            },
          ],
        );
        return;
      }
    }

    const doCell = () => runSafe({
      key: cellKey,
      label: cellLabel,
      withNr: isNr,
      apply: d => d.lockCell!({ tech: tower.tech, band: tower.band, arfcn: tower.arfcn, pci: tower.pci! }),
      revert: d => d.unlockCell!(),
    });

    const doBand = () => {
      if (!cfg || !tower.band) return;
      const prevLte = cfg.locked;
      const prevNr = cfg.nrLocked;
      runSafe({
        key: bandKey,
        label: bandLabel,
        withNr: isNr,
        apply: d => (isNr ? d.setBand!(prevLte, [tower.band!]) : d.setBand!([tower.band!], prevNr)),
        revert: d => d.setBand!(prevLte, prevNr),
      });
    };

    const intro =
      `بنجرب بأمان: نقيس الاتصال الحين، نثبّت، ونقيس بعدها.\nلو صار أسوأ نرجع إعدادك تلقائياً.` +
      (isNr ? '\n\nعشان نقيس 5G بنحمّل شوي قبل وبعد (حوالي ٥٠ ميقا).' : '') +
      (canBand
        ? `\n\n💡 ننصح بتثبيت التردد ${bandTxt} بدل البرج: الراوتر يبقى حر يختار أقوى برج على نفس التردد، وأقل خطر يوقف الدمج.`
        : '\n\n⚠️ التثبيت على برج واحد غالباً يوقف دمج الترددات.') +
      (notes ? `\n\n${notes}` : '');

    const buttons: { text: string; style?: 'cancel' | 'default' | 'destructive'; onPress?: () => void }[] = [
      { text: 'إلغاء', style: 'cancel' },
    ];
    if (canBand) buttons.push({ text: `ثبّت التردد ${bandTxt} (أنصح)`, onPress: doBand });
    buttons.push({ text: canBand ? 'ثبّت البرج نفسه' : 'تثبيت', onPress: doCell });

    Alert.alert(`تثبيت على ${towerTitle(tower)}`, intro, buttons);
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
  const lteNow = cells.find(c => c.kind === 'serving' && c.tech === 'LTE');
  const nrNow = cells.find(c => c.tech === 'NR' && (c.kind === 'serving' || c.kind === 'secondary'));
  const primary = groups.find(g => g.role === 'primary');
  const inUse = groups.filter(g => g.inUse);
  const others = groups.filter(g => !g.inUse);
  const bestOther = others[0];
  const currentScore = primary ? rankScore(primary.best) : 0;
  const worthIt = !!bestOther && bestOther.score > currentScore + 0.08;
  const lowCand = !!bestOther && isLowBand(bestOther.best);

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView
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

        {!loading && cellLock && (
          <View style={s.lockBanner}>
            <Pressable
              style={s.unlockBtn}
              onPress={() => primary && onLock(primary.best)}
              disabled={busy}
            >
              <Text style={s.unlockText}>فك</Text>
            </Pressable>
            <Text style={s.lockBannerText}>
              الراوتر مثبّت على برج PCI {cellLock.pci}{cellLock.band ? ` · B${cellLock.band}` : ''}
            </Text>
          </View>
        )}

        {!loading && (lteNow || nrNow || nrAvail) && (
          <GlassCard title="الاتصال الحالي" icon="📶" tint={C.blueSoft} collapsible={false}>
            <View style={s.dual}>
              {[{ c: lteNow, tag: '4G', color: C.blue }, { c: nrNow, tag: '5G', color: C.violet }].map(({ c, tag, color }) => {
                const lv = overallLevel(c);
                return (
                  <View key={tag} style={[s.dualBox, !c && { opacity: tag === '5G' && nrAvail ? 0.85 : 0.45 }]}>
                    <View style={[s.dualTag, { backgroundColor: color }]}>
                      <Text style={s.dualTagText}>{tag}</Text>
                    </View>
                    {c ? (
                      <>
                        <Text style={s.dualBand}>{towerTitle(c)}</Text>
                        <Text style={[s.dualRsrp, { color: LEVEL_COLOR[lv] }]}>{c.rsrp ?? '—'} dBm</Text>
                        <Text style={s.dualSinr}>SINR {c.sinr ?? '—'} dB</Text>
                        <Text style={[s.dualLevel, { color: LEVEL_COLOR[lv] }]}>{LEVEL_LABEL[lv]}</Text>
                      </>
                    ) : tag === '5G' && nrAvail ? (
                      <>
                        <Text style={[s.dualBand, { color: C.violet }]}>البرج يدعم 5G</Text>
                        <Text style={s.dualSinr}>غير نشط الحين</Text>
                        <Text style={s.dualNone}>ينشط وقت التحميل. لو ما نشط أبداً، الأرجح شريحتك ما تدعمه</Text>
                      </>
                    ) : (
                      <Text style={s.dualNone}>غير متصل</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </GlassCard>
        )}

        {!loading && canLock && primary && (
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
                <Pressable style={[s.recBtn, busy && { opacity: 0.5 }]} onPress={() => onLock(bestOther.best)} disabled={busy}>
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
              <TowerGroupCard key={g.key} g={g} cellLock={cellLock} canLock={canLock} busy={busy} onLock={onLock} />
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
              <TowerGroupCard key={g.key} g={g} rank={i + 1} cellLock={cellLock} canLock={canLock} busy={busy} onLock={onLock} />
            ))}
            {others.length > 0 && (
              <Text style={s.hint}>مرتّبة حسب الجودة الفعلية (القوة + الجودة + نوع التردد)، مو القوة لحالها.</Text>
            )}
          </GlassCard>
        )}

        {!loading && (
          <GlassCard title="كيف نقرأ الأبراج؟" icon="ℹ️" tint={C.goldSoft} defaultOpen={false}>
            <Text style={s.hint}>
              كل بطاقة = برج واحد. نجمع الترددات اللي لها نفس رقم البرج (PCI)، لأنها غالباً على نفس العمود.
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
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  center: { alignItems: 'center', gap: 10, paddingVertical: 30 },
  muted: { color: C.sub, textAlign: 'center', lineHeight: 22 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  lowNote: { color: C.gold, fontSize: 12, textAlign: 'right', lineHeight: 19, fontWeight: '700' },
  link: { color: C.blue, fontSize: 12.5, textAlign: 'center', fontWeight: '700', marginTop: 2 },
  errorCard: { backgroundColor: C.redSoft, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  errorText: { color: C.red, fontWeight: '700', textAlign: 'right' },
  retryBtn: { alignSelf: 'flex-end', backgroundColor: C.red, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  retryText: { color: '#fff', fontWeight: '700' },

  tower: { backgroundColor: C.rowBg, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder, padding: 12, gap: 10 },
  towerInUse: { borderColor: C.green, borderWidth: 1.5 },
  towerHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, justifyContent: 'flex-start' },
  towerName: { color: C.text, fontWeight: '800', fontSize: 16, textAlign: 'right' },
  techTag: { backgroundColor: C.blue, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 1 },
  techTagText: { color: '#fff', fontWeight: '800', fontSize: 10.5 },
  role: { color: C.sub, fontSize: 11.5, textAlign: 'right', marginTop: 2 },
  rank: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  rankText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  badgeRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontWeight: '800', fontSize: 11.5 },
  grade: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 4 },
  gradeText: { color: '#fff', fontWeight: '800', fontSize: 11.5 },
  freqRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  freq: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  freqOn: { borderColor: C.green },
  freqDot: { width: 7, height: 7, borderRadius: 4 },
  freqBand: { color: C.text, fontWeight: '800', fontSize: 12.5 },
  freqMhz: { color: C.muted, fontSize: 10.5 },
  freqRsrp: { color: C.sub, fontSize: 10.5, fontWeight: '700' },
  metrics: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  metric: { flex: 1, alignItems: 'center', backgroundColor: C.card, borderRadius: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.cardBorder },
  metricVal: { color: C.text, fontWeight: '800', fontSize: 16 },
  metricUnit: { color: C.muted, fontSize: 10 },
  metricLabel: { color: C.sub, fontSize: 11, fontWeight: '700', marginTop: 2 },
  lockBtn: { borderRadius: 12, borderWidth: 1, borderColor: C.blue, paddingVertical: 10, alignItems: 'center' },
  lockBtnOn: { backgroundColor: C.blue, borderColor: C.blue },
  lockText: { color: C.blue, fontWeight: '800', fontSize: 13 },

  dual: { flexDirection: 'row', gap: 10 },
  dualBox: { flex: 1, backgroundColor: C.rowBg, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder, padding: 12, alignItems: 'center', gap: 3 },
  dualTag: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3, marginBottom: 4 },
  dualTagText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  dualBand: { color: C.text, fontWeight: '800', fontSize: 13, textAlign: 'center' },
  dualRsrp: { fontWeight: '800', fontSize: 18 },
  dualSinr: { color: C.sub, fontSize: 11, textAlign: 'center' },
  dualLevel: { fontWeight: '800', fontSize: 12, marginTop: 2 },
  dualNone: { color: C.muted, fontSize: 11, paddingVertical: 6, textAlign: 'center', lineHeight: 16 },

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
