/**
 * بطاقات الإشارة — تصميم حسن الجديد (٢٢ نوفمبر، صورة «القراءة»):
 *   لوحة التقنية الملونة يمين (4G · أعمدة · B3 · 1800 MHz) بحافة منحنية | عدّاد نصف دائري لقوة الإشارة +
 *   شريط ألوان بمؤشر + الحالة | مربعا SINR و RSRQ بخط صغير | وتحت شريط PCI · قناة · MHz.
 * (القديم:)
 * بطاقة لكل تقنية (4G وتحتها 5G لو موجود)، ثلاث أعمدة من اليمين:
 *   شارة التردد (4G · أعمدة · B3 · 1800 متوازن) | قوة الإشارة + الشريط + الحالة | مربعا SINR و RSRQ
 * مربعات SINR/RSRQ تفتح «التفاصيل». ألوان التقييم من signal.ts عشان تطابق باقي الشاشات.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect, Circle, Polyline, Defs, LinearGradient as SvgGrad, Stop, Polygon } from 'react-native-svg';
import type { Signal } from '../drivers/types';
import { LEVEL_COLOR, LEVEL_SOFT, Level, rsrpLevel, rsrqLevel, signalScore, parseBands, parseNrBands } from '../utils/signal';
import { friendlyBand } from '../utils/bands';
import { C, isDark, tBd, tBg } from './theme';
import { sheet, EN_MODE, tr } from '../i18n';
import { FONT } from './fonts';

type Tech = 'LTE' | 'NR';
interface Row { tech: Tech; band?: string; rsrp?: number; sinr?: number; rsrq?: number; pci?: string; arfcn?: string; bw?: string }
type Hist = { rsrp: number[]; sinr: number[]; rsrq: number[] };
const HIST_N = 30; // آخر ٣٠ قراءة (تقريباً دقيقة)

const TECH_TINT: Record<Tech, [string, string]> = {
  LTE: ['#1f5eff', '#3b8bff'],
  NR: ['#5b3df5', '#9466ff'],
};
/** لون التقنية للنص والأيقونات، وخلفيته الفاتحة لمربع SINR */
const TECH_ACCENT: Record<Tech, string> = { LTE: '#1f5eff', NR: '#5b3df5' };
const TECH_SOFT: Record<Tech, string> = isDark
  ? { LTE: '#22314f', NR: '#2c2850' }
  : { LTE: '#eaf1ff', NR: '#f0ecff' };

const STATUS: Record<Level, string> = {
  excellent: 'إشارة ممتازة', good: 'إشارة جيدة', fair: 'إشارة متوسطة', poor: 'إشارة ضعيفة', unknown: 'ما فيه قراءة',
};

