/**
 * اختيار الترددات — بأسماء مفهومة (700 · يوصل بعيد) بدل B28.
 * المستخدم يختار الترددات المسموحة لـ 4G و 5G، يشوف السرعة المتوقعة وتركيبة الدمج،
 * ويجرّب التركيبة دقيقة (الشاشة تطبّقها بأمان وترجع لو صارت أسوأ).
 * النجمة = التردد الأساسي الفعلي الحين (من النواقل) — للعرض فقط.
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BandConfig, Carrier } from '../drivers/types';
import { BAND_FREQ, NR_FREQ } from '../utils/bands';
import { C, isDark } from './theme';
import { Icon } from './Icon';
import Svg, { Path, Circle, Rect, Text as SvgText } from 'react-native-svg';

/** رسمة برج خفيفة لزاوية البطاقة */
function TowerArt() {
  const w = 'rgba(255,255,255,';
  return (
    <Svg width={78} height={78} viewBox="0 0 78 78">
      <Path d="M17 30a26 26 0 0 1 44 0" stroke={w + '0.22)'} strokeWidth={2.4} fill="none" strokeLinecap="round" />
      <Path d="M24 33a17 17 0 0 1 30 0" stroke={w + '0.35)'} strokeWidth={2.4} fill="none" strokeLinecap="round" />
      <Path d="M31 36a8 8 0 0 1 16 0" stroke={w + '0.55)'} strokeWidth={2.4} fill="none" strokeLinecap="round" />
      <Circle cx={39} cy={38} r={3.2} fill={w + '0.9)'} />
      <Path d="M39 41L29 74M39 41l10 33M32 60h14M30 68h18" stroke={w + '0.7)'} strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <Rect x={50} y={44} width={24} height={16} rx={5} fill={w + '0.18)'} stroke={w + '0.5)'} strokeWidth={1.2} />
      <SvgText x={62} y={55.5} fontSize={10} fontWeight="bold" fontFamily="IBMPlexSansArabic_700Bold" fill="#fff" textAnchor="middle">5G</SvgText>
    </Svg>
  );
}

export type Tech = 'LTE' | 'NR';
/** أقوى قراءة شفناها لكل تردد من الأبراج المجاورة */
export interface BandSeen { rsrp?: number; sinr?: number; score: number }

type Kind = 'far' | 'mid' | 'fast';
const KIND_LABEL: Record<Kind, string> = { far: 'يوصل بعيد', mid: 'متوازن', fast: 'سريع' };
const KIND_COLOR: Record<Kind, { bg: string; fg: string; bar: string }> = isDark
  ? {
      far: { bg: '#24493c', fg: '#6adcbd', bar: '#ffd36a' },
      mid: { bg: '#2b3a5a', fg: '#9cbcff', bar: '#ffffff' },
      fast: { bg: '#40376b', fg: '#c9b8ff', bar: '#d6c6ff' },
    }
  : {
      far: { bg: '#e3f8ef', fg: '#0f7a52', bar: '#ffd36a' },
      mid: { bg: '#e6eeff', fg: '#2f6bff', bar: '#ffffff' },
      fast: { bg: '#f0eaff', fg: '#7a51e0', bar: '#d6c6ff' },
    };
/** لون مميز لكل تقنية: 4G أزرق و 5G بنفسجي */
const TECH_TONE: Record<Tech, { fg: string; soft: string; line: string }> = isDark
  ? { LTE: { fg: '#9cbcff', soft: '#26324a', line: '#3b4d72' }, NR: { fg: '#c9b8ff', soft: '#33294f', line: '#53447f' } }
  : { LTE: { fg: '#2f6bff', soft: '#eef3ff', line: '#c9d8ff' }, NR: { fg: '#7a51e0', soft: '#f4efff', line: '#dccdff' } };
const KIND_HINT: Record<Kind, string> = { far: 'يمسك من بعيد وداخل البيت', mid: 'سرعة وتغطية', fast: 'أعلى سرعة لو البرج قريب' };
/** المفتاح المطفي: وردي هادي (مقفل باختيارك — مو خطأ) */
const SW_OFF = isDark
  ? { backgroundColor: '#4d2c33', borderColor: '#7a3a44' }
  : { backgroundColor: '#F7D4D4', borderColor: '#E9A3A3' };
const LAYOUT_KEY = 'bandly.bandsLayout';
const SIG_TEXT = ['ما ظهر برج', 'ضعيفة', 'متوسطة', 'قوية', 'قوية جداً'];

