import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession, routerWrite } from '../../src/store/sessions';
import { BandConfig, Carrier, CellTower } from '../../src/drivers/types';
import { safeApply, trialMessage, lastTrial, Trial } from '../../src/utils/safeLock';
import { NetStandard, NET_STANDARDS, STANDARD_LABEL } from '../../src/drivers/huawei/netStandard';
import { trafficBurst } from '../../src/utils/nrprobe';
import { bandLabel, freqLabel } from '../../src/utils/bands';
import { saveProfile } from '../../src/store/profiles';
import { useOperatorBands } from '../../src/store/operator';
import { C, glow, isDark, tBg } from '../../src/ui/theme';
import { Icon, IconName } from '../../src/ui/Icon';
import { GlassCard } from '../../src/ui/GlassCard';

import { sheet } from '../../src/i18n';
import { SEC_ORANGE } from '../../src/ui/ComboCard';
import { comboPlan } from '../../src/utils/comboPlan';
const LTE_ONLY = '03';
/** 'any' = البرج يختار · 'none' = 4G فقط · قائمة = نسمح بهالترددات بس (وحدة أو أكثر) */
type NrPick = 'any' | 'none' | number[];
const nrHas = (p: NrPick, b: number) => Array.isArray(p) && p.includes(b);

/** أقوى قراءة لكل تردد من الأبراج المرصودة */
function bestBySeen(cells: CellTower[], tech: 'LTE' | 'NR') {
  const m = new Map<number, number>();
  for (const c of cells) {
    if (c.tech !== tech || !c.band || c.rsrp === undefined) continue;
    m.set(c.band, Math.max(c.rsrp, m.get(c.band) ?? -999));
  }
  return m;
}

const rsrpCol = (v?: number) => (v === undefined ? C.sub : v >= -85 ? C.green : v >= -100 ? '#e0a100' : C.red);

/** خطوات التطبيق (تطابق رسائل safeApply في utils/safeLock) */
const APPLY_STEPS: { k: string; t: string; icon: IconName; m: RegExp }[] = [
  { k: 'measure', t: 'نقيس الوضع الحالي', icon: 'chart', m: /نقرأ إعدادك|نقيس الوضع الحالي/ },
  { k: 'apply', t: 'نطبّق التغيير', icon: 'refresh', m: /نطبّق التغيير|لسا يطبّق|لسا ينفّذ/ },
  { k: 'wait', t: 'ننتظر الراوتر يتصل', icon: 'clock', m: /ننتظر الراوتر يتصل|ننتظر الإشارة/ },
  { k: 'after', t: 'نقيس النتيجة', icon: 'chart', m: /نقيس بعد/ },
];
/** المدة المتوقعة تقريباً (ثانية) — للعداد «باقي تقريباً» */
const APPLY_EST = 75;

