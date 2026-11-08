/**
 * «وش يثقّل نتك الحين؟» — عامة لكل الراوترات (٨ نوفمبر، طلب حسن).
 * الجوال واقف على الشاشة ← أي سرعة كبيرة يقراها الراوتر = أجهزة ثانية تحمّل.
 * كل ٢ ثانية: سرعة الراوتر الكلية (getTraffic لو موجود) + بنق لسيرفر لعبتك.
 * الحكم: src/utils/heavyNet.ts. ما نعرف «أي جهاز» بالضبط — هذا يحتاج الراوتر يعطي استهلاك كل جهاز.
 */
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { selectedRegion, regionUrls, pingOnce, GameRegion } from '../../src/utils/latency';
import { pingStats } from '../../src/utils/gameNet';
import { heavyVerdict, HeavyLevel } from '../../src/utils/heavyNet';
import type { DeviceUsageReport } from '../../src/drivers/types';
import { C, tFg } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import { FONT } from '../../src/ui/fonts';
import { sheet } from '../../src/i18n';

const LV_COLOR: Record<HeavyLevel, string> = { idle: '#12b76a', light: '#2f6bff', busy: '#f59e0b', heavy: '#e5484d', unknown: '#70799b' };
const BASE_KEY = (rid: string, reg: string) => `bandly.heavy.base.${rid}.${reg}`;
const mbps = (bps?: number) => (bps === undefined ? undefined : (bps * 8) / 1e6);

export default function Heavy() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [reg, setReg] = useState<GameRegion | null>(null);
  const [down, setDown] = useState<number | undefined>();
  const [up, setUp] = useState<number | undefined>();
  const [hasRate, setHasRate] = useState<boolean | null>(null);
  const [devCount, setDevCount] = useState<number | null>(null);
  // راوتر فيه عدّاد استهلاك لكل جهاز (ZTE goform) ← نعرض مين بالضبط
  const [usage, setUsage] = useState<DeviceUsageReport | null | undefined>(undefined);
  const [pings, setPings] = useState<(number | null)[]>([]);
  const [base, setBase] = useState<number | undefined>();
  const [hist, setHist] = useState<number[]>([]);
  const alive = useRef(true);

  useFocusEffect(useCallback(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let r: SavedRouter | null = null;
    let region: GameRegion | null = null;
    let all: (number | null)[] = [];
    let best: number | undefined;
    let n = 0;

    const tick = async () => {
      if (!alive.current || !r || !region) return;
      n++;
      // سرعة الراوتر الكلية — كل لفة
      const tr = await withSession(r, async d => (d.getTraffic ? d.getTraffic() : null)).catch(() => null);
      if (!alive.current) return;
      setHasRate(tr ? true : (h => (h === true ? true : false)));
      if (tr) {
        const dm = mbps(tr.downBytesPerSec), um = mbps(tr.upBytesPerSec);
        setDown(dm); setUp(um);
        if (dm !== undefined) setHist(h => [...h.slice(-29), dm]);
      }
      // عدد الأجهزة — كل ١٥ لفة (~٣٠ث)
      if (n % 15 === 1) {
        withSession(r, async d => (d.getDevices ? (await d.getDevices()).length : null))
          .then(c => { if (alive.current) setDevCount(c); }).catch(() => {});
        withSession(r, async d => (d.getDeviceUsage ? d.getDeviceUsage() : null))
          .then(u => { if (alive.current) setUsage(u); }).catch(() => { if (alive.current) setUsage(null); });
      }
      // بنق لسيرفر اللعبة
      const ms = await pingOnce(regionUrls(region)[0], 2500).catch(() => null);
      if (!alive.current) return;
      all = [...all.slice(-29), ms];
      setPings(all);
      const st = pingStats(all.slice(-10));
      if (st.n >= 5 && (best === undefined || st.median < best)) {
        best = st.median;
        setBase(best);
        AsyncStorage.setItem(BASE_KEY(r.id, region.id), String(best)).catch(() => {});
      }
      timer = setTimeout(tick, 2000);
    };

    (async () => {
      r = await getRouter(id);
      if (!r || !alive.current) return;
      setInfo(r);
      region = await selectedRegion();
      setReg(region);
      // أحسن بنق من مرات قبل (لو الشاشة انفتحت والخط مشغول من البداية)
      try {
        const v = Number(await AsyncStorage.getItem(BASE_KEY(r.id, region.id)));
        if (v > 0) { best = v; setBase(v); }
      } catch {}
      tick();
    })();
    return () => { alive.current = false; if (timer) clearTimeout(timer); };
  }, [id]));

  const st = pingStats(pings.slice(-10));
  const v = heavyVerdict({
    downMbps: hasRate ? down : undefined,
    upMbps: hasRate ? up : undefined,
    pingMed: st.n >= 3 ? st.median : undefined,
    pingBase: base,
    lossPct: st.n >= 3 ? st.lossPct : undefined,
  });
  const col = LV_COLOR[v.level];
  const maxH = Math.max(5, ...hist);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 60 }]}>
      <View style={[s.hero, { borderColor: col + '66', backgroundColor: col + '14' }]}>
        {v.level === 'unknown' ? <ActivityIndicator color={col} /> : <View style={[s.dot, { backgroundColor: col }]} />}
        <Text style={[s.heroTitle, { color: col }]}>{v.title}</Text>
        <Text style={s.heroDetail}>{v.detail}</Text>
      </View>

      <GlassCard title="الحين" icon="⚡" collapsible={false}>
        <View style={s.row}>
          <Stat label="تنزيل الراوتر" val={hasRate ? fmt(down) : '—'} unit="ميقابت" />
          <Stat label="رفع الراوتر" val={hasRate ? fmt(up) : '—'} unit="ميقابت" />
          <Stat label={`بنق ${reg?.name ?? ""}`} val={st.n ? String(Math.round(st.median)) : '—'} unit="ms"
            sub={v.added !== undefined ? `+${v.added} عن أحسن` : undefined} />
        </View>
        {hasRate && hist.length > 1 && (
          <View style={s.chart}>
            {hist.map((h, i) => (
              <View key={i} style={[s.bar, { height: Math.max(2, (h / maxH) * 56), backgroundColor: h >= 15 ? '#e5484d' : h >= 3 ? '#f59e0b' : '#2f6bff' }]} />
            ))}
          </View>
        )}
        {hasRate === false && (
          <Text style={s.note}>راوترك ما يعطينا سرعته الحين — نحكم من البنق بس (تقدير).</Text>
        )}
        <Text style={s.note}>خلّ جوالك على هالشاشة وما يحمّل شي — أي سرعة فوق تكون من الأجهزة الثانية.</Text>
      </GlassCard>

      {usage && (
        <GlassCard title="مين يستهلك أكثر؟" icon="📈" collapsible={false}>
          {!usage.enabled && <Text style={s.tip}>عدّاد استهلاك الأجهزة مطفي في راوترك — شغّله من «الأجهزة المتصلة» تحت، وبعدها يطلع لك هنا مين يستهلك.</Text>}
          {usage.enabled && (() => {
            const sum = usage.list.reduce((a, x) => a + x.total, 0);
            const top = usage.list.filter(x => x.total > 0).slice(0, 3);
            if (!top.length) return <Text style={s.tip}>لسا ما فيه استهلاك محسوب — ارجع بعد شوي.</Text>;
            return top.map((x, i) => (
              <Text key={x.mac} style={s.tip}>{i + 1}. {x.name || x.ip || x.mac} — {sum ? Math.round((x.total / sum) * 100) : 0}٪{i === 0 ? ' (الأكثر)' : ''}</Text>
            ));
          })()}
          <Text style={s.note}>من عدّاد الراوتر من وقت ما اشتغل — النسبة من المجموع.</Text>
        </GlassCard>
      )}

      {v.tips.length > 0 && (
        <GlassCard title="وش تسوي" icon="💡" collapsible={false}>
          {v.tips.map((t, i) => <Text key={i} style={s.tip}>• {t}</Text>)}
        </GlassCard>
      )}

      {info && (
        <View style={s.links}>
          <Pressable style={s.link} onPress={() => router.push(`/device/${info.id}` as Href)}>
            <Text style={s.linkTxt}>الأجهزة المتصلة{devCount !== null ? ` (${devCount})` : ''}</Text>
          </Pressable>
          <Pressable style={s.link} onPress={() => router.push(`/gameboost/${info.id}` as Href)}>
            <Text style={s.linkTxt}>وضع المباراة</Text>
          </Pressable>
        </View>
      )}
      {usage === null && (
        <Text style={s.note}>نعرف إن فيه ضغط، بس راوترك ما يعطي استهلاك كل جهاز — عشان تعرف مين: افتح «الأجهزة المتصلة» وطفّ الشك واحد واحد (أو «وضع المباراة») وشوف السرعة فوق تنزل.</Text>
      )}
    </ScrollView>
  );
}