const mhzOf = (tech: Tech, b: number) => parseInt((tech === 'NR' ? NR_FREQ : BAND_FREQ)[b] ?? '0', 10);
const kindOf = (mhz: number): Kind => (mhz && mhz < 1000 ? 'far' : mhz && mhz < 2300 ? 'mid' : 'fast');
const shortOf = (mhz: number) => (!mhz ? '—' : mhz >= 1000 ? (mhz / 1000).toFixed(1) + 'G' : String(mhz));
const levelOf = (s?: BandSeen) => (!s ? 0 : s.score >= 0.75 ? 4 : s.score >= 0.55 ? 3 : s.score >= 0.35 ? 2 : 1);
const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every(x => b.includes(x));

/** عرض نطاق تقريبي لكل تردد عند stc/موبايلي/زين لو الراوتر ما عطانا الرقم */
const TYPICAL_BW: Record<Tech, Record<number, number>> = {
  LTE: { 28: 10, 20: 10, 8: 10, 3: 20, 1: 20, 7: 20, 38: 20, 40: 20, 41: 20, 42: 20 },
  NR: { 78: 100, 77: 100, 41: 100, 40: 50, 28: 20, 1: 20, 3: 20 },
};

/** سرعة تقديرية (ميقا) لتردد: عرض النطاق × كفاءة حسب الإشارة */
function estMbps(tech: Tech, b: number, seen?: BandSeen, bw?: number) {
  const width = bw ?? TYPICAL_BW[tech][b] ?? (tech === 'NR' ? 40 : 15);
  const s = seen ? seen.score : 0.3;
  const eff = (0.4 + 4.4 * s) * (tech === 'NR' ? 1.25 : 1); // بت/هرتز تقريباً مع MIMO
  return width * eff * 0.7;
}

export interface BandPickerProps {
  cfg: BandConfig;
  seen: Record<string, BandSeen>; // المفتاح "LTE:28" أو "NR:78"
  carriers: Carrier[];
  activeLte: number[];
  activeNr: number[];
  busy: boolean;
  onTry: (lte: number[], nr: number[] | undefined, label: string) => void;
  onAuto: () => void;
  /** ترددات فحصناها (ثبّتنا عليها) وما مسك برج — المفتاح "LTE:7" */
  none?: string[];
  /** فحص الترددات اللي ما انقاست: يثبّت على كل واحد لحاله ويقيس */
  onScan?: (tech: Tech, bands: number[]) => void;
  scanning?: boolean;
  scanNote?: string;
}

