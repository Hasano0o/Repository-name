import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { BandConfig, Carrier, CellTower } from '../../src/drivers/types';
import { safeApply, trialMessage } from '../../src/utils/safeLock';
import { trafficBurst } from '../../src/utils/nrprobe';
import { bandLabel, freqLabel } from '../../src/utils/bands';
import { saveProfile } from '../../src/store/profiles';
import { C } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';

const LTE_ONLY = '03';
type NrPick = 'any' | 'none' | number;

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

export default function ComboScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const [cells, setCells] = useState<CellTower[]>([]);
  const [carriers, setCarriers] = useState<Carrier[] | null>(null);
  const [primary, setPrimary] = useState<number | null>(null);
  const [extra, setExtra] = useState<number[]>([]);
  const [nr, setNr] = useState<NrPick>('any');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async (r: SavedRouter) => {
    try {
      const [c, list] = await withSession(r, async d => [
        d.getBandConfig ? await d.getBandConfig() : null,
        d.getCells ? await d.getCells().catch(() => [] as CellTower[]) : ([] as CellTower[]),
      ] as const);
      if (!mounted.current) return;
      setCfg(c);
      setCells(list);
      // نبدأ من الإعداد الحالي
      if (c) {
        if (c.locked.length) { setPrimary(c.locked[0]); setExtra(c.locked.slice(1)); }
        if (c.mode === LTE_ONLY) setNr('none');
        else if (c.nrLocked.length === 1) setNr(c.nrLocked[0]);
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

  const checkNow = async () => {
    if (!info) return;
    setBusy(true);
    setError('');
    try {
      const list = await readCa(info);
      if (mounted.current) setCarriers(list);
    } finally {
      if (mounted.current) { setBusy(false); setStatus(''); }
    }
  };

  const nrModes = !!cfg?.modes.some(m => m.value === LTE_ONLY);

  const apply = () => {
    if (!info || !cfg || primary === null) return;
    const lte = [primary, ...extra.filter(b => b !== primary)];
    const nrBands = typeof nr === 'number' ? [nr] : [];
    const label = `${lte.map(b => bandLabel('LTE', b)).join(' + ')}${nr === 'none' ? ' · بدون 5G' : typeof nr === 'number' ? ` + ${bandLabel('NR', nr)}` : ' + أي 5G'}`;
    const orig = cfg;
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
              key: `combo:${lte.join('+')}:${String(nr)}`,
              label,
              withNr: nr !== 'none',
              onStatus: t => mounted.current && setStatus(t),
              apply: async d => {
                if (nr === 'none') {
                  if (orig.mode !== LTE_ONLY && d.setNetworkMode) await d.setNetworkMode(LTE_ONLY);
                  await d.setBand!(lte, orig.nrLocked);
                } else {
                  if (orig.mode === LTE_ONLY && d.setNetworkMode) await d.setNetworkMode('00');
                  await d.setBand!(lte, nrBands);
                }
              },
              revert: async d => {
                if (d.setNetworkMode && orig.mode) {
                  try { await d.setNetworkMode(orig.mode); } catch {}
                }
                await d.setBand!(orig.locked, orig.nrLocked);
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
            const hasNr = list.some(c => c.tech === 'NR' && (typeof nr !== 'number' || c.band === nr));
            const pOk = !pcc || pcc.band === primary;
            const nOk = nr === 'none' ? !list.some(c => c.tech === 'NR') : hasNr;
            const extraOn = list.filter(c => c.tech === 'LTE' && c.role === 'SCC').map(c => c.band);
            setVerdict({
              ok: pOk && nOk,
              text: [
                pcc ? (pOk ? `✓ الأساسي ${bandLabel('LTE', pcc.band)}` : `✗ الأساسي طلع ${bandLabel('LTE', pcc.band)} بدل ${bandLabel('LTE', primary)}`) : '• ما قدرنا نقرأ الأساسي',
                nr === 'none' ? (nOk ? '✓ بدون 5G' : '✗ الـ 5G للحين شغال') : nOk ? '✓ الـ 5G مدموج' : '✗ البرج ما شغّل الـ 5G — غالباً ما يدمجه مع هالأساسي',
                extra.length ? (extraOn.length ? `✓ دمج 4G: ${extraOn.map(b => bandLabel('LTE', b)).join(' + ')}` : '✗ البرج ما دمج ترددات 4G الإضافية') : '',
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
            await withSession(info, async d => {
              if (cfg.mode === LTE_ONLY && d.setNetworkMode) await d.setNetworkMode('00');
              await d.setBand!([], []);
            }, false);
            setPrimary(null); setExtra([]); setNr('any'); setVerdict(null);
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
  const lteList = cfg ? sortBands(cfg.supported, lteSeen) : [];
  const nrList = cfg ? sortBands(cfg.nrSupported, nrSeen) : [];

  const BandChip = ({ tech, b, on, onPress, seen }: { tech: 'LTE' | 'NR'; b: number; on: boolean; onPress: () => void; seen?: number }) => (
    <Pressable style={[s.band, on && s.bandOn, seen === undefined && !on && s.bandFaint]} onPress={onPress} disabled={busy}>
      <Text style={[s.bandName, on && { color: C.onAccent }]}>{bandLabel(tech, b)}</Text>
      <Text style={[s.bandSub, on && { color: C.onAccent }]}>{freqLabel(tech, b) || ' '}</Text>
      <Text style={[s.bandSig, { color: on ? C.onAccent : rsrpCol(seen) }]}>{seen !== undefined ? `${seen} dBm` : 'مو ظاهر'}</Text>
    </Pressable>
  );

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        {loading && <View style={s.center}><ActivityIndicator size="large" color={C.blue} /></View>}
        {!!error && <View style={s.errBox}><Text style={s.err}>{error}</Text></View>}
        {!!status && (
          <View style={s.statusBox}>
            <Text style={s.statusText}>{status}</Text>
            <ActivityIndicator color={C.blue} />
          </View>
        )}

        {!loading && !cfg && <Text style={s.hint}>راوترك ما يدعم قفل الترددات، فما نقدر نحدد الأساسي والثانوي.</Text>}

        {!loading && cfg && (
          <>
            <GlassCard title="الدمج الحين" icon="🔗" tint={C.greenSoft} collapsible={false}>
              {carriers === null ? (
                <Text style={s.hint}>اضغط «افحص» — نشغّل تحميل قصير لأن البرج يفعّل الدمج بس وقت الاستخدام</Text>
              ) : carriers.length === 0 ? (
                <Text style={s.hint}>راوترك ما يعطينا الناقلات النشطة</Text>
              ) : (
                carriers.map((c, i) => (
                  <View key={`${c.tech}${c.band}${i}`} style={s.carr}>
                    <Text style={[s.carrRole, c.role === 'PCC' && { color: C.blue }]}>{c.role === 'PCC' ? '⭐ أساسي' : 'ثانوي'}</Text>
                    <Text style={[s.carrName, c.tech === 'NR' && { color: C.violet }]}>
                      {bandLabel(c.tech, c.band)}{c.bandwidth ? ` · ${c.bandwidth} MHz` : ''}
                    </Text>
                    <Text style={[s.carrSig, { color: rsrpCol(c.rsrp) }]}>{c.rsrp ?? '—'}</Text>
                  </View>
                ))
              )}
              <Pressable style={[s.btnGhost, busy && s.dim]} onPress={checkNow} disabled={busy}>
                <Text style={s.btnGhostTxt}>افحص الدمج</Text>
              </Pressable>
            </GlassCard>

            <GlassCard title="١. الأساسي (4G)" icon="⭐" tint={C.blueSoft} collapsible={false}>
              <Text style={s.hint}>التردد اللي يمسك الاتصال. القوة تحت كل تردد من الأبراج اللي يشوفها راوترك الحين</Text>
              <View style={s.grid}>
                {lteList.map(b => (
                  <BandChip key={b} tech="LTE" b={b} seen={lteSeen.get(b)} on={primary === b}
                    onPress={() => { setPrimary(b); setExtra(x => x.filter(y => y !== b)); }} />
                ))}
              </View>
            </GlassCard>

            <GlassCard title="٢. دمج 4G إضافي (اختياري)" icon="➕" tint={C.goldSoft} defaultOpen={extra.length > 0}>
              <Text style={s.hint}>ترددات 4G ثانية يُسمح للبرج يدمجها مع الأساسي. ⚠️ لما تسمح بأكثر من تردد، ممكن الراوتر يختار واحد منها كأساسي بدل اللي اخترته</Text>
              <View style={s.grid}>
                {lteList.filter(b => b !== primary).map(b => (
                  <BandChip key={b} tech="LTE" b={b} seen={lteSeen.get(b)} on={extra.includes(b)}
                    onPress={() => setExtra(x => (x.includes(b) ? x.filter(y => y !== b) : [...x, b]))} />
                ))}
              </View>
            </GlassCard>

            <GlassCard title="٣. الثانوي (5G)" icon="⚡" tint={C.violetSoft} collapsible={false}>
              <Text style={s.hint}>التردد اللي ينضاف للسرعة. البرج هو اللي يقرر يشغّله — نقدر نسمح أو نمنع بس</Text>
              <View style={s.grid}>
                <Pressable style={[s.band, nr === 'any' && s.bandOn]} onPress={() => setNr('any')} disabled={busy}>
                  <Text style={[s.bandName, nr === 'any' && { color: C.onAccent }]}>أي 5G</Text>
                  <Text style={[s.bandSub, nr === 'any' && { color: C.onAccent }]}>تلقائي</Text>
                </Pressable>
                {nrList.map(b => (
                  <BandChip key={b} tech="NR" b={b} seen={nrSeen.get(b)} on={nr === b} onPress={() => setNr(b)} />
                ))}
                {nrModes && (
                  <Pressable style={[s.band, nr === 'none' && s.bandOn]} onPress={() => setNr('none')} disabled={busy}>
                    <Text style={[s.bandName, nr === 'none' && { color: C.onAccent }]}>بدون 5G</Text>
                    <Text style={[s.bandSub, nr === 'none' && { color: C.onAccent }]}>4G فقط</Text>
                  </Pressable>
                )}
              </View>
            </GlassCard>

            <Pressable style={[s.btn, (busy || primary === null) && s.dim]} onPress={apply} disabled={busy || primary === null}>
              <Text style={s.btnTxt}>{primary === null ? 'اختر الأساسي أول' : 'طبّق وتأكد من الدمج'}</Text>
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

const s = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  center: { alignItems: 'center', paddingVertical: 40 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  errBox: { backgroundColor: C.redSoft, borderRadius: 14, padding: 12 },
  err: { color: C.red, fontWeight: '700', textAlign: 'right' },
  statusBox: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10, backgroundColor: C.blueSoft, borderRadius: 14, padding: 12 },
  statusText: { color: C.blue, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  band: { flexBasis: '30%', flexGrow: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 14, backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder },
  bandOn: { backgroundColor: C.blue, borderColor: C.blue },
  bandFaint: { opacity: 0.55 },
  bandName: { color: C.text, fontWeight: '900', fontSize: 16 },
  bandSub: { color: C.sub, fontSize: 10, marginTop: 1 },
  bandSig: { fontSize: 10.5, fontWeight: '800', marginTop: 2 },
  carr: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: C.rowBg, borderRadius: 12, padding: 10 },
  carrRole: { color: C.sub, fontWeight: '800', fontSize: 12, minWidth: 64, textAlign: 'right' },
  carrName: { flex: 1, color: C.text, fontWeight: '900', fontSize: 15, textAlign: 'right' },
  carrSig: { fontWeight: '800', fontSize: 13 },
  btn: { backgroundColor: C.blue, borderRadius: 16, padding: 15, alignItems: 'center' },
  btnTxt: { color: C.onAccent, fontWeight: '900', fontSize: 15 },
  btnGhost: { borderWidth: 1, borderColor: C.blue, borderRadius: 14, padding: 12, alignItems: 'center' },
  btnGhostTxt: { color: C.blue, fontWeight: '800', fontSize: 14 },
  dim: { opacity: 0.45 },
  verdict: { borderWidth: 2, borderRadius: 16, padding: 12, gap: 6, backgroundColor: C.card },
  verdictTitle: { fontWeight: '900', fontSize: 15, textAlign: 'right' },
  verdictTxt: { color: C.text, fontSize: 13, textAlign: 'right', lineHeight: 22 },
});
