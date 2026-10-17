import { runRouterOp } from '../../src/utils/routerOp';
/**
 * «5G الأساسي» — تختار أي تردد 5G يكون الأساسي (PCell) في وضع SA، ووش ينضم معه.
 * مثال: n77 رفعه أقوى بس البرج يحطه ثانوي تحت n41 → نخليه هو الأساسي ونضيف n41 ثانوي.
 *
 * الطريقة (بأمان، مع قياس قبل وبعد ورجوع تلقائي):
 *  ١) وضع SA + قفل 5G على الأساسي لحاله → الراوتر مجبور يمسكه أساسي.
 *  ٢) لو اخترت ثانوي: نقفل «الخلية» اللي مسكها (PCI) عشان يبقى هو الأساسي، ونسمح بالثانوي.
 *     لو البرج يدعم الدمج بهالترتيب، يضيف الثانوي فوقه.
 * لو البرج ما يسمح هالتردد يكون أساسي (بعض المشغّلين يخلونه ثانوي بس)، ينقطع → نرجّع إعدادك.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { BandConfig, Carrier } from '../../src/drivers/types';
import { safeApply, trialMessage } from '../../src/utils/safeLock';
import { trafficBurst } from '../../src/utils/nrprobe';
import { bandLabel, freqLabel } from '../../src/utils/bands';
import { saveProfile } from '../../src/store/profiles';
import { reportError } from '../../src/services/errors';
import { useOperatorBands } from '../../src/store/operator';
import { C, tBg, tBd, tFg } from '../../src/ui/theme';
import { sheet } from '../../src/i18n';

const SA = '08';
const ACCENT = '#0ea5a4';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** نحمّل شوي ونقرأ النواقل كم مرة — الدمج يطلع وقت التحميل */
async function readCa(r: SavedRouter): Promise<Carrier[]> {
  const burst = trafficBurst(9000).catch(() => 0);
  let best: Carrier[] = [];
  for (let i = 0; i < 3; i++) {
    await sleep(2600);
    const list = await withSession(r, async d => (d.getCarriers ? d.getCarriers() : [])).catch(() => [] as Carrier[]);
    if (list.length > best.length) best = list;
  }
  await burst;
  return best;
}