export default function ComboScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const op = useOperatorBands(id);
  const [allBands, setAllBands] = useState(false);
  const [cells, setCells] = useState<CellTower[]>([]);
  const [carriers, setCarriers] = useState<Carrier[] | null>(null);
  const [primary, setPrimary] = useState<number | null>(null);
  const [extra, setExtra] = useState<number[]>([]);
  /** «الثانوي: تلقائي» — الأساسي ثابت وكل باقي ترددات 4G «ثانوي بس» (الدمج مفتوح) — راوترات الأدوار بس (هواوي lock-freq) */
  const [autoSec, setAutoSec] = useState(false);
  /** أساسي 5G لما تختار أكثر من تردد 5G (الباقي «ثانوي بس») — null = البرج يختار */
  const [nrPrimary, setNrPrimary] = useState<number | null>(null);
  const [nr, setNr] = useState<NrPick>('any');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  // تقدّم التطبيق (تصميم حسن): الخطوات + مرّ/باقي
  const [startAt, setStartAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const stepMax = useRef(0);
  useEffect(() => {
    if (!busy) { setStartAt(null); stepMax.current = 0; return; }
    setStartAt(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);
  const [error, setError] = useState('');
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
  /** «وضع الشبكة» الدقيق (هواوي WebUI 4.0) — null = الراوتر ما يدعمه، نعرض الخيارين القدام */
  const [std, setStd] = useState<NetStandard | null>(null);
  /** آخر تجربة SA — لو ما اتصل نقول للمستخدم إنه غالباً مو متاح عنده بدل ما يجربه كل مرة */
  const [saTrial, setSaTrial] = useState<Trial | undefined>();
  useEffect(() => {
    if (info) lastTrial(info.id, 'mode:08').then(t => mounted.current && setSaTrial(t)).catch(() => {});
  }, [info, busy]);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async (r: SavedRouter) => {
    try {
      const [c, list, st] = await withSession(r, async d => [
        d.getBandConfig ? await d.getBandConfig() : null,
        d.getCells ? await d.getCells().catch(() => [] as CellTower[]) : ([] as CellTower[]),
        d.getNetStandard ? await d.getNetStandard().catch(() => null) : null,
      ] as const);
      if (!mounted.current) return;
      setStd(st);
      setCfg(c);
      setCells(list);
      // نبدأ من الإعداد الحالي
      if (c) {
        if (c.locked.length) {
          // الأساسي = أول تردد مو «ثانوي بس»
          const p0 = c.locked.find(b => !(c.lteScell ?? []).includes(b)) ?? c.locked[0];
          setPrimary(p0);
          const ex = c.locked.filter(b => b !== p0);
          // كل الباقي مسموح كثانوي = «تلقائي»
          const isAuto = !!c.bandRoles && ex.length > 0 && c.supported.every(b => b === p0 || ex.includes(b));
          setAutoSec(isAuto);
          setExtra(isAuto ? [] : ex);
        }
        // ما فيه تثبيت ← الافتراضي «أي ثانوي» (تختار الأساسي بس والدمج يبقى مفتوح — مثل صفحة الراوتر)
        if (c.bandRoles && !c.locked.length) setAutoSec(true);
        if (c.bandRoles && c.nrLocked.length > 1) {
          const np = c.nrLocked.find(b => !(c.nrScell ?? []).includes(b));
          setNrPrimary(np !== undefined && (c.nrScell ?? []).length ? np : null);
        }
        if (c.mode === LTE_ONLY) setNr('none');
        // مقفل على بعض ترددات 5G (مو كلها) ← نعرضها مختارة. كلها = عملياً «أي 5G»
        else if (c.nrLocked.length && c.nrLocked.length < (c.nrPreferred ?? c.nrSupported).length) setNr([...c.nrLocked]);
      }
    } catch (e: any) {
      if (mounted.current) setError(e?.message ?? String(e));
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

  /** يشغّل تحميل قصير ويقرأ الناقلات — الدمج يشتغل بس وقت الاستخدام */
  const readCa = async (r: SavedRouter): Promise<Carrier[]> => {
    setStatus('نشغّل تحميل قصير عشان البرج يفعّل الدمج...');
    const burst = trafficBurst(9000).catch(() => 0);
    let best: Carrier[] = [];
    for (let i = 0; i < 3; i++) {
      await new Promise(x => setTimeout(x, 2600));
      const list = await withSession(r, async d => (d.getCarriers ? d.getCarriers() : [])).catch(() => [] as Carrier[]);
      if (list.length > best.length) best = list;
    }
    await burst;
    return best;
  };

  const nrModes = !!cfg?.modes.some(m => m.value === LTE_ONLY);

  const apply = () => {
    if (!info || !cfg || primary === null) return;
    const auto = autoSec && !!cfg.bandRoles;
    const nrBands = Array.isArray(nr) ? nr : [];
    // «تلقائي»: كل ترددات الراوتر الثانية تنضاف «ثانوي بس» — الأساسي ثابت والدمج مفتوح.
    // الراوترات اللي تدعم الأدوار (هواوي lock-freq): الإضافية «ثانوي بس» — ما يختارها أساسي بدل اللي اخترته
    const { lte, roles, nrPrimary: np } = comboPlan({
      primary, extra, auto, supported: cfg.supported, bandRoles: !!cfg.bandRoles, nr: nrBands, nrPrimary,
    });
    const origRoles = cfg.bandRoles ? { lteScell: cfg.lteScell ?? [], nrScell: cfg.nrScell ?? [] } : undefined;
    const lteTxt = auto ? `${bandLabel('LTE', primary)} ⭐ + أي ثانوي` : lte.map(b => bandLabel('LTE', b)).join(' + ');
    const nrTxt = nr === 'none' ? ' · بدون 5G'
      : Array.isArray(nr) ? ` + ${nr.map(b => bandLabel('NR', b) + (b === np ? ' ⭐' : '')).join(' + ')}` : ' + أي 5G';
    const label = `${lteTxt}${nrTxt}`;
    const orig = cfg;
    if (nr !== 'none' && cfg.lteLockKills5g) {
      Alert.alert('ما ينفع على راوترك', 'راوترك ما يثبّت ترددات 4G إلا وهو على «4G فقط» — يعني الـ 5G بيطفي، فدمج 4G مثبّت مع 5G مستحيل عليه.\n\nجرّب «بدون 5G»، أو خلّ 4G تلقائي والراوتر يدمج 5G لحاله.');
      return;
    }
    Alert.alert('طبّق الأساسي والثانوي', `${label}\n\nنقيس قبل وبعد، ولو صار أسوأ أو انقطع النت نرجّع إعدادك لحاله.`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'طبّق', onPress: async () => {
          setBusy(true);
          setError('');
          setVerdict(null);
          try {
            const res = await safeApply({
              r: info,
              key: `combo:${auto ? `${primary}+auto` : lte.join('+')}:${Array.isArray(nr) ? nr.join('+') + (np !== null ? `*${np}` : '') : nr}`,
              label,
              withNr: nr !== 'none',
              onStatus: t => mounted.current && setStatus(t),
              apply: async d => {
                if (nr === 'none') {
                  if (orig.mode !== LTE_ONLY && d.setNetworkMode) await d.setNetworkMode(LTE_ONLY);
                  await d.setBand!(lte, undefined, roles); // 5G «مثل ما هو»
                } else {
                  if ((orig.mode === LTE_ONLY || orig.mode === '08') && d.setNetworkMode) await d.setNetworkMode('00');
                  await d.setBand!(lte, nrBands, roles);
                }
              },
              revert: async d => {
                if (d.setNetworkMode && orig.mode) {
                  try { await d.setNetworkMode(orig.mode); } catch {}
                }
                await d.setBand!(orig.locked, orig.nrLocked, origRoles);
              },
            });
            const m = trialMessage(res, label);
            if (!res.kept) {
              Alert.alert(m.title, m.body);
              return;
            }
            // نتأكد: هل البرج فعلاً شغّل الأساسي والثانوي المطلوبين؟
            const list = await readCa(info);
            if (!mounted.current) return;
            setCarriers(list);
            const pcc = list.find(c => c.role === 'PCC' && c.tech === 'LTE');
            const hasNr = list.some(c => c.tech === 'NR' && (!Array.isArray(nr) || nr.includes(c.band)));
            const nrOn = [...new Set(list.filter(c => c.tech === 'NR').map(c => c.band))];
            const pOk = !pcc || pcc.band === primary;
            const nOk = nr === 'none' ? !list.some(c => c.tech === 'NR') : hasNr;
            const extraOn = list.filter(c => c.tech === 'LTE' && c.role === 'SCC').map(c => c.band);
            setVerdict({
              ok: pOk && nOk,
              text: [
                pcc ? (pOk ? `✓ الأساسي ${bandLabel('LTE', pcc.band)}` : `✗ الأساسي طلع ${bandLabel('LTE', pcc.band)} بدل ${bandLabel('LTE', primary)}`) : '• ما قدرنا نقرأ الأساسي',
                nr === 'none' ? (nOk ? '✓ بدون 5G' : '✗ الـ 5G للحين شغال')
                  : nOk ? `✓ الـ 5G مدموج: ${nrOn.map(b => bandLabel('NR', b)).join(' + ')}${Array.isArray(nr) && nr.length > 1 && nrOn.length < 2 ? ' (البرج دمج واحد بس من اللي اخترتها — عادي في NSA)' : ''}`
                  : '✗ البرج ما شغّل الـ 5G — غالباً ما يدمجه مع هالأساسي',
                auto ? (extraOn.length ? `✓ الثانوي (تلقائي): ${extraOn.map(b => bandLabel('LTE', b)).join(' + ')}` : '• الثانوي ما شبك للحين — البرج يضيفه وقت التحميل')
                  : extra.length ? (extraOn.length ? `✓ دمج 4G: ${extraOn.map(b => bandLabel('LTE', b)).join(' + ')}` : '✗ البرج ما دمج ترددات 4G الإضافية') : '',
                np !== null ? (list.some(c => c.tech === 'NR' && c.role === 'PCC' && c.band === np) || nrOn[0] === np ? `✓ أساسي 5G ${bandLabel('NR', np)}` : `• أساسي 5G ${bandLabel('NR', np)} — البرج شغّل ${nrOn.map(b => bandLabel('NR', b)).join(' + ') || 'غيره'}`) : '',
              ].filter(Boolean).join('\n'),
            });
            await saveProfile({ routerId: info.id, name: label, bands: lte, nrBands: nrBands, mode: nr === 'none' ? LTE_ONLY : orig.mode });
          } catch (e: any) {
            if (mounted.current) setError(e?.message ?? String(e));
          } finally {
            if (mounted.current) { setBusy(false); setStatus(''); await load(info); }
          }
        },
      },
    ]);
  };

  const reset = () => {
    if (!info || !cfg) return;
    Alert.alert('رجوع للتلقائي', 'نفك كل الأقفال ونخلي الراوتر يختار بنفسه.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'رجّع', onPress: async () => {
          setBusy(true);
          try {
            await routerWrite(info, async d => {
              if ((cfg.mode === LTE_ONLY || cfg.mode === '08') && d.setNetworkMode) await d.setNetworkMode('00');
              await d.setBand!([], []);
            }, { label: 'رجوع للتلقائي' });
            setPrimary(null); setExtra([]); setNr('any'); setVerdict(null); setAutoSec(!!cfg?.bandRoles); setNrPrimary(null);
            await load(info);
          } catch (e: any) {
            setError(e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const lteSeen = bestBySeen(cells, 'LTE');
  const nrSeen = bestBySeen(cells, 'NR');
  const sortBands = (list: number[], seen: Map<number, number>) =>
    [...list].sort((a, b) => (seen.has(b) ? 1 : 0) - (seen.has(a) ? 1 : 0) || (seen.get(b) ?? -999) - (seen.get(a) ?? -999) || a - b);
  // ترددات شبكة الشريحة أول (زين/موبايلي/stc) — وما نخفي أبداً تردد فيه برج أو مختار أو مقفل عليه
  const keepLte = (b: number) => !op || allBands || op.bands.lte.includes(b) || lteSeen.has(b) ||
    primary === b || extra.includes(b) || !!cfg?.locked.includes(b);
  const keepNr = (b: number) => !op || allBands || op.bands.nr.includes(b) || nrSeen.has(b) ||
    nrHas(nr, b) || !!cfg?.nrLocked.includes(b);
  const lteAll = cfg ? sortBands(cfg.supported, lteSeen) : [];
  const nrAll = cfg ? sortBands(cfg.nrSupported, nrSeen) : [];
  const lteList = lteAll.filter(keepLte);
  const nrList = nrAll.filter(keepNr);
  const hiddenCount = op && !allBands ? (lteAll.length - lteList.length) + (nrAll.length - nrList.length) : 0;

  /** نفس تصميم أزرار شاشة الترددات: مربع صح + الاسم والتردد — وتحتها قوة الإشارة */
  const Tile = ({ label, sub, sig, on, onPress, color, faint }: {
    label: string; sub?: string; sig?: number; on: boolean; onPress: () => void; color: string; faint?: boolean;
  }) => (
    // ٢٣ نوفمبر (تصميم حسن): بطاقة زجاجية بحد ملوّن + مربع اختيار؛ المختار يتلوّن ويتوهج
    <Pressable
      style={[s.tile, { backgroundColor: isDark ? color + (on ? '40' : '1a') : tBg(color + (on ? '26' : '0f')), borderColor: on ? color : color + '55' },
        on && glow(color, 14), faint && !on && s.tileFaint, busy && s.dim]}
      onPress={onPress}
      disabled={busy}
    >
      <View style={[s.miniCheck, { borderColor: on ? color : color + '88' }, on && { backgroundColor: color }]}>
        {on && <Text style={[s.checkMark, { color: '#ffffff' }]}>✓</Text>}
      </View>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={s.tileName} numberOfLines={1}>{label}</Text>
        {!!sub && <Text style={s.tileSub} numberOfLines={1}>{sub}</Text>}
        {sig !== undefined && <Text style={[s.tileSig, { color: rsrpCol(sig) }]}>{sig} dBm</Text>}
      </View>
    </Pressable>
  );

  const SA_COLOR = '#0ea5a4';

  /** الخيارات الستة من صفحة المطورين — بالقفل الآمن وترجع لو ما اتصل */
  const applyStd = (target: NetStandard) => {
    if (!info || !std || target === std) return;
    const prev = std;
    const L = STANDARD_LABEL[target];
    const label = `${L.title} (${L.sub.split(' — ')[0]})`;
    const risky = target === 'sa' || target === 'lte_tdd' || target === 'lte_fdd';
    Alert.alert(label, (risky
      ? 'إذا برجك أو شريحتك ما تدعم هالوضع بينقطع النت، ونرجّعك لوضعك خلال دقيقة تقريباً.'
      : 'نقيس قبل وبعد، ولو صار أسوأ نرجّعك لوضعك.') + '\n\nالنت بينقطع لحظات.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'جرّب', onPress: async () => {
          setBusy(true);
          setError('');
          setVerdict(null);
          try {
            const res = await safeApply({
              r: info,
              key: `std:${target}`,
              label,
              withNr: target !== 'lte' && target !== 'lte_fdd' && target !== 'lte_tdd',
              onStatus: t => mounted.current && setStatus(t),
              apply: d => d.setNetStandard!(target),
              revert: d => d.setNetStandard!(prev),
            });
            const m = trialMessage(res, label);
            Alert.alert(m.title, m.body);
            await load(info);
          } catch (e: any) {
            if (mounted.current) setError(e?.message ?? String(e));
          } finally {
            if (mounted.current) { setBusy(false); setStatus(''); }
          }
        },
      },
    ]);
  };
  const hasSa = !!cfg?.modes.some(m => m.value === '08');
  const onSa = cfg?.mode === '08';

  /** ZLT (X300A…): قائمة الأوضاع كاملة من صفحة الراوتر (تلقائي = SA+NSA) — بدل خيارين NSA/SA اللي تفترض «تلقائي = 4G + 5G» */
  const fullModes = info?.driverId === 'zlt' && (cfg?.modes.length ?? 0) > 2;
  const applyMode = (target: string, label: string) => {
    if (!info || !cfg || target === cfg.mode) return;
    const orig = cfg.mode;
    Alert.alert(label, 'نقيس قبل وبعد، ولو ما اتصل أو صار أسوأ نرجّعك لوضعك.' + '\n\n' + 'النت بينقطع لحظات.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'جرّب', onPress: async () => {
          setBusy(true);
          setError('');
          setVerdict(null);
          try {
            const res = await safeApply({
              r: info,
              key: `mode:${target}`,
              label,
              withNr: target !== '03',
              onStatus: t => mounted.current && setStatus(t),
              apply: d => d.setNetworkMode!(target),
              revert: d => d.setNetworkMode!(orig),
            });
            const m = trialMessage(res, label);
            Alert.alert(m.title, m.body);
          } catch (e: any) {
            if (mounted.current) setError(e?.message ?? String(e));
          } finally {
            if (mounted.current) { setBusy(false); setStatus(''); await load(info); }
          }
        },
      },
    ]);
  };

  const applySa = (toSa: boolean) => {
    if (!info || !cfg) return;
    const orig = cfg;
    const target = toSa ? '08' : (orig.modes.some(m => m.value === '0803') ? '0803' : '00');
    const label = toSa ? '5G فقط (SA)' : '4G + 5G (NSA)';
    Alert.alert(label, toSa
      ? 'بنحوّل الراوتر لـ 5G لحاله — الـ 5G يصير هو الأساسي.\n\nإذا برجك أو شريحتك ما تدعم SA بينقطع النت، ونرجّعك لحالك على 4G + 5G خلال دقيقة تقريباً.'
      : 'بنرجّع الراوتر لـ 4G + 5G.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'جرّب', onPress: async () => {
          setBusy(true);
          setError('');
          setVerdict(null);
          try {
            const res = await safeApply({
              r: info,
              key: `mode:${target}`,
              label,
              withNr: true,
              onStatus: t => mounted.current && setStatus(t),
              apply: d => d.setNetworkMode!(target),
              revert: d => d.setNetworkMode!(orig.mode),
            });
            if (!res.kept) {
              const m = trialMessage(res, label);
              Alert.alert(toSa ? 'SA ما اشتغل عندك' : m.title, toSa
                ? 'رجّعناك على 4G + 5G. غالباً برجك أو شريحتك ما تدعم 5G SA للحين.'
                : m.body);
              return;
            }
            const list = await readCa(info);
            if (!mounted.current) return;
            setCarriers(list);
            const pcc = list.find(c => c.role === 'PCC');
            setVerdict({
              ok: toSa ? !!pcc && pcc.tech === 'NR' : true,
              text: toSa
                ? (pcc && pcc.tech === 'NR' ? `✓ صرت على 5G SA — الأساسي ${bandLabel('NR', pcc.band)}` : '• انتقل الوضع، بس ما قدرنا نقرأ الأساسي — شوف «الدمج الحين»')
                : '✓ رجعت على 4G + 5G',
            });
          } catch (e: any) {
            if (mounted.current) setError(e?.message ?? String(e));
          } finally {
            if (mounted.current) { setBusy(false); setStatus(''); await load(info); }
          }
        },
      },
    ]);
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        {loading && <View style={s.center}><ActivityIndicator size="large" color={C.blue} /></View>}
        {!!error && <View style={s.errBox}><Text style={s.err}>{error}</Text></View>}
        {!!status && !busy && (
          <View style={s.statusBox}>
            <Text style={s.statusText}>{status}</Text>
            <ActivityIndicator color={C.blue} />
          </View>
        )}
        {busy && (() => {
          // الخطوة الحالية من رسالة safeApply — وما نرجع لورا
          const idx = APPLY_STEPS.reduce((a, st, i) => (st.m.test(status) ? i : a), -1);
          if (idx > stepMax.current) stepMax.current = idx;
          const cur = Math.max(0, stepMax.current);
          const back = /نرجّع|نفك|رفض|ما اتصل|ما رجع/.test(status);
          const el = startAt ? Math.max(0, Math.round((now - startAt) / 1000)) : 0;
          const left = Math.max(5, APPLY_EST - el);
          const frac = Math.min(0.97, Math.max((cur + 0.5) / APPLY_STEPS.length, el / (APPLY_EST + 10)));
          return (
            <View style={[s.prog, glow('#3b82f6', 16)]}>
              {APPLY_STEPS.map((st, i) => {
                const done = i < cur;
                const on = i === cur;
                return (
                  <View key={st.k} style={[s.stepRow, i < APPLY_STEPS.length - 1 && s.stepLine]}>
                    <View style={[s.stepDot, done && { backgroundColor: '#22c55e', borderColor: '#22c55e' }, on && { borderColor: C.blue }]}>
                      {done ? <Text style={s.stepCheck}>✓</Text> : on ? <View style={s.stepInner} /> : null}
                    </View>
                    <Icon name={st.icon} size={20} color={done || on ? '#60a5fa' : C.muted} stroke={2.2} />
                    <Text style={[s.stepTxt, !(done || on) && { color: C.muted }]}>{st.t}</Text>
                    {on && <ActivityIndicator size="small" color={C.blue} />}
                  </View>
                );
              })}
              {!!status && <Text style={[s.stepNow, back && { color: C.red }]}>{status}</Text>}
              <View style={s.progTrack}>
                <LinearGradient colors={['#22d3ee', '#3b82f6', '#a855f7']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.progFill, { width: `${Math.round(frac * 100)}%` }]} />
              </View>
              <View style={s.timeRow}>
                <View style={[s.timeBox, { borderColor: '#22c55e66', backgroundColor: isDark ? '#0f2a24' : tBg('#e9f9f0') }]}>
                  <Icon name="clock" size={18} color="#22c55e" stroke={2.4} />
                  <Text style={s.timeTxt}>باقي تقريباً <Text style={[s.timeNum, { color: '#22c55e' }]}>{left}</Text> ثانية</Text>
                </View>
                <View style={s.timeBox}>
                  <Icon name="clock" size={18} color="#a78bfa" stroke={2.4} />
                  <Text style={s.timeTxt}>مرّ <Text style={s.timeNum}>{el}</Text> ثانية</Text>
                </View>
              </View>
              <View style={s.warnBox}>
                <Text style={s.warnIcon}>⚠️</Text>
                <Text style={s.warnTxt}>لا تطلع من الشاشة — الراوتر في نص التغيير، ونقول لك لما يخلص</Text>
              </View>
            </View>
          );
        })()}

        {!loading && !cfg && <Text style={s.hint}>راوترك ما يدعم قفل الترددات، فما نقدر نحدد الأساسي والثانوي.</Text>}

        {!loading && cfg && (
          <>
            {(hasSa || !!std || fullModes) && (
              <View style={[s.saCard, onSa && { borderColor: SA_COLOR }]}>
                <View style={s.saHead}>
                  <View style={[s.saBadge, { backgroundColor: SA_COLOR }]}><Text style={s.saBadgeTxt}>جديد</Text></View>
                  <Text style={s.saTitle}>وضع الشبكة</Text>
                </View>
                <Text style={s.hint}>
                  {fullModes
                    ? `أنت الحين على: ${cfg.modes.find(m => m.value === cfg.mode)?.label ?? cfg.mode}. نفس خيارات صفحة راوترك.`
                    : std
                    ? `أنت الحين على: ${STANDARD_LABEL[std].title} (${STANDARD_LABEL[std].sub}). نفس خيارات صفحة المطورين في راوترك.`
                    : onSa ? 'أنت الحين على 5G لحاله — الـ 5G هو الأساسي' : 'أنت على 4G + 5G: الأساسي 4G والـ 5G ثانوي. جرّب SA عشان يصير الـ 5G هو الأساسي'}
                </Text>
                {fullModes ? (
                  <View style={s.grid}>
                    {cfg.modes.map(m => (
                      <Tile key={m.value} label={m.label} on={cfg.mode === m.value}
                        color={/SA/.test(m.label) || m.value === '00' ? SA_COLOR : m.value === '03' ? C.sub : C.blue}
                        onPress={() => !busy && applyMode(m.value, m.label)} />
                    ))}
                  </View>
                ) : std ? (
                  <View style={s.grid}>
                    {NET_STANDARDS.map(x => (
                      <Tile key={x} label={STANDARD_LABEL[x].title} sub={STANDARD_LABEL[x].sub} on={std === x}
                        color={x === 'sa' || x === 'sa_nsa' ? SA_COLOR : x === 'nsa' ? C.blue : C.sub}
                        onPress={() => !busy && applyStd(x)} />
                    ))}
                  </View>
                ) : (
                <View style={s.grid}>
                  <Tile label="4G + 5G" sub="NSA — الحالي عند أغلب الناس" on={!onSa} color={C.blue} onPress={() => onSa && applySa(false)} />
                  <Tile label="5G فقط" sub="SA — الـ 5G أساسي" on={onSa} color={SA_COLOR} onPress={() => !onSa && applySa(true)} />
                </View>
                )}
                {!fullModes && !onSa && saTrial?.verdict === 'noconn' && Date.now() - saTrial.at < 14 * 86400000 && (
                  <Text style={[s.hint, { color: C.red }]}>
                    جرّبنا SA {Date.now() - saTrial.at < 86400000 ? 'اليوم' : 'قبل أيام'} وما اتصل — غالباً البرج عندك يدعم 5G بنظام NSA بس (فوق 4G)، أو شريحتك ما فيها SA.
                  </Text>
                )}
              </View>
            )}

            <GlassCard title="١. الأساسي (4G)" icon="⭐" tint={C.blueSoft} collapsible={false}>
              <Text style={s.hint}>التردد اللي يمسك الاتصال. القوة تحت كل تردد من الأبراج اللي يشوفها راوترك الحين</Text>
              <Text style={s.hint}>💡 أساسي واحد بس (هذا من الشبكة). ولو برجك فيه قناتين على نفس التردد (مثل B1 + B1)، الراوتر يدمجها لحاله — جرّبها من «دمج 4G المزدوج».</Text>
              <View style={s.grid}>
                {lteList.map(b => (
                  <Tile key={b} label={bandLabel('LTE', b)} sub={freqLabel('LTE', b) || undefined} sig={lteSeen.get(b)} faint={!lteSeen.has(b)}
                    color={C.blue} on={primary === b}
                    onPress={() => { setPrimary(b); setExtra(x => x.filter(y => y !== b)); }} />
                ))}
              </View>
            </GlassCard>

            <GlassCard title="٢. دمج 4G إضافي (اختياري)" icon="➕" tint={C.goldSoft} defaultOpen={extra.length > 0}>
              <Text style={s.hint}>
                {cfg?.bandRoles
                  ? 'ترددات 4G ثانية يُسمح للبرج يدمجها مع الأساسي — تنضاف «ثانوي بس»، فالراوتر ما يختار واحد منها أساسي بدل اللي اخترته'
                  : 'ترددات 4G ثانية يُسمح للبرج يدمجها مع الأساسي. ⚠️ لما تسمح بأكثر من تردد، ممكن الراوتر يختار واحد منها كأساسي بدل اللي اخترته'}
              </Text>
              {/* نفس التردد مع نفسه: ما يحتاج اختيار — تثبيت B3 يسمح لحاله بـ B3 + B3 لو البرج فيه قناتين */}
              {primary !== null && (
                <Pressable onPress={() => router.push(`/nrdual/${id}?t=lte` as Href)} accessibilityRole="button"
                  style={({ pressed }) => [s.sameBand, pressed && { opacity: 0.8 }]}>
                  <View style={s.sameRow}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={s.sameTitle}>✓ {bandLabel('LTE', primary)} + {bandLabel('LTE', primary)} مسموح تلقائياً</Text>
                      <Text style={s.sameSub}>
                        لو برجك فيه قناتين على {bandLabel('LTE', primary)} يدمجها لحاله — اضغط هنا وشوف إذا برجك يدعمها ←
                      </Text>
                    </View>
                    <View style={s.sameIcon}><Icon name="tower" size={24} color="#60a5fa" stroke={2} /></View>
                  </View>
                </Pressable>
              )}
              <View style={s.grid}>
                {!!cfg?.bandRoles && (
                  <Tile label="أي ثانوي" sub="تلقائي — الدمج مفتوح" color={SEC_ORANGE} on={autoSec}
                    onPress={() => { setAutoSec(v => !v); setExtra([]); }} />
                )}
                {lteList.filter(b => b !== primary).map(b => (
                  <Tile key={b} label={bandLabel('LTE', b)} sub={freqLabel('LTE', b) || undefined} sig={lteSeen.get(b)} faint={!lteSeen.has(b)}
                    color={SEC_ORANGE} on={autoSec || extra.includes(b)}
                    onPress={() => { setAutoSec(false); setExtra(x => (x.includes(b) ? x.filter(y => y !== b) : [...x, b])); }} />
                ))}
              </View>
              {!!cfg?.bandRoles && primary !== null && !autoSec && extra.length === 0 && (
                <Text style={[s.hint, { color: SEC_ORANGE }]}>⚠️ بدون ثانوي = {bandLabel('LTE', primary)} لحاله والدمج ينقطع. تبي الأساسي ثابت والباقي يدمج؟ اختر «أي ثانوي».</Text>
              )}
            </GlassCard>

            <GlassCard title="٣. الثانوي (5G)" icon="⚡" tint={C.violetSoft} collapsible={false}>
              <Text style={s.hint}>التردد اللي ينضاف للسرعة. تقدر تختار أكثر من واحد — البرج هو اللي يقرر يشغّل أي واحد ويدمج كم</Text>
              <View style={s.grid}>
                <Tile label="أي 5G" sub="تلقائي" color={C.violet} on={nr === 'any'} onPress={() => setNr('any')} />
                {nrList.map(b => (
                  <Tile key={b} label={bandLabel('NR', b)} sub={freqLabel('NR', b) || undefined} sig={nrSeen.get(b)} faint={!nrSeen.has(b)}
                    color={C.violet} on={nrHas(nr, b)}
                    onPress={() => setNr(p => {
                      if (!Array.isArray(p)) return [b];
                      if (p.includes(b)) return p.length === 1 ? 'any' : p.filter(x => x !== b);
                      return [...p, b];
                    })} />
                ))}
                {nrModes && (
                  <Tile label="بدون 5G" sub="4G فقط" color={C.sub} on={nr === 'none'} onPress={() => setNr('none')} />
                )}
              </View>
              {Array.isArray(nr) && nr.length > 1 && (
                <Text style={s.hint}>✓ اخترت {nr.length} ترددات 5G — الراوتر يستخدم الأقوى منها. دمجها مع بعض يعتمد على الشركة والبرج (غالباً في وضع SA)، وبعد التطبيق نقولك وش اشتغل فعلاً.</Text>
              )}
              {!!cfg?.bandRoles && Array.isArray(nr) && nr.length > 1 && (
                <>
                  <Text style={s.hint}>⭐ أساسي 5G (اختياري) — الباقي ينضاف «ثانوي بس»:</Text>
                  <View style={s.grid}>
                    <Tile label="البرج يختار" sub="تلقائي" color={C.violet} on={nrPrimary === null || !nr.includes(nrPrimary)} onPress={() => setNrPrimary(null)} />
                    {nr.map(b => (
                      <Tile key={b} label={`${bandLabel('NR', b)} ⭐`} sub="أساسي" color={C.violet} on={nrPrimary === b} onPress={() => setNrPrimary(b)} />
                    ))}
                  </View>
                </>
              )}
              {cfg?.nrLockable === false && (
                <Text style={s.hint}>⚡ راوترك ما يقبل تثبيت تردد 5G معيّن — يا تخليه «أي 5G» (البرج يختار) يا «بدون 5G».</Text>
              )}
            </GlassCard>

            {!!op && (hiddenCount > 0 || allBands) && (
              <Pressable onPress={() => setAllBands(v => !v)} hitSlop={6} style={s.moreRow}>
                <Text style={s.moreTxt}>
                  {allBands ? `اعرض ترددات ${op.name} بس` : `💡 نعرض ترددات ${op.name} بس — اعرض كل ترددات الراوتر (+${hiddenCount})`}
                </Text>
              </Pressable>
            )}

            {primary !== null && (() => {
              const lteSel = autoSec ? null : [primary, ...extra];
              const best = (autoSec || extra.length >= lteList.length - 1) && nr === 'any';
              const lteTxt = lteSel ? lteSel.map(b => bandLabel('LTE', b)).join(' + ') : `${bandLabel('LTE', primary)} + أي ثانوي`;
              const nrTxt = nr === 'none' ? '' : Array.isArray(nr) ? nr.map(b => bandLabel('NR', b)).join(' + ') : 'أي 5G';
              return (
                <View style={[s.plan, glow('#3b82f6', 18)]}>
                  <View style={s.planBadge}><Text style={s.planBadgeTxt}>{best ? '⭐ أقوى تجميعة ممكنة' : '⭐ التجميعة اللي بنطبّقها'}</Text></View>
                  <View style={s.planRow}>
                    <View style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={s.planLte}>{lteTxt}</Text>
                      {!!nrTxt && <Text style={s.planNr}>{`ومعه ${nrTxt}`}</Text>}
                      {nr === 'none' && <Text style={s.planNone}>بدون 5G</Text>}
                    </View>
                    <Text style={s.planRocket}>🚀</Text>
                  </View>
                </View>
              );
            })()}

            <Pressable onPress={apply} disabled={busy || primary === null}
              style={({ pressed }) => [{ borderRadius: 999 }, glow('#6a4cff', 18), (busy || primary === null) && s.dim, pressed && { opacity: 0.88 }]}>
              <LinearGradient colors={['#2f8bff', '#2f6bff', '#8b3dff']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={s.btn}>
                <View style={s.btnCheck}><Text style={s.btnCheckTxt}>✓</Text></View>
                <Text style={s.btnTxt}>{primary === null ? 'اختر الأساسي أول' : 'طبّق وتأكد من الدمج'}</Text>
                <View style={{ transform: [{ scaleX: -1 }] }}><Icon name="chevron" size={18} color="#ffffff" /></View>
              </LinearGradient>
            </Pressable>

            {verdict && (
              <View style={[s.verdict, { borderColor: verdict.ok ? C.green : '#e0a100' }]}>
                <Text style={[s.verdictTitle, { color: verdict.ok ? C.green : '#e0a100' }]}>
                  {verdict.ok ? 'البرج طبّق اختيارك 👌' : 'انطبق جزئياً'}
                </Text>
                <Text style={s.verdictTxt}>{verdict.text}</Text>
                <Text style={s.hint}>وانحفظ في «الملفات» عشان ترجع له بضغطة</Text>
              </View>
            )}

            <Pressable style={[s.btnGhost, { borderColor: C.sub }, busy && s.dim]} onPress={reset} disabled={busy}>
              <Text style={[s.btnGhostTxt, { color: C.sub }]}>رجوع للتلقائي (فك كل الأقفال)</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const s = sheet({
  sameBand: { borderWidth: 1, borderColor: isDark ? '#3b82f6aa' : '#93c5fd', backgroundColor: isDark ? '#0c1a45' : tBg('#f2f7ff'), borderRadius: 22, padding: 12, gap: 4, marginBottom: 4 },
  sameTitle: { color: isDark ? '#7dd3fc' : '#0369a1', fontWeight: '900', fontSize: 14, textAlign: 'right' },
  sameSub: { color: C.sub, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  page: { padding: 16, gap: 14 },
  center: { alignItems: 'center', paddingVertical: 40 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  moreRow: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 10 },
  moreTxt: { color: C.blue, fontSize: 12.5, fontWeight: '700', textAlign: 'center' },
  errBox: { backgroundColor: C.redSoft, borderRadius: 14, padding: 12 },
  err: { color: C.red, fontWeight: '700', textAlign: 'right' },
  statusBox: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10, backgroundColor: C.blueSoft, borderRadius: 14, padding: 12 },
  statusText: { color: C.blue, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexBasis: '31%', flexGrow: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 9, borderRadius: 14,
    backgroundColor: C.rowBg, borderWidth: 1.5, borderColor: C.line,
  },
  tileFaint: { opacity: 0.55 },
  miniCheck: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.8, borderColor: C.line, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  miniCheckOn: { borderColor: C.card },
  checkMark: { fontWeight: '900', fontSize: 12, lineHeight: 13 },
  tileName: { color: C.text, fontWeight: '800', fontSize: 14, lineHeight: 16 },
  tileSub: { color: C.muted, fontSize: 10, marginTop: 1 },
  tileSig: { fontSize: 10, fontWeight: '800', marginTop: 1 },
  saCard: { backgroundColor: C.card, borderRadius: 20, borderWidth: 2, borderColor: '#0ea5a455', padding: 14, gap: 10 },
  saHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  saTitle: { color: C.text, fontWeight: '900', fontSize: 16, textAlign: 'right' },
  saBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  saBadgeTxt: { color: '#fff', fontWeight: '800', fontSize: 11 },
  carr: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: C.rowBg, borderRadius: 12, padding: 10 },
  carrRole: { color: C.sub, fontWeight: '800', fontSize: 12, minWidth: 64, textAlign: 'right' },
  carrName: { flex: 1, color: C.text, fontWeight: '900', fontSize: 15, textAlign: 'right' },
  carrSig: { fontWeight: '800', fontSize: 13 },
  btn: { height: 56, borderRadius: 999, flexDirection: 'row-reverse', alignItems: 'center', paddingHorizontal: 14, gap: 8, borderWidth: 1, borderColor: '#ffffff40' },
  btnTxt: { flex: 1, color: '#ffffff', fontWeight: '900', fontSize: 16, textAlign: 'center' },
  btnCheck: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  btnCheckTxt: { color: '#2f6bff', fontSize: 15, fontWeight: '900' },
  prog: { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: isDark ? '#2c4fa0aa' : C.line, padding: 14, gap: 4 },
  stepRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 9 },
  stepLine: { borderBottomWidth: 1, borderBottomColor: isDark ? '#1e3468' : C.lineSoft },
  stepDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  stepInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.blue },
  stepCheck: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  stepTxt: { flex: 1, color: C.text, fontSize: 15, fontWeight: '800', textAlign: 'right' },
  stepNow: { color: C.sub, fontSize: 12, textAlign: 'right', marginTop: 2 },
  progTrack: { height: 10, borderRadius: 99, backgroundColor: C.track, overflow: 'hidden', marginTop: 8, flexDirection: 'row' },
  progFill: { height: 10, borderRadius: 99 },
  timeRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 8 },
  timeBox: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: 999, borderWidth: 1, borderColor: isDark ? '#2c4a8c' : C.line },
  timeTxt: { color: C.text, fontSize: 13, fontWeight: '800' },
  timeNum: { fontSize: 19, fontWeight: '900' },
  warnBox: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 8, borderRadius: 16, borderWidth: 1, borderColor: '#f59e0b88', backgroundColor: isDark ? '#3a2410' : tBg('#fff4e3'), padding: 12 },
  warnIcon: { fontSize: 22 },
  warnTxt: { flex: 1, color: isDark ? '#fbbf24' : '#b45309', fontSize: 13, fontWeight: '800', textAlign: 'right', lineHeight: 20 },
  plan: { borderRadius: 22, borderWidth: 1.5, borderColor: isDark ? '#3b82f6aa' : '#93c5fd', backgroundColor: isDark ? '#0c1a45' : tBg('#f2f7ff'), paddingTop: 22, paddingBottom: 14, paddingHorizontal: 12, marginTop: 12 },
  planBadge: { position: 'absolute', top: -14, alignSelf: 'center', paddingHorizontal: 14, height: 28, borderRadius: 999, justifyContent: 'center', backgroundColor: isDark ? '#3a2a0c' : '#fff4d6', borderWidth: 1, borderColor: '#f59e0b99' },
  planBadgeTxt: { color: isDark ? '#ffffff' : '#92400e', fontSize: 12.5, fontWeight: '900' },
  planRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  planLte: { color: isDark ? '#5eead4' : '#0e7490', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  planNr: { color: isDark ? '#c4b5fd' : '#7c3aed', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  planNone: { color: C.sub, fontSize: 13, fontWeight: '800' },
  planRocket: { fontSize: 34 },
  sameRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  sameIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: '#60a5fa88', alignItems: 'center', justifyContent: 'center' },
  btnGhost: { borderWidth: 1, borderColor: C.blue, borderRadius: 14, padding: 12, alignItems: 'center' },
  btnGhostTxt: { color: C.blue, fontWeight: '800', fontSize: 14 },
  dim: { opacity: 0.45 },
  verdict: { borderWidth: 2, borderRadius: 16, padding: 12, gap: 6, backgroundColor: C.card },
  verdictTitle: { fontWeight: '900', fontSize: 15, textAlign: 'right' },
  verdictTxt: { color: C.text, fontSize: 13, textAlign: 'right', lineHeight: 22 },
});