function fmt(n?: number) {
  if (n === undefined) return '—';
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1);
}

function Stat({ label, val, unit, sub }: { label: string; val: string; unit: string; sub?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statVal}>{val}<Text style={s.statUnit}> {unit}</Text></Text>
      <Text style={s.statLbl} numberOfLines={1}>{label}</Text>
      {!!sub && <Text style={[s.statLbl, { color: tFg('#e0a100') }]}>{sub}</Text>}
    </View>
  );
}

const s = sheet({
  page: { padding: 14, gap: 12 },
  hero: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 6, alignItems: 'flex-end' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  heroTitle: { fontSize: 18, fontWeight: '900', textAlign: 'right' },
  heroDetail: { color: C.text, fontSize: 13, lineHeight: 20, textAlign: 'right' },
  row: { flexDirection: 'row-reverse', gap: 8 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statVal: { color: C.text, fontSize: 20, fontFamily: FONT.numHeavy },
  statUnit: { color: C.sub, fontSize: 11, fontFamily: FONT.num },
  statLbl: { color: C.sub, fontSize: 10.5, fontWeight: '700' },
  chart: { flexDirection: 'row-reverse', alignItems: 'flex-end', gap: 2, height: 60, marginTop: 10 },
  bar: { flex: 1, borderRadius: 2 },
  note: { color: C.sub, fontSize: 11, lineHeight: 17, textAlign: 'right', marginTop: 6 },
  tip: { color: C.text, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  links: { flexDirection: 'row-reverse', gap: 8 },
  link: { flex: 1, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 14, paddingVertical: 11, alignItems: 'center', backgroundColor: C.card },
  linkTxt: { color: C.blue, fontSize: 13, fontWeight: '900' },
});