export function BandPicker({ cfg, seen, carriers, activeLte, activeNr, busy, onTry, onAuto, none = [], onScan, scanning, scanNote }: BandPickerProps) {
  const [tab, setTab] = useState<Tech>('LTE');
  const [showAll, setShowAll] = useState(false);
  // شكل القائمة: مربعات (الجديد) أو صفوف (القديم) — يتذكر اختيارك
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  useEffect(() => {
    AsyncStorage.getItem(LAYOUT_KEY).then(v => { if (v === 'list') setLayout('list'); }).catch(() => {});
  }, []);
  const changeLayout = (l: 'grid' | 'list') => {
    setLayout(l);
    AsyncStorage.setItem(LAYOUT_KEY, l).catch(() => {});
  };
  // فاضي = تلقائي (كل الترددات مسموحة)
  const [lte, setLte] = useState<number[]>(cfg.locked);
  const [nr, setNr] = useState<number[]>(cfg.nrLocked);
  useEffect(() => { setLte(cfg.locked); setNr(cfg.nrLocked); }, [cfg]);

  const hasNr = cfg.nrSupported.length > 0;
  const supported = (t: Tech) => (t === 'LTE' ? cfg.supported : cfg.nrSupported);
  const sel = (t: Tech) => (t === 'LTE' ? lte : nr);
  const isOn = (t: Tech, b: number) => !sel(t).length || sel(t).includes(b);
  const known = (t: Tech, b: number) =>
    !!seen[t + ':' + b] || (t === 'LTE' ? activeLte : activeNr).includes(b) ||
    (t === 'LTE' ? cfg.locked : cfg.nrLocked).includes(b);

  /** «ما ظهر برج» كانت مضلّلة: الراوتر ما يقيس إلا ترددات قريبة من اللي ماسكه */
  const sigText = (t: Tech, b: number, lvl: number) =>
    lvl > 0 ? SIG_TEXT[lvl] : none.includes(t + ':' + b) ? 'ما فيه برج' : 'غير مفحوص';
  const unknownOf = (t: Tech) => supported(t).filter(b =>
    !seen[t + ':' + b] && !none.includes(t + ':' + b) && !(t === 'LTE' ? activeLte : activeNr).includes(b));

  const list = (t: Tech) => {
    const all = supported(t);
    const shown = showAll ? all : all.filter(b => known(t, b) || (sel(t).length > 0 && sel(t).includes(b)));
    const base = shown.length ? shown : all;
    // الأقوى فوق، وبعدها حسب التردد
    return [...base].sort((a, b) =>
      (seen[t + ':' + b]?.score ?? -1) - (seen[t + ':' + a]?.score ?? -1) || mhzOf(t, a) - mhzOf(t, b));
  };

  const toggle = (t: Tech, b: number) => {
    if (busy) return;
    const all = supported(t);
    const cur = sel(t).length ? sel(t) : all;
    let next = cur.includes(b) ? cur.filter(x => x !== b) : [...cur, b];
    if (!next.length) return; // لازم يبقى تردد واحد على الأقل
    next = next.sort((x, y) => x - y);
    if (sameSet(next, all)) next = [];
    (t === 'LTE' ? setLte : setNr)(next);
  };

  const pcc = carriers.find(c => c.role === 'PCC' && c.tech === 'LTE') ?? carriers.find(c => c.role === 'PCC');
  const bwOf = (t: Tech, b: number) => carriers.find(c => c.tech === t && c.band === b)?.bandwidth;

  // التركيبة المتوقعة: أقوى ٣ ترددات 4G مسموحة وفيها برج + أقوى 5G
  const combo = useMemo(() => {
    const pick = (t: Tech, max: number) =>
      supported(t)
        .filter(b => isOn(t, b) && (seen[t + ':' + b] || (t === 'LTE' ? activeLte : activeNr).includes(b)))
        .map(b => ({ t, b, mhz: mhzOf(t, b), v: estMbps(t, b, seen[t + ':' + b], bwOf(t, b)) }))
        .sort((x, y) => y.v - x.v)
        .slice(0, max);
    return [...pick('LTE', 3), ...(hasNr ? pick('NR', 1) : [])];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lte, nr, seen, carriers, cfg]);
  const speed = Math.round(combo.reduce((a, x) => a + x.v, 0) / 5) * 5;

  const dirty = !sameSet(lte, cfg.locked) || !sameSet(nr, cfg.nrLocked);
  const nrDirty = !sameSet(nr, cfg.nrLocked);
  const isAuto = !cfg.locked.length && !cfg.nrLocked.length;
  const countOn = (t: Tech) => (sel(t).length || supported(t).length);

  const name = (t: Tech, b: number) => (t === 'NR' ? '5G ' : '') + (mhzOf(t, b) || (t === 'NR' ? 'n' : 'B') + b);
  const label = [
    lte.length ? lte.map(b => name('LTE', b)).join(' + ') : '4G تلقائي',
    ...(nrDirty ? [nr.length ? nr.map(b => name('NR', b)).join(' + ') : '5G تلقائي'] : []),
  ].join(' · ');

  const rows = list(tab);
  // نجمع الترددات حسب نوعها، والمجموعة اللي فيها أقوى إشارة تطلع فوق
  const groups = (['fast', 'mid', 'far'] as Kind[])
    .map(kind => ({ kind, bands: rows.filter(b => kindOf(mhzOf(tab, b)) === kind) }))
    .filter(g => g.bands.length)
    .sort((x, y) => {
      const best = (g: { bands: number[] }) => Math.max(-1, ...g.bands.map(b =>
        (tab === 'LTE' ? activeLte : activeNr).includes(b) ? 2 : seen[tab + ':' + b]?.score ?? -1));
      return best(y) - best(x);
    });
  const heroColors: [string, string] = isDark ? [C.blueDeep, C.blue] : ['#6a4cff', '#2f6bff'];
  const tot = combo.reduce((a, x) => a + x.v, 0) || 1;

  return (
    <View style={{ gap: 12 }}>
      {/* البطاقة الرئيسية */}
      <LinearGradient colors={heroColors} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.hero}>
        <View style={s.heroTop}>
          <View style={s.speedBox}>
            <Text style={s.heroKey}>سرعة متوقعة تقريباً</Text>
            <View style={s.heroNumRow}>
              <Text style={s.heroUnit}>ميقا</Text>
              <Text style={s.heroNum}>{combo.length ? speed : '—'}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'center', paddingBottom: 6, gap: 2, flex: 1 }}>
            <Text style={s.heroKey}>{isAuto && !dirty ? 'الوضع' : 'مسموح'}</Text>
            {isAuto && !dirty ? (
              <Text style={s.heroSide}>تلقائي</Text>
            ) : (
              (hasNr ? (['LTE', 'NR'] as Tech[]) : (['LTE'] as Tech[])).map(t => (
                <View key={t} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                  <View style={[s.chipTech, { backgroundColor: t === 'NR' ? '#d6c6ff' : '#ffffff' }]}>
                    <Text style={[s.chipTechText, { color: t === 'NR' ? '#4b2aa8' : '#2f6bff' }]}>{t === 'LTE' ? '4G' : '5G'}</Text>
                  </View>
                  <Text style={s.heroSide}>{countOn(t)}</Text>
                </View>
              ))
            )}
          </View>
          <TowerArt />
        </View>
        <View style={s.compBar}>
          {combo.length
            ? combo.map(x => (
                <View key={x.t + x.b} style={{ flex: Math.max(6, Math.round((x.v / tot) * 100)), backgroundColor: x.t === 'NR' ? KIND_COLOR.fast.bar : KIND_COLOR[kindOf(x.mhz)].bar }} />
              ))
            : <View style={{ flex: 1 }} />}
        </View>
        <View style={s.chips}>
          {combo.map(x => (
            <View
              key={x.t + x.b}
              style={[s.chip, x.t === 'NR' ? s.chipNr : s.chipLte, pcc && pcc.tech === x.t && pcc.band === x.b && s.chipPrim]}
            >
              <View style={[s.chipTech, { backgroundColor: x.t === 'NR' ? '#d6c6ff' : '#ffffff' }]}>
                <Text style={[s.chipTechText, { color: x.t === 'NR' ? '#4b2aa8' : '#2f6bff' }]}>{x.t === 'NR' ? '5G' : '4G'}</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={s.chipText} numberOfLines={1}>{mhzOf(x.t, x.b) || x.b}</Text>
                <Text style={s.chipUnit}>ميقا</Text>
              </View>
              {pcc && pcc.tech === x.t && pcc.band === x.b && <Text style={s.chipStar}>★</Text>}
            </View>
          ))}
          {!combo.length && <Text style={s.heroKey}>اختر ترددات فيها برج قريب</Text>}
        </View>
      </LinearGradient>

      {/* 4G / 5G */}
      {hasNr && (
        <View style={s.seg}>
          {(['NR', 'LTE'] as Tech[]).map(t => {
            const tone = TECH_TONE[t];
            const on = tab === t;
            return (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                style={[s.segBtn, { borderColor: on ? tone.fg : tone.line, backgroundColor: on ? tone.soft : C.card }, on && s.segOn]}
              >
                <Icon name={t === 'LTE' ? 'tower' : 'wifi'} size={16} color={on ? tone.fg : C.muted} />
                <View style={[s.segBadge, { backgroundColor: on ? tone.fg : tone.soft }]}>
                  <Text style={[s.segBadgeText, { color: on ? '#fff' : tone.fg }]}>{t === 'LTE' ? '4G' : '5G'}</Text>
                </View>
                <Text style={[s.segCount, { color: on ? tone.fg : C.muted }]}>{`${countOn(t)} من ${supported(t).length}`}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {layout === 'grid' ? (
        <>
      {/* القائمة — مجموعات (يوصل بعيد / متوازن / سريع)، وكل مجموعة مربعين جنب بعض */}
      <View style={s.card}>
        <View style={s.legend}>
          <Text style={s.headText}>اضغط المربع تشغّله أو تطفيه</Text>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: '#f0b020', fontSize: 12 }}>★</Text>
            <Text style={s.headText}>الأساسي</Text>
            <Text style={s.headText}>·</Text>
            <Pressable onPress={() => changeLayout('list')} hitSlop={8}>
              <Text style={[s.headText, { color: C.blue }]}>اعرض كقائمة</Text>
            </Pressable>
          </View>
        </View>
        {!!onScan && (scanning ? (
          <View style={s.scanBox}>
            <ActivityIndicator size="small" color={TECH_TONE[tab].fg} />
            <Text style={[s.scanTxt, { color: TECH_TONE[tab].fg }]} numberOfLines={2}>{scanNote || 'نفحص الترددات...'}</Text>
          </View>
        ) : unknownOf(tab).length > 0 && (
          <Pressable disabled={busy} onPress={() => onScan(tab, unknownOf(tab))}
            style={({ pressed }) => [s.scanBox, { borderColor: TECH_TONE[tab].line, backgroundColor: TECH_TONE[tab].soft }, (pressed || busy) && { opacity: 0.7 }]}>
            <Icon name="target" size={16} color={TECH_TONE[tab].fg} stroke={2.2} />
            <Text style={[s.scanTxt, { color: TECH_TONE[tab].fg }]}>
              نفحص لك {unknownOf(tab).length} {unknownOf(tab).length === 1 ? 'تردد' : 'ترددات'} غير مفحوصة
            </Text>
          </Pressable>
        ))}
        {groups.map(g => (
          <View key={g.kind} style={{ gap: 8 }}>
            <View style={s.groupHead}>
              <View style={[s.groupDot, { backgroundColor: KIND_COLOR[g.kind].fg }]} />
              <Text style={s.groupTitle}>{KIND_LABEL[g.kind]}</Text>
              <Text style={s.groupHint}>{KIND_HINT[g.kind]}</Text>
            </View>
            <View style={s.grid}>
              {g.bands.map(b => {
                const mhz = mhzOf(tab, b);
                const k = KIND_COLOR[g.kind];
                const sv = seen[tab + ':' + b];
                const lvl = levelOf(sv);
                const live = (tab === 'LTE' ? activeLte : activeNr).includes(b);
                const prim = !!pcc && pcc.tech === tab && pcc.band === b;
                const on = isOn(tab, b);
                const barColor = lvl >= 3 ? C.green : lvl === 2 ? '#e0a100' : '#e94079';
                return (
                  <Pressable
                    key={tab + b}
                    onPress={() => toggle(tab, b)}
                    style={[
                      s.tile,
                      on && s.tileOn,
                      live && { borderColor: isDark ? '#2f5a46' : '#bfead3' },
                      on && { borderRightWidth: 4, borderRightColor: live ? C.green : TECH_TONE[tab].fg },

                    ]}
                  >
                    <View style={s.tileTop}>
                      <View style={[s.badge, { backgroundColor: k.bg }]}>
                        <Text style={[s.badgeText, { color: k.fg }]}>{shortOf(mhz)}</Text>
                      </View>
                      <View style={{ flex: 1, alignItems: 'flex-end' }}>
                        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
                          <Text style={s.title}>{mhz || b}</Text>
                          {prim && <Text style={{ color: '#f0b020', fontSize: 13 }}>★</Text>}
                        </View>
                        <Text style={s.code}>ميقا</Text>
                      </View>
                      <View style={[s.sw, on ? { backgroundColor: TECH_TONE[tab].fg, borderColor: TECH_TONE[tab].fg, justifyContent: 'flex-start' } : { ...SW_OFF, justifyContent: 'flex-end' }]}>
                        <View style={[s.knob, !on && { borderWidth: 1, borderColor: SW_OFF.borderColor }]} />
                      </View>
                    </View>
                    <View style={s.subRow}>
                      <View style={s.bars}>
                        {[1, 2, 3, 4].map(n => (
                          <View key={n} style={[s.bar, { height: 3 + n * 2.25, backgroundColor: n <= lvl ? barColor : C.lineSoft }]} />
                        ))}
                      </View>
                      <Text style={[s.sub, live && { color: C.green }]} numberOfLines={1}>
                        {live ? 'متصل عليه' : sigText(tab, b, lvl)}
                      </Text>
                      <View style={{ flex: 1 }} />
                      <Text style={s.code}>{(tab === 'NR' ? 'n' : 'B') + b}</Text>
                    </View>
                  </Pressable>
                );
              })}
              {g.bands.length % 2 === 1 && <View style={[s.tile, { opacity: 0, borderWidth: 0 }]} />}
            </View>
          </View>
        ))}
        <Pressable onPress={() => setShowAll(v => !v)} style={s.more} hitSlop={6}>
          <Icon name={showAll ? 'up' : 'down'} size={14} color={C.blue} />
          <Text style={s.moreText}>{showAll ? 'اعرض اللي فيها برج بس' : `اعرض كل ترددات ${tab === 'LTE' ? '4G' : '5G'} اللي يدعمها الراوتر`}</Text>
        </Pressable>
      </View>

        </>
      ) : (
        <>
      {/* القائمة — الشكل القديم (صفوف) */}
      <View style={o.card}>
        <View style={o.cardHead}>
          <Text style={o.headText}>التردد</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Text style={[o.headText, { width: 44, textAlign: 'center' }]}>مسموح</Text>
            <Text style={[o.headText, { width: 40, textAlign: 'center' }]} numberOfLines={1}>أساسي</Text>
          </View>
        </View>
        {rows.map(b => {
          const mhz = mhzOf(tab, b);
          const k = KIND_COLOR[kindOf(mhz)];
          const sv = seen[tab + ':' + b];
          const lvl = levelOf(sv);
          const live = (tab === 'LTE' ? activeLte : activeNr).includes(b);
          const prim = !!pcc && pcc.tech === tab && pcc.band === b;
          const on = isOn(tab, b);
          const barColor = lvl >= 3 ? C.green : lvl === 2 ? '#e0a100' : '#e94079';
          return (
            <Pressable
              key={tab + b}
              onPress={() => toggle(tab, b)}
              style={[
                o.row,
                on && o.rowOn,
                live && { borderColor: isDark ? '#2f5a46' : '#bfead3' },
                on && { borderRightWidth: 4, borderRightColor: live ? C.green : TECH_TONE[tab].fg },
                !sv && !live && { opacity: 0.55 },
              ]}
            >
              <View style={[o.badge, { backgroundColor: k.bg }]}>
                <Text style={[o.badgeText, { color: k.fg }]}>{shortOf(mhz)}</Text>
              </View>
              <View style={o.mid}>
                <View style={o.titleRow}>
                  <Text style={o.title}>{mhz ? `${mhz} ميقا` : (tab === 'NR' ? 'n' : 'B') + b}</Text>
                  {!!mhz && (
                    <View style={[o.tag, { backgroundColor: k.bg }]}>
                      <Text style={[o.tagText, { color: k.fg }]}>{KIND_LABEL[kindOf(mhz)]}</Text>
                    </View>
                  )}
                </View>
                <View style={o.subRow}>
                  <View style={o.bars}>
                    {[1, 2, 3, 4].map(n => (
                      <View key={n} style={[o.bar, { height: 3 + n * 2.25, backgroundColor: n <= lvl ? barColor : C.lineSoft }]} />
                    ))}
                  </View>
                  {(live || lvl > 0) && <View style={[o.dot, { backgroundColor: live ? C.green : barColor }]} />}
                  <Text style={[o.sub, live && { color: C.green }]} numberOfLines={1}>
                    {live ? 'متصل عليه الحين' : sigText(tab, b, lvl)}
                  </Text>
                  <Text style={o.code}>{(tab === 'NR' ? 'n' : 'B') + b}</Text>
                </View>
              </View>
              <View style={[o.star, prim && { backgroundColor: isDark ? '#40382a' : '#fff6dc' }]}>
                <Icon name="star" size={16} color={prim ? '#f0b020' : C.lineSoft} />
              </View>
              <View style={[o.sw, on ? { backgroundColor: C.blue, borderColor: C.blue, justifyContent: 'flex-start' } : { ...SW_OFF, justifyContent: 'flex-end' }]}>
                <View style={[o.knob, !on && { borderWidth: 1, borderColor: SW_OFF.borderColor }]} />
              </View>
            </Pressable>
          );
        })}
        <Pressable onPress={() => changeLayout('grid')} hitSlop={6} style={{ alignSelf: 'center' }}>
          <Text style={[o.headText, { color: C.blue }]}>اعرض كمربعات</Text>
        </Pressable>
        <Pressable onPress={() => setShowAll(v => !v)} style={o.more} hitSlop={6}>
          <Icon name={showAll ? 'up' : 'down'} size={14} color={C.blue} />
          <Text style={o.moreText}>{showAll ? 'اعرض اللي فيها برج بس' : `اعرض كل ترددات ${tab === 'LTE' ? '4G' : '5G'} اللي يدعمها الراوتر`}</Text>
        </Pressable>
      </View>

        </>
      )}

      {/* الأزرار */}
      <Pressable
        onPress={() => onTry(lte, nrDirty ? nr : undefined, label)}
        disabled={busy || !dirty}
        style={[{ borderRadius: 16, overflow: 'hidden' }, (busy || !dirty) && { opacity: 0.45 }]}
      >
        <LinearGradient colors={heroColors} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={s.cta}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
            <Icon name="speed" size={18} color="#fff" />
            <Text style={s.ctaText}>جرّب التركيبة دقيقة</Text>
          </View>
        </LinearGradient>
      </Pressable>
      <Text style={s.note}>
        {dirty
          ? 'نقيس قبل وبعد — لو صار أسوأ أو ما اتصل يرجع للإعدادات السابقة تلقائياً'
          : 'شغّل وطفّ الترددات اللي تبيها، وبعدين جرّبها'}
      </Text>
      {!isAuto && (
        <Pressable onPress={onAuto} disabled={busy} style={[s.ghost, busy && { opacity: 0.45 }]}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 7 }}>
            <Icon name="refresh" size={16} color={C.blue} />
            <Text style={s.ghostText}>رجّع الراوتر يختار بنفسه</Text>
          </View>
        </Pressable>
      )}
      {dirty && (
        <Pressable onPress={() => { setLte(cfg.locked); setNr(cfg.nrLocked); }} disabled={busy} hitSlop={6}>
          <Text style={[s.note, { color: C.blue, fontWeight: '700' }]}>تراجع عن التغييرات</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  hero: { borderRadius: 22, padding: 16, gap: 12 },
  heroTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
  speedBox: {
    alignItems: 'flex-end', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8,
  },
  heroKey: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },
  heroNumRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroNum: { color: '#fff', fontSize: 34, fontWeight: '700', lineHeight: 40 },
  heroUnit: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600' },
  heroSide: { color: '#fff', fontSize: 14, fontWeight: '700' },
  compBar: { flexDirection: 'row-reverse', gap: 4, height: 8, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.15)' },
  chips: { flexDirection: 'row-reverse', gap: 6 },
  chip: {
    flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, borderWidth: 1, paddingVertical: 7, paddingHorizontal: 8, gap: 8,
  },
  chipLte: { backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.45)' },
  chipNr: { backgroundColor: 'rgba(214,198,255,0.22)', borderColor: 'rgba(214,198,255,0.75)' },
  chipPrim: { borderColor: '#ffd36a', borderWidth: 1.5 },
  chipTech: { borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  chipTechText: { fontSize: 10, fontWeight: '800' },
  chipText: { color: '#fff', fontSize: 16, fontWeight: '700', lineHeight: 19 },
  chipUnit: { color: 'rgba(255,255,255,0.8)', fontSize: 9.5, fontWeight: '600', lineHeight: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chipStar: { color: '#ffd36a', fontSize: 12, fontWeight: '800' },

  seg: { flexDirection: 'row', gap: 8 },
  segBtn: {
    flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1.5, flexDirection: 'row-reverse',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  segOn: { shadowColor: C.shadow, shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  segBadge: { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2 },
  segBadgeText: { fontSize: 12, fontWeight: '800' },
  segCount: { color: C.muted, fontSize: 12, fontWeight: '700', writingDirection: 'rtl' },
  segText: { color: C.muted, fontSize: 13, fontWeight: '700', writingDirection: 'rtl' },

  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 22, overflow: 'hidden', padding: 12, gap: 10 },
  legend: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 2 },
  groupHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, paddingHorizontal: 4, marginTop: 4 },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupTitle: { color: C.text, fontSize: 13, fontWeight: '700' },
  groupHint: { color: C.muted, fontSize: 11, fontWeight: '600', flexShrink: 1 },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexBasis: '47%', flexGrow: 1, borderRadius: 16, borderWidth: 1, gap: 8,
    borderColor: isDark ? '#3a3128' : '#edf0f6', backgroundColor: isDark ? '#2a231c' : '#ffffff',
    paddingVertical: 10, paddingHorizontal: 10,
  },
  tileOn: { borderColor: isDark ? '#4a3d30' : '#dfe7fb', backgroundColor: isDark ? '#30281f' : '#fbfcff' },
  tileTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  headText: { color: C.muted, fontSize: 11.5, fontWeight: '700' },
  badge: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11.5, fontWeight: '700' },
  title: { color: C.text, fontSize: 16, fontWeight: '700' },
  subRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 12 },
  bar: { width: 3, borderRadius: 2 },
  sub: { color: C.muted, fontSize: 11, fontWeight: '600', flexShrink: 1 },
  code: { color: C.muted, opacity: 0.75, fontSize: 11, fontWeight: '600' },
  sw: { width: 38, height: 22, borderRadius: 999, padding: 2, flexDirection: 'row', backgroundColor: C.line, borderWidth: 1, borderColor: C.line },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', shadowColor: '#0d2350', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  more: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center',
    marginTop: 2, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 999,
    borderWidth: 1, borderColor: TECH_TONE.LTE.line, backgroundColor: TECH_TONE.LTE.soft,
  },
  moreText: { color: C.blue, fontSize: 12, fontWeight: '700' },
  scanBox: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, borderWidth: 1.5, borderColor: C.line, paddingVertical: 11, paddingHorizontal: 12,
  },
  scanTxt: { fontSize: 13, fontWeight: '800', textAlign: 'center', flexShrink: 1 },

  cta: { minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  note: { color: C.muted, fontSize: 11.5, fontWeight: '600', textAlign: 'center' },
  ghost: { borderWidth: 1, borderColor: C.blue, borderRadius: 16, paddingVertical: 12, alignItems: 'center' },
  ghostText: { color: C.blue, fontSize: 14, fontWeight: '700' },
});