export default function NrPrimary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const [now, setNow] = useState<Carrier[] | null>(null);
  const [canCell, setCanCell] = useState(false);
  const [primary, setPrimary] = useState<number | null>(null);
  const [extra, setExtra] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
  const [allBands, setAllBands] = useState(false);
  const op = useOperatorBands(id);
  const mounted = useRef(true);

  const load = async (r: SavedRouter) => {
    const { c, car, cell } = await withSession(r, async d => ({
      c: d.getBandConfig ? await d.getBandConfig() : null,
      car: d.getCarriers ? await d.getCarriers().catch(() => [] as Carrier[]) : [],
      cell: !!d.lockCell,
    }));
    if (!mounted.current) return;
    setCfg(c);
    setNow(car);
    setCanCell(cell);
  };

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const r = await getRouter(id);
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try { await load(r); } catch (e: any) { setError(e?.message ?? String(e)); }
      finally { if (mounted.current) setLoading(false); }
    })();
    return () => { mounted.current = false; };
  }, [id]);

  const hasSa = !!cfg?.modes.some(m => m.value === SA);
  const nrAll = cfg?.nrSupported ?? [];
  // نعرض ترددات مشغّلك (واللي شفناها شغالة) بس — باقي ترددات الراوتر غالباً ما لها برج عندك
  const seenNr = new Set((now ?? []).filter(c => c.tech === 'NR').map(c => c.band));
  const nrList = !op || allBands ? nrAll : nrAll.filter(b => op.bands.nr.includes(b) || seenNr.has(b));
  const hidden = nrAll.length - nrList.length;
  const pcc = now?.find(c => c.role === 'PCC');
  const nrNow = (now ?? []).filter(c => c.tech === 'NR');

  const toggleExtra = (b: number) => setExtra(x => (x.includes(b) ? x.filter(y => y !== b) : [...x, b]));

  const run = () => {
    if (!info || !cfg || primary === null) return;
    const P = primary;
    const S = extra.filter(b => b !== P);
    const label = `5G أساسي ${bandLabel('NR', P)}${S.length ? ` + ${S.map(b => bandLabel('NR', b)).join(' + ')}` : ''}`;
    Alert.alert(label,
      `١) نحوّل الراوتر لـ 5G SA ونقفله على ${bandLabel('NR', P)} لحاله — كذا يصير هو الأساسي.\n` +
      (S.length ? `٢) نثبّت الخلية اللي مسكها ونسمح بـ ${S.map(b => bandLabel('NR', b)).join(' و ')} ينضم معه.\n` : '') +
      `\nنقيس قبل وبعد، ولو انقطع النت أو صار أسوأ نرجّع إعدادك. لو البرج يخلي ${bandLabel('NR', P)} ثانوي بس، بينقطع ونرجّعك.`,
      [{ text: 'إلغاء', style: 'cancel' }, { text: 'يلا', onPress: () => go(P, S, label) }]);
  };

  const go = async (P: number, S: number[], label: string) => {
    if (!info || !cfg) return;
    await runRouterOp(info, label, async op => {
    const orig = cfg;
    setBusy(true); setError(''); setVerdict(null);
    const say = (t: string) => mounted.current && setStatus(t);
    try {
      // ١) الأساسي لحاله في SA
      const r1 = await safeApply({
        op, r: info, key: `nrprim:${P}`, label: `5G أساسي ${bandLabel('NR', P)}`, withNr: true, onStatus: say,
        apply: async d => {
          if (orig.mode !== SA && d.setNetworkMode) await d.setNetworkMode(SA);
          await d.setBand!('keep', [P]);
        },
        revert: async d => {
          if (d.setNetworkMode && orig.mode !== SA) { try { await d.setNetworkMode(orig.mode); } catch {} }
          await d.setBand!(orig.locked, orig.nrLocked);
        },
      });
      if (!r1.kept) {
        const m = trialMessage(r1, label);
        Alert.alert(r1.verdict === 'noconn' ? `${bandLabel('NR', P)} ما قبل يكون أساسي` : m.title,
          r1.verdict === 'noconn'
            ? `البرج عندك ما يسمح ${bandLabel('NR', P)} يكون أساسي (يخليه ثانوي بس) — رجّعنا إعدادك. هذا من إعداد المشغّل، مو من راوترك.`
            : m.body);
        return;
      }
      say('نتأكد من الأساسي...');
      let list = await readCa(info);
      let p = list.find(c => c.role === 'PCC');

      // ٢) نثبّت الخلية ونضيف الثانوي
      if (S.length && p && p.tech === 'NR' && p.band === P && p.pci && canCell) {
        const cell = { tech: 'NR' as const, band: P, pci: p.pci, arfcn: p.arfcn };
        const r2 = await safeApply({
          op, r: info, key: `nrprim:${P}+${S.join('+')}`, label, withNr: true, onStatus: say,
          apply: async d => {
            await d.lockCell!(cell);
            await d.setBand!('keep', [P, ...S]);
          },
          revert: async d => {
            try { await d.unlockCell?.(); } catch {}
            await d.setBand!('keep', [P]);
          },
        });
        if (!r2.kept) {
          const m = trialMessage(r2, label);
          Alert.alert(m.title, `${m.body}\n\nخليناك على ${bandLabel('NR', P)} أساسي لحاله.`);
        }
        say('نتأكد من الدمج...');
        list = await readCa(info);
        p = list.find(c => c.role === 'PCC');
      }

      const sccNr = list.filter(c => c.tech === 'NR' && c.role !== 'PCC').map(c => bandLabel('NR', c.band));
      const ok = !!p && p.tech === 'NR' && p.band === P;
      if (mounted.current) {
        setNow(list);
        setVerdict({
          ok,
          text: [
            p ? (ok ? `✓ الأساسي ${bandLabel('NR', P)} — الرفع صار عليه` : `✗ الأساسي طلع ${bandLabel(p.tech, p.band)} بدل ${bandLabel('NR', P)}`) : '• ما قدرنا نقرأ الأساسي',
            S.length ? (sccNr.length ? `✓ ينضم معه: ${sccNr.join(' + ')}` : '✗ البرج ما ضاف الثانوي بهالترتيب — يبقى الأساسي لحاله') : '',
          ].filter(Boolean).join('\n'),
        });
      }
      await saveProfile({ routerId: info.id, name: label, bands: orig.locked, nrBands: [P, ...S], mode: SA }).catch(() => {});
    } catch (e: any) {
      const m = String(e?.message ?? e);
      const kicked = /يطلّع التطبيق/.test(m);
      const back = e?.reverted;
      if (mounted.current) setError(kicked
        ? (back
          ? `راوترك (بعض موديلات هواوي مثل H155) يطرد التطبيق لما يتحوّل لـ 5G SA، فما قدرنا نكمّل. رجّعنا إعدادك ✓\n\nلو تطبيق «HUAWEI AI Life» مفتوح سكّره من الخلفية وجرّب مرة ثانية.`
          : `الراوتر طرد التطبيق وما قدرنا نرجّع إعدادك.\n١) سكّر تطبيق «HUAWEI AI Life» وأي صفحة للراوتر\n٢) ارجع لصفحة الراوتر واضغط «رجّع الإشارة»`)
        : /ما طبّق القفل|رفض/.test(m)
          ? `راوترك ما قبل يقفل على ${bandLabel('NR', P)} — غالباً هالتردد ما له برج عند مشغّلك أو الراوتر ما يدعمه في SA. اختر تردد من ترددات مشغّلك (مثل n78 أو n41 أو n77). ${back === false ? '' : 'ما تغيّر شي في إعدادك.'}`
          : m);
      reportError('nrprimary', e, info);
    } finally {
      if (mounted.current) { setBusy(false); setStatus(''); try { await load(info); } catch {} }
    }
    });
  };

  const Chip = ({ b, on, onPress, color }: { b: number; on: boolean; onPress: () => void; color: string }) => (
    <Pressable onPress={onPress} disabled={busy} style={[s.chip, on && { backgroundColor: color, borderColor: color }, busy && { opacity: 0.5 }]}>
      <Text style={[s.chipTxt, on && { color: '#fff' }]}>{bandLabel('NR', b)}</Text>
      <Text style={[s.chipSub, on && { color: 'rgba(255,255,255,0.85)' }]}>{freqLabel('NR', b) || ' '}</Text>
    </Pressable>
  );

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        <View style={s.card}>
          <Text style={s.title}>👑 5G الأساسي</Text>
          <Text style={s.body}>
            في الدمج، الرفع يمشي على التردد الأساسي بس. لو عندك تردد رفعه أقوى بس البرج يحطه ثانوي (مثل n77 تحت n41)، هنا تخليه هو الأساسي — وتقدر تضيف الثاني معه.
          </Text>
          {loading ? <ActivityIndicator color={ACCENT} /> : (
            <>
              {!!now && (
                <View style={s.nowBox}>
                  <Text style={s.nowTxt}>
                    {pcc
                      ? `الحين: الأساسي ${bandLabel(pcc.tech, pcc.band)}${nrNow.filter(c => c !== pcc).length ? ` · ثانوي ${nrNow.filter(c => c !== pcc).map(c => bandLabel('NR', c.band)).join(' + ')}` : ''}`
                      : 'ما قدرنا نقرأ الأساسي الحين'}
                  </Text>
                </View>
              )}
              {!hasSa && <Text style={s.warn}>راوترك ما فيه وضع 5G SA، فما نقدر نختار الأساسي في الـ 5G.</Text>}
            </>
          )}
        </View>

        {!loading && hasSa && nrList.length > 0 && (
          <>
            <View style={s.card}>
              <Text style={s.h2}>١. الأساسي (الرفع عليه)</Text>
              <View style={s.chips}>
                {nrList.map(b => <Chip key={b} b={b} on={primary === b} color={ACCENT} onPress={() => { setPrimary(b); setExtra(x => x.filter(y => y !== b)); }} />)}
              </View>
            </View>
            <View style={s.card}>
              <Text style={s.h2}>٢. ينضم معه (اختياري)</Text>
              {!canCell && <Text style={s.note}>راوترك ما يدعم تثبيت الخلية — بنقفل على الأساسي لحاله بس.</Text>}
              <View style={s.chips}>
                {nrList.filter(b => b !== primary).map(b => <Chip key={b} b={b} on={extra.includes(b)} color="#7a51e0" onPress={() => canCell && toggleExtra(b)} />)}
              </View>
            </View>
            {!!op && (hidden > 0 || allBands) && (
              <Pressable onPress={() => setAllBands(v => !v)} hitSlop={6}>
                <Text style={s.more}>{allBands ? `اعرض ترددات ${op.name} بس` : `معروض ترددات ${op.name} بس · اعرض كل ترددات الراوتر (+${hidden})`}</Text>
              </Pressable>
            )}
            <Pressable style={[s.btn, (busy || primary === null) && { opacity: 0.5 }]} onPress={run} disabled={busy || primary === null}>
              {busy ? <ActivityIndicator color="#fff" /> : (
                <Text style={s.btnTxt}>{primary === null ? 'اختر الأساسي أول' : `خلّ ${bandLabel('NR', primary)} أساسي`}</Text>
              )}
            </Pressable>
          </>
        )}

        {!!status && <Text style={s.status}>{status}</Text>}
        {!!error && <Text style={s.err}>{error}</Text>}
        {verdict && (
          <View style={[s.card, { borderColor: verdict.ok ? tBd('#7fd4b8') : C.cardBorder, backgroundColor: verdict.ok ? tBg('#ecfaf4') : C.card }]}>
            <Text style={[s.verdict, verdict.ok && { color: tFg('#0f7a52') }]}>{verdict.text}</Text>
            <Text style={s.note}>انحفظ في «الملفات». قارن الرفع من «السرعة»، ولو ما عجبك اضغط «رجّع الإشارة» من صفحة الراوتر.</Text>
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const s = sheet({
  page: { padding: 16, gap: 12 },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: 20, padding: 16, gap: 10 },
  title: { color: C.text, fontWeight: '800', fontSize: 17, textAlign: 'right' },
  body: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  h2: { color: C.text, fontWeight: '800', fontSize: 14.5, textAlign: 'right' },
  nowBox: { backgroundColor: tBg('#f1f4fb'), borderColor: tBd('#d8e0f0'), borderWidth: 1.5, borderRadius: 12, padding: 10 },
  nowTxt: { color: C.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  warn: { color: tFg('#b45309'), fontSize: 12.5, fontWeight: '700', textAlign: 'right', lineHeight: 19 },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderColor: C.cardBorder, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center', backgroundColor: C.card, minWidth: 70 },
  chipTxt: { color: C.text, fontWeight: '800', fontSize: 15 },
  chipSub: { color: C.muted, fontSize: 10.5, fontWeight: '600' },
  btn: { backgroundColor: ACCENT, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 15.5 },
  status: { color: ACCENT, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  err: { color: C.red, fontSize: 12.5, textAlign: 'right' },
  verdict: { color: C.text, fontWeight: '800', fontSize: 14.5, lineHeight: 23, textAlign: 'right' },
  more: { color: tFg('#2563eb'), fontSize: 12.5, fontWeight: '700', textAlign: 'center' },
  note: { color: C.muted, fontSize: 11.5, lineHeight: 18, textAlign: 'right' },
});