const num = (b?: string) => {
  const m = (b ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : undefined;
};
// ‎: علامة «يسار لليمين» عشان السالب يطلع -93 مو 93- داخل النص العربي
const fmt = (v?: number, d = 0) => (v === undefined ? '—' : '‎' + (Math.round(v * 10 ** d) / 10 ** d).toString());

/** الصفوف اللي نعرضها من قراءة الراوتر */
export function techRows(sig?: Signal | null): Row[] {
  if (!sig) return [];
  const out: Row[] = [];
  const lteBand = parseBands(sig.band).find(b => !b.startsWith('n'));
  if (sig.rsrp !== undefined || lteBand) {
    out.push({ tech: 'LTE', band: lteBand, rsrp: sig.rsrp, sinr: sig.sinr, rsrq: sig.rsrq, pci: sig.pci, arfcn: sig.earfcn, bw: sig.dlBandwidth });
  }
  const nrBand = parseNrBands(sig.nrBand)[0];
  if (sig.nrRsrp !== undefined || nrBand) {
    out.push({ tech: 'NR', band: nrBand, rsrp: sig.nrRsrp, sinr: sig.nrSinr, rsrq: sig.nrRsrq, pci: sig.nrPci, arfcn: sig.nrArfcn, bw: sig.nrDlBandwidth });
  }
  return out;
}

// ─── أيقونات ───
export function Bars({ color, size = 22, on = 4 }: { color: string; size?: number; on?: number }) {
  const h = [7, 11, 15, 19];
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      {h.map((v, i) => (
        <Rect key={i} x={1 + i * 5.4} y={21 - v} width={3.8} height={v} rx={1.6} fill={color} opacity={i < on ? 1 : 0.4} />
      ))}
    </Svg>
  );
}
function Waves({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Circle cx={5} cy={12} r={2.4} fill={color} />
      <Path d="M10 7.5a6.5 6.5 0 0 1 0 9" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M14 4.5a10.5 10.5 0 0 1 0 15" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M18 2a14 14 0 0 1 0 20" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}
function Antenna({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={1.9} fill={color} />
      <Path d="M8.2 4.6a5 5 0 0 0 0 6.8M15.8 4.6a5 5 0 0 1 0 6.8M5.5 2.5a8.5 8.5 0 0 0 0 11M18.5 2.5a8.5 8.5 0 0 1 0 11" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      <Path d="M12 10l-4.5 12M12 10l4.5 12M9 18h6" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}
function Chevron({ color }: { color: string }) {
  return (
    <Svg width={10} height={10} viewBox="0 0 10 10" fill="none">
      <Path d="M3.5 1.5L7 5l-3.5 3.5" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
/** لمعة خفيفة داخل الشارة (موجات قطرية) */
function Sheen() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute' }}>
      <Path d="M0 70 Q40 40 100 55 L100 100 L0 100 Z" fill="#ffffff" opacity={0.08} />
      <Path d="M30 0 Q60 30 100 20 L100 0 Z" fill="#ffffff" opacity={0.1} />
    </Svg>
  );
}

/** خط صغير لآخر القراءات — يبيّن هل الإشارة ثابتة ولا تتذبذب */
function Spark({ data, color, w = 64, h = 14 }: { data: number[]; color: string; w?: number; h?: number }) {
  // أقل من ٦ قراءات = شرطة صغيرة بطرف المربع (في الآيفون تطلع كأنها «-» أو «.» تحت الرقم) ← نخلي مكانها فاضي
  if (data.length < 6) return <View style={{ width: w, height: h }} />;
  const lo = Math.min(...data), hi = Math.max(...data);
  const span = Math.max(hi - lo, 3); // تذبذب بسيط ما يطلع كأنه جبال
  const mid = (hi + lo) / 2;
  const pts = data.map((v, i) => {
    const x = (i / (HIST_N - 1)) * w + (w - ((data.length - 1) / (HIST_N - 1)) * w);
    const y = h / 2 - ((v - mid) / span) * (h - 3);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <Svg width={w} height={h}>
      <Polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

/** نسبة قوة الإشارة على الشريط: ‎-125 (أحمر) ← ‎-80 (أخضر) */
const rsrpPos = (v?: number) => (v === undefined ? 0 : Math.max(0.03, Math.min(0.97, (v + 125) / 45)));

/** العدّاد (قوس أكبر من نص دائرة شوي — مثل تصميم حسن) */
function Arc({ w, id }: { w: number; id: string }) {
  const sw = 9, r = w / 2 - sw / 2, cx = w / 2, cy = r + sw / 2;
  const x1 = cx - r, y1 = cy, x2 = cx + r, y2 = cy;
  const h = cy + sw / 2 + 1;
  return (
    <Svg width={w} height={h}>
      <Defs>
        <SvgGrad id={`arc${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#9be15d" />
          <Stop offset="0.45" stopColor="#22c55e" />
          <Stop offset="1" stopColor="#14b8a6" />
        </SvgGrad>
      </Defs>
      <Path d={`M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`} stroke={`url(#arc${id})`} strokeWidth={sw} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** شريط الألوان (أحمر ← أخضر) مع مثلث المؤشر */
function LevelBar({ pos, w, id }: { pos: number; w: number; id: string }) {
  const x = 4 + pos * (w - 8);
  return (
    <Svg width={w} height={15}>
      <Defs>
        <SvgGrad id={`lvl${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#ef4444" />
          <Stop offset="0.28" stopColor="#f97316" />
          <Stop offset="0.48" stopColor="#facc15" />
          <Stop offset="0.75" stopColor="#4ade80" />
          <Stop offset="1" stopColor="#22c55e" />
        </SvgGrad>
      </Defs>
      <Rect x={0} y={8} width={w} height={6} rx={3} fill={`url(#lvl${id})`} />
      <Polygon points={`${x - 4.5},0.5 ${x + 4.5},0.5 ${x},7`} fill={isDark ? '#e5e7eb' : '#14532d'} />
    </Svg>
  );
}

/** لوحة التقنية: خلفية متدرجة بحافة يسار منحنية وزاوية سفلية دائرية (فوق يمين البطاقة) */
function PanelBg({ w, h, id, colors }: { w: number; h: number; id: string; colors: [string, string] }) {
  const d = `M ${w} 0 L ${w * 0.02} 0 C ${w * 0.2} 0, ${w * 0.22} ${h * 0.3}, ${w * 0.27} ${h * 0.55} C ${w * 0.31} ${h * 0.8}, ${w * 0.36} ${h}, ${w * 0.5} ${h} L ${w} ${h} Z`;
  return (
    // بالإنجليزي الصف ينقلب (اللوحة يسار) ← نقلب الخلفية معه
    <Svg width={w} height={h} style={[{ position: 'absolute', top: 0 }, EN_MODE ? { left: 0, transform: [{ scaleX: -1 }] } : { right: 0 }]}>
      <Defs>
        <SvgGrad id={`pan${id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors[1]} />
          <Stop offset="1" stopColor={colors[0]} />
        </SvgGrad>
      </Defs>
      <Path d={d} fill={`url(#pan${id})`} />
      <Path d={`M ${w * 0.45} ${h} C ${w * 0.6} ${h * 0.7}, ${w * 0.8} ${h * 0.95}, ${w} ${h * 0.6} L ${w} ${h} Z`} fill="#ffffff" opacity={0.07} />
    </Svg>
  );
}

/** موجات خفيفة بخلفية البطاقة (تحت يمين) */
function CardWaves({ color }: { color: string }) {
  return (
    <Svg width="100%" height={70} viewBox="0 0 300 70" preserveAspectRatio="none" style={[{ position: 'absolute', right: 0, bottom: 24, left: 0 }, EN_MODE && { transform: [{ scaleX: -1 }] }]}>
      <Path d="M120 70 C 170 30, 220 60, 300 20 L300 70 Z" fill={color} opacity={0.05} />
      <Path d="M150 70 C 200 45, 250 65, 300 40 L300 70 Z" fill={color} opacity={0.05} />
    </Svg>
  );
}

function CheckDot({ color }: { color: string }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 16 16">
      <Circle cx={8} cy={8} r={8} fill={color} />
      <Path d="M4.5 8.2l2.2 2.2 4.6-4.7" stroke="#fff" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function Pulse({ color }: { color: string }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
      <Path d="M2 12h4l2-6 4 12 3-9 2 3h5" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function Tile({ icon, label, value, color, bg, onPress, spark }: {
  icon: React.ReactNode; label: string; value: string; color: string; bg: string; onPress?: () => void; spark?: number[];
}) {
  return (
    <Pressable style={[s.tile, { backgroundColor: bg }]} onPress={onPress} disabled={!onPress}>
      <Text style={s.tileLbl} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
      <View style={s.tileRow}>
        {icon}
        {/* الرقم والوحدة نص واحد (LTR) — بالإنجليزي الصف ينقلب فكانت dB تطلع قبل الرقم */}
        <Text style={[s.tileVal, { color }]} numberOfLines={1} adjustsFontSizeToFit>
          {'\u2066' + value.replace(/^\u200e/, '')}<Text style={s.tileUnit}>{' dB\u2069'}</Text>
        </Text>
      </View>
      <View style={s.tileSpark}>{!!spark && <Spark data={spark} color={color} w={50} h={9} />}</View>
    </Pressable>
  );
}

// الإطار الملوّن رجع (بطاقة أضيق) — العدّاد كان يدخل على لوحة التقنية (صورة حسن ٢٢ نوفمبر)
const PANEL_W = 126, PANEL_H = 92, GAUGE_W = 118;

function TechRow({ r, onDetails, hist }: { r: Row; onDetails?: () => void; hist?: Hist }) {
  const b = num(r.band);
  const code = r.band ? (r.tech === 'NR' ? `n${b ?? ''}` : `B${b ?? ''}`) : r.tech === 'NR' ? '5G' : '4G';
  const mhz = b ? friendlyBand(r.tech, b).match(/\d{3,4}/)?.[0] : undefined;
  const lv = rsrpLevel(r.rsrp);
  const qlv = rsrqLevel(r.rsrq);
  const barsOn = lv === 'excellent' ? 4 : lv === 'good' ? 3 : lv === 'fair' ? 2 : 1;
  const accent = TECH_ACCENT[r.tech];
  const bwN = num(r.bw);
  const iso = (x: string) => '⁨' + x + '⁩';
  // tr قبل العزل: النمط «قناة {0}» ما يتطابق والنص فيه علامات العزل
  const meta = [bwN && `${bwN} MHz`, r.arfcn && tr(`قناة ${r.arfcn}`), r.pci && `PCI ${r.pci}`].filter(Boolean).map(x => iso(String(x)));
  return (
    <View style={s.card}>
      <CardWaves color={accent} />
      <PanelBg w={PANEL_W} h={PANEL_H} id={r.tech} colors={TECH_TINT[r.tech]} />
      <View style={s.row}>
        {/* ١. لوحة التقنية (المحتوى — الخلفية مرسومة فوق) */}
        <Pressable onPress={onDetails} disabled={!onDetails} accessibilityRole="button" accessibilityLabel="تفاصيل الإشارة" style={s.panel}>
          <View style={s.panelTop}>
            <Bars color="#ffffff" size={20} on={barsOn} />
            <View style={s.techPill}><Text style={s.techPillTxt}>{r.tech === 'NR' ? '5G' : '4G'}</Text></View>
          </View>
          <Text style={s.panelBand} numberOfLines={1} adjustsFontSizeToFit>{code}</Text>
          {!!mhz && <Text style={s.panelMhz} numberOfLines={1}>{iso(`${mhz} MHz`)}</Text>}
        </Pressable>

        {/* ٢. العدّاد */}
        <View style={s.mid}>
          <View style={s.midHead}>
            <Text style={s.midLbl} numberOfLines={1}>قوة الإشارة</Text>
            <Waves color={accent} />
          </View>
          <View style={s.gauge}>
            <Arc w={GAUGE_W} id={r.tech} />
            <View style={s.gaugeTxt}>
              <Text style={s.gaugeUnit}>dBm</Text>
              <Text style={[s.rsrp, { color: LEVEL_COLOR[lv] }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{fmt(r.rsrp)}</Text>
            </View>
          </View>
          <LevelBar pos={rsrpPos(r.rsrp)} w={GAUGE_W + 8} id={r.tech} />
          <View style={[s.status, { backgroundColor: LEVEL_SOFT[lv] }]}>
            <Text style={[s.statusTxt, { color: LEVEL_COLOR[lv] }]} numberOfLines={1}>{STATUS[lv]}</Text>
            <CheckDot color={LEVEL_COLOR[lv]} />
          </View>
        </View>

        {/* ٣. النقاء والجودة */}
        <View style={s.tiles}>
          <Tile icon={<Bars color={accent} size={17} />} label="SINR (النقاء)" value={fmt(r.sinr, 1)}
            color={accent} bg={TECH_SOFT[r.tech]} onPress={onDetails} spark={hist?.sinr} />
          <Tile icon={<Antenna color={LEVEL_COLOR[qlv]} size={17} />} label="RSRQ (الجودة)" value={fmt(r.rsrq, 1)}
            color={LEVEL_COLOR[qlv]} bg={LEVEL_SOFT[qlv]} onPress={onDetails} spark={hist?.rsrq} />
        </View>
      </View>

      {/* ٤. MHz · قناة · PCI */}
      {meta.length > 0 && (
        <View style={[s.metaBar, { backgroundColor: TECH_SOFT[r.tech] }]}>
          {meta.map((m, i) => (
            <View key={i} style={[s.metaCell, i > 0 && s.metaSep]}>
              <Text style={s.metaTxt} numberOfLines={1} adjustsFontSizeToFit>{m}</Text>
              <Pulse color={accent} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function TechCards({ signal, onDetails }: { signal?: Signal | null; onDetails?: () => void }) {
  const rows = techRows(signal);
  // تاريخ القراءات لكل تقنية — يتجدد مع كل قراءة جديدة للراوتر
  const hist = useRef<Record<Tech, Hist>>({ LTE: { rsrp: [], sinr: [], rsrq: [] }, NR: { rsrp: [], sinr: [], rsrq: [] } });
  const lastSig = useRef<Signal | null | undefined>(undefined);
  if (signal && signal !== lastSig.current) {
    lastSig.current = signal;
    for (const r of rows) {
      const h = hist.current[r.tech];
      const push = (arr: number[], v?: number) => { if (v !== undefined) { arr.push(v); if (arr.length > HIST_N) arr.shift(); } };
      push(h.rsrp, r.rsrp); push(h.sinr, r.sinr); push(h.rsrq, r.rsrq);
    }
  }
  if (!rows.length) return null;
  return (
    <View style={s.wrap}>
      {rows.map(r => <TechRow key={r.tech} r={r} onDetails={onDetails} hist={hist.current[r.tech]} />)}
    </View>
  );
}

const s = sheet({
  wrap: { alignSelf: 'stretch', gap: 8 },
  card: {
    backgroundColor: tBg('#ffffff'), borderRadius: 24, borderWidth: 1, borderColor: tBd('#ffffff'),
    overflow: 'hidden', paddingBottom: 8,
    shadowColor: C.shadow, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  row: { flexDirection: 'row-reverse', alignItems: 'flex-start', paddingLeft: 8 },
  // ١. لوحة التقنية — المحتوى في يمين اللوحة
  panel: { width: 80, height: PANEL_H, paddingTop: 9, paddingRight: 9, paddingLeft: 2, alignItems: 'center' },
  panelTop: { alignSelf: 'stretch', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  techPill: { borderRadius: 999, borderWidth: 1.5, borderColor: '#ffffffd9', paddingHorizontal: 7, paddingVertical: 0 },
  techPillTxt: { color: '#ffffff', fontSize: 12, fontFamily: FONT.numHeavy },
  panelBand: { color: '#ffffff', fontSize: 28, lineHeight: 32, fontFamily: FONT.numHeavy, textAlign: 'center', includeFontPadding: false, marginTop: 4 },
  panelMhz: { color: '#ffffffee', fontSize: 10.5, fontFamily: FONT.numSemi, textAlign: 'center' },
  // ٢. العدّاد
  mid: { flex: 1, alignItems: 'center', paddingTop: 8 },
  midHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginBottom: 2 },
  midLbl: { color: C.text, fontSize: 12.5, fontWeight: '800' },
  gauge: { width: GAUGE_W, alignItems: 'center' },
  gaugeTxt: { position: 'absolute', left: 0, right: 0, top: 12, alignItems: 'center' },
  gaugeUnit: { color: C.sub, fontSize: 11, fontFamily: FONT.numSemi },
  rsrp: { fontSize: 30, lineHeight: 34, fontFamily: FONT.numHeavy, includeFontPadding: false },
  status: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginTop: 5 },
  statusTxt: { fontSize: 11.5, fontWeight: '800' },
  // ٣. المربعات
  tiles: { width: 90, gap: 6, paddingTop: 8 },
  tile: { height: 56, borderRadius: 14, paddingHorizontal: 6, paddingTop: 5, alignItems: 'center', overflow: 'hidden' },
  tileLbl: { color: C.text, fontSize: 9.5, fontWeight: '800' },
  tileRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  tileVal: { fontSize: 18, lineHeight: 22, fontFamily: FONT.numHeavy, includeFontPadding: false, flexShrink: 1 },
  tileUnit: { color: C.text, fontSize: 10, fontFamily: FONT.numSemi },
  tileSpark: { alignSelf: 'stretch', alignItems: 'flex-end', paddingRight: 4, height: 10 },
  // ٤. الشريط السفلي
  metaBar: { flexDirection: 'row-reverse', marginHorizontal: 8, marginTop: 8, borderRadius: 14, paddingVertical: 7 },
  metaCell: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 2 },
  metaSep: { borderRightWidth: 1, borderRightColor: C.cardBorder },
  metaTxt: { color: C.text, fontSize: 11.5, fontFamily: FONT.numSemi, flexShrink: 1 },
});