/** ستايل الشكل القديم (صفوف) — للي يفضّله */
const o = StyleSheet.create({
  hero: { borderRadius: 22, padding: 16, gap: 12 },
  heroTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
  speedBox: {
    alignItems: 'flex-end', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8,
  },
  heroKey: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },
  heroNumRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroNum: { color: '#fff', fontSize: 34, fontWeight: '700', lineHeight: 40 },
  heroUnit: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600' },
  heroSide: { color: '#fff', fontSize: 14, fontWeight: '700' },
  compBar: { flexDirection: 'row-reverse', gap: 4, height: 8, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.15)' },
  chips: { flexDirection: 'row-reverse', gap: 6 },
  chip: {
    flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, borderWidth: 1, paddingVertical: 7, paddingHorizontal: 8, gap: 8,
  },
  chipLte: { backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.45)' },
  chipNr: { backgroundColor: 'rgba(214,198,255,0.22)', borderColor: 'rgba(214,198,255,0.75)' },
  chipPrim: { borderColor: '#ffd36a', borderWidth: 1.5 },
  chipTech: { borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  chipTechText: { fontSize: 10, fontWeight: '800' },
  chipText: { color: '#fff', fontSize: 16, fontWeight: '700', lineHeight: 19 },
  chipUnit: { color: 'rgba(255,255,255,0.8)', fontSize: 9.5, fontWeight: '600', lineHeight: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chipStar: { color: '#ffd36a', fontSize: 12, fontWeight: '800' },

  seg: { flexDirection: 'row', gap: 8 },
  segBtn: {
    flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1.5, flexDirection: 'row-reverse',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  segOn: { shadowColor: C.shadow, shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  segBadge: { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2 },
  segBadgeText: { fontSize: 12, fontWeight: '800' },
  segCount: { color: C.muted, fontSize: 12, fontWeight: '700', writingDirection: 'rtl' },
  segText: { color: C.muted, fontSize: 13, fontWeight: '700', writingDirection: 'rtl' },

  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 22, overflow: 'hidden', paddingBottom: 10, gap: 8 },
  cardHead: {
    flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 22, paddingTop: 12, paddingBottom: 2,
  },
  headText: { color: C.muted, fontSize: 11.5, fontWeight: '700' },
  row: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, minHeight: 62,
    marginHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: isDark ? '#3a3128' : '#edf0f6',
    backgroundColor: isDark ? '#2a231c' : '#ffffff',
  },
  rowOn: { borderColor: isDark ? '#4a3d30' : '#dfe7fb', backgroundColor: isDark ? '#30281f' : '#fbfcff' },
  badge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11.5, fontWeight: '700' },
  mid: { flex: 1, minWidth: 0, gap: 3, alignItems: 'flex-end' },
  titleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  title: { color: C.text, fontSize: 14.5, fontWeight: '700' },
  tag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 1 },
  tagText: { fontSize: 10.5, fontWeight: '700', lineHeight: 16 },
  subRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, maxWidth: '100%' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 12 },
  bar: { width: 3, borderRadius: 2 },
  sub: { color: C.muted, fontSize: 11, fontWeight: '600', flexShrink: 1 },
  code: { color: C.muted, opacity: 0.75, fontSize: 11, fontWeight: '600' },
  star: { width: 40, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sw: { width: 44, height: 26, borderRadius: 999, padding: 2, flexDirection: 'row', backgroundColor: C.line, borderWidth: 1, borderColor: C.line },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', shadowColor: '#0d2350', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  more: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center',
    marginTop: 2, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 999,
    borderWidth: 1, borderColor: TECH_TONE.LTE.line, backgroundColor: TECH_TONE.LTE.soft,
  },
  moreText: { color: C.blue, fontSize: 12, fontWeight: '700' },

  cta: { minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  note: { color: C.muted, fontSize: 11.5, fontWeight: '600', textAlign: 'center' },
  ghost: { borderWidth: 1, borderColor: C.blue, borderRadius: 16, paddingVertical: 12, alignItems: 'center' },
  ghostText: { color: C.blue, fontSize: 14, fontWeight: '700' },
});
