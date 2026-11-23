/**
 * صفحة راوتر الفايبر (ONT) — تصميم حسن ١٥ نوفمبر بعد التعديلات:
 * هوية خاصة (فيروزي، «ألياف بصرية») · الإشارة الضوئية رقم كبير + شريط بثلاث مناطق (بدون عدّاد دائري) · التشخيص بجملة ·
 * سرعة آخر اختبار (الراوتر ما يعطيها لحظياً) · الأجهزة وآخر تحديث. اللي الراوتر ما يدعمه ينخفي أو يقول بوضوح.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, Href } from 'expo-router';
import { View, Text, Pressable } from '../i18n/rn';
import { sheet } from '../i18n';
import { P } from './Pro';
import { Icon } from './Icon';
import { tBd, tBg } from './theme';
import type { OpticReading } from '../drivers/types';
import { adviseFiber, fiberLevel, FiberSample } from '../utils/fiberAdvice';
import { FIBER_ZONES, FIBER_MIN, FIBER_MAX, fiberPos, fiberAgo } from '../utils/fiberBar';
import { fmtMbps } from '../utils/speedLive';

const TEAL = '#0f8f7a';
const TONE = { poor: P.red, fair: P.amber, good: P.green } as const;
const LEVEL_TXT = { excellent: 'ممتازة', good: 'جيدة', fair: 'مقبولة', poor: 'فيها مشكلة', unknown: '—' } as const;
const LEVEL_COL = { excellent: P.green, good: P.green, fair: P.amber, poor: P.red, unknown: P.sub } as const;

/** «ألياف بصرية · GPON · شغال من …» — صيغ ثابتة عشان الترجمة */
function fiberSub(mode?: string, uptime?: string): string {
  const m = mode && !/فايبر/.test(mode) ? mode : '';
  if (m && uptime) return `ألياف بصرية · ${m} · شغال من ${uptime}`;
  if (m) return `ألياف بصرية · ${m}`;
  if (uptime) return `ألياف بصرية · شغال من ${uptime}`;
  return 'ألياف بصرية';
}

interface SpeedPoint { down: number; up: number; ping: number; at: number }

export function FiberHero({ routerId, name, mode, online, optic, opticSupported, devices, uptime, updatedAt, hist,
  onAdvisor, onSpeed, onDevices }: {
  routerId: string; name: string; mode?: string; online: boolean | null; optic: OpticReading | null; opticSupported: boolean;
  devices?: number; uptime?: string; updatedAt?: number; hist?: FiberSample[];
  onAdvisor: () => void; onSpeed: () => void; onDevices?: () => void;
}) {
  const [speed, setSpeed] = useState<SpeedPoint | null>(null);
  const [plan, setPlan] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    // آخر اختبار: شاشة السرعة (bandly.lastSpeed) أو بطاقة قبل/بعد في التوجيه (bandly_speed) — الأحدث
    AsyncStorage.multiGet([`bandly.lastSpeed.${routerId}`, `bandly_speed_${routerId}`]).then(([[, a], [, b]]) => {
      const all: SpeedPoint[] = [];
      try { if (a) all.push(JSON.parse(a)); } catch {}
      try { if (b) { const p = JSON.parse(b) as { before?: SpeedPoint; after?: SpeedPoint }; if (p.before) all.push(p.before); if (p.after) all.push(p.after); } } catch {}
      const last = all.filter(x => x && x.at).sort((x, y) => y.at - x.at)[0];
      if (last) setSpeed(last);
    }).catch(() => {});
    AsyncStorage.getItem(`bandly.fiberPlan.${routerId}`).then(v => setPlan(Number(v) || 0)).catch(() => {});
  }, [routerId, updatedAt]);
  // «آخر تحديث» يتحدّث كل دقيقة
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 60_000); return () => clearInterval(t); }, []);

  const rx = optic?.rx;
  const lv = fiberLevel(rx);
  const adv = rx !== undefined ? adviseFiber(rx, optic?.tx, hist ?? []) : null;
  const off = online === false;

  return (
    <View style={{ gap: 12 }}>
      {/* الهوية */}
      <View style={[f.id, { backgroundColor: tBg('#e3f6f1'), borderColor: tBd('#9fdccd') }]}>
        <View style={[f.idIcon, { backgroundColor: TEAL }]}><Icon name="globe" size={22} color="#ffffff" stroke={2.2} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={f.idName} numberOfLines={1} adjustsFontSizeToFit>{name}</Text>
          <Text style={f.idSub} numberOfLines={1}>{fiberSub(mode, uptime)}</Text>
        </View>
        <View style={[f.pill, { backgroundColor: off ? P.redSoft : P.greenSoft }]}>
          <View style={[f.pillDot, { backgroundColor: off ? P.red : P.green }]} />
          <Text style={[f.pillTxt, { color: off ? P.red : P.green }]}>{off ? 'مقطوع' : 'متصل'}</Text>
        </View>
      </View>

      {/* الإشارة الضوئية */}
      <Pressable onPress={onAdvisor} style={[f.card, { borderColor: tBd('#dbe5f3') }]}>
        <View style={f.row}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
            <Icon name="sun" size={18} color={LEVEL_COL[lv]} stroke={2.2} />
            <Text style={f.cardTitle}>الإشارة الضوئية</Text>
          </View>
          {rx !== undefined && (
            <View style={[f.chip, { backgroundColor: lv === 'poor' ? P.redSoft : lv === 'fair' ? P.amberSoft : P.greenSoft }]}>
              <Text style={[f.chipTxt, { color: LEVEL_COL[lv] }]}>{`الإشارة ${LEVEL_TXT[lv]}`}</Text>
            </View>
          )}
        </View>

        {rx !== undefined ? (
          <>
            <Text style={[f.big, { color: LEVEL_COL[lv] }]}>
              {rx.toFixed(1)} <Text style={f.bigUnit}>dBm</Text>
            </Text>
            <View style={{ direction: 'ltr', gap: 6 }}>
              <View style={f.bar}>
                {FIBER_ZONES.map(z => (
                  <View key={z.from} style={{ flex: z.to - z.from, backgroundColor: TONE[z.tone], opacity: 0.85 }} />
                ))}
              </View>
              <View style={[f.marker, { left: `${fiberPos(rx) * 100}%` }]} />
              <View style={f.scale}>
                <Text style={f.scaleTxt}>ضعيفة</Text>
                <Text style={f.scaleTxt}>−27</Text>
                <Text style={f.scaleTxt}>ممتازة −8 إلى −24</Text>
                <Text style={f.scaleTxt}>قوية زيادة</Text>
              </View>
            </View>
            {(optic?.tx !== undefined || optic?.tempC !== undefined) && (
              <View style={f.tiles}>
                {optic?.tx !== undefined && <View style={f.tile}><Text style={f.tileLbl}>الإرسال Tx</Text><Text style={f.tileVal}>{`${optic.tx.toFixed(1)} dBm`}</Text></View>}
                {optic?.tempC !== undefined && <View style={f.tile}><Text style={f.tileLbl}>حرارة الوحدة</Text><Text style={f.tileVal}>{`${optic.tempC}°`}</Text></View>}
              </View>
            )}
            {!!adv && (
              <View style={[f.adv, { backgroundColor: P.soft }]}>
                <Text style={[f.advTitle, { color: LEVEL_COL[lv] }]}>{adv.title}</Text>
                <Text style={f.advWhy} numberOfLines={2}>{adv.why}</Text>
                <Text style={f.link}>مستشار الفايبر ‹</Text>
              </View>
            )}
          </>
        ) : (
          <Text style={f.none}>
            {opticSupported ? 'ما وصلتنا قراءة الضوء — يا إما الكيبل مفصول، أو النت داخل له من كابل إيثرنت.' : 'راوترك ما يعرض قوة الضوء للحين — نضيفها أول ما توصلنا ملفات صفحته.'}
          </Text>
        )}
      </Pressable>

      {/* السرعة (آخر اختبار) */}
      <View style={f.tiles}>
        <Pressable onPress={onSpeed} style={[f.sp, { borderColor: tBd('#dbe5f3') }]}>
          <View style={[f.spIcon, { backgroundColor: P.violetSoft }]}><Icon name="down" size={18} color={P.violet} stroke={2.4} /></View>
          <View style={{ flex: 1 }}>
            <Text style={f.tileLbl}>التنزيل</Text>
            <Text style={f.spVal}>{speed ? fmtMbps(speed.down) : '—'} <Text style={f.spUnit}>Mbps</Text></Text>
          </View>
        </Pressable>
        <Pressable onPress={onSpeed} style={[f.sp, { borderColor: tBd('#dbe5f3') }]}>
          <View style={[f.spIcon, { backgroundColor: P.blueSoft }]}><Icon name="up" size={18} color={P.blue} stroke={2.4} /></View>
          <View style={{ flex: 1 }}>
            <Text style={f.tileLbl}>الرفع</Text>
            <Text style={f.spVal}>{speed ? fmtMbps(speed.up) : '—'} <Text style={f.spUnit}>Mbps</Text></Text>
          </View>
        </Pressable>
      </View>
      <Pressable onPress={onSpeed} style={[f.card, f.rowCard, { borderColor: tBd('#dbe5f3') }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={f.tileLbl}>آخر اختبار سرعة</Text>
          <Text style={f.rowVal}>{speed ? `${fiberAgo(speed.at)} · بنق ${speed.ping} ms` : 'ما سويت اختبار للحين'}</Text>
        </View>
        <Text style={f.link}>اختبر الحين ‹</Text>
      </Pressable>

      {/* عدّة الألياف (٢٣ نوفمبر): السرعة مقابل الباقة + الواي فاي بالغرف */}
      <View style={f.tiles}>
        <Pressable onPress={() => router.push(`/planspeed/${routerId}` as Href)} style={[f.sp, { borderColor: tBd('#9fdccd') }]}>
          <View style={[f.spIcon, { backgroundColor: tBg('#e3f6f1') }]}><Icon name="chart" size={18} color={TEAL} stroke={2.4} /></View>
          <View style={{ flex: 1 }}>
            <Text style={f.tileLbl}>سرعتك وباقتك</Text>
            <Text style={[f.rowVal, { color: TEAL }]} numberOfLines={1}>
              {plan && speed ? `${Math.round((speed.down / plan) * 100)}٪ من الباقة` : 'افحص ‹'}
            </Text>
          </View>
        </Pressable>
        <Pressable onPress={() => router.push(`/rooms/${routerId}` as Href)} style={[f.sp, { borderColor: tBd('#dbe5f3') }]}>
          <View style={[f.spIcon, { backgroundColor: P.blueSoft }]}><Icon name="wifi" size={18} color={P.blue} stroke={2.4} /></View>
          <View style={{ flex: 1 }}>
            <Text style={f.tileLbl}>الواي فاي</Text>
            <Text style={[f.rowVal, { color: P.blue }]} numberOfLines={1}>بالغرف ‹</Text>
          </View>
        </Pressable>
      </View>

      {/* الأجهزة + آخر تحديث */}
      <View style={[f.card, f.rowCard, { borderColor: tBd('#dbe5f3') }]}>
        <Pressable style={{ flex: 1, gap: 2 }} onPress={onDevices} disabled={!onDevices}>
          <Text style={f.tileLbl}>الأجهزة المتصلة</Text>
          <Text style={f.rowVal}>{devices !== undefined ? `${devices} متصل الحين` : '—'}</Text>
        </Pressable>
        <View style={f.vDiv} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={f.tileLbl}>آخر تحديث</Text>
          <Text style={f.rowVal}>{fiberAgo(updatedAt)}</Text>
        </View>
      </View>
    </View>
  );
}

const f = sheet({
  id: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderRadius: 20, borderWidth: 1, padding: 14 },
  idIcon: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  idName: { color: P.text, fontSize: 18, fontWeight: '900', textAlign: 'right' },
  idSub: { color: TEAL, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  pill: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  pillDot: { width: 8, height: 8, borderRadius: 99 },
  pillTxt: { fontSize: 12.5, fontWeight: '800' },
  card: { backgroundColor: P.card, borderRadius: 20, borderWidth: 1, padding: 14, gap: 10 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: P.text, fontSize: 15, fontWeight: '900' },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipTxt: { fontSize: 12, fontWeight: '800' },
  big: { fontSize: 44, fontWeight: '900', textAlign: 'center', fontVariant: ['tabular-nums'] },
  bigUnit: { fontSize: 16, fontWeight: '700' },
  bar: { height: 10, borderRadius: 999, overflow: 'hidden', flexDirection: 'row' },
  marker: { position: 'absolute', top: -4, width: 6, height: 18, marginLeft: -3, borderRadius: 3, backgroundColor: P.text, borderWidth: 1.5, borderColor: P.card },
  scale: { flexDirection: 'row', justifyContent: 'space-between' },
  scaleTxt: { color: P.faint, fontSize: 10.5, fontWeight: '700' },
  tiles: { flexDirection: 'row-reverse', gap: 10 },
  tile: { flex: 1, backgroundColor: P.soft, borderRadius: 14, padding: 10, gap: 2 },
  tileLbl: { color: P.sub, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  tileVal: { color: P.text, fontSize: 17, fontWeight: '900', textAlign: 'right' },
  adv: { borderRadius: 14, padding: 10, gap: 3 },
  advTitle: { fontSize: 14, fontWeight: '900', textAlign: 'right' },
  advWhy: { color: P.sub, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  link: { color: P.blue, fontSize: 12.5, fontWeight: '800', textAlign: 'right' },
  none: { color: P.sub, fontSize: 13, lineHeight: 20, textAlign: 'right' },
  sp: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: P.card, borderRadius: 20, borderWidth: 1, padding: 12 },
  spIcon: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  spVal: { color: P.text, fontSize: 22, fontWeight: '900', textAlign: 'right', fontVariant: ['tabular-nums'] },
  spUnit: { color: P.sub, fontSize: 12, fontWeight: '700' },
  rowCard: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 12 },
  rowVal: { color: P.text, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  vDiv: { width: 1, alignSelf: 'stretch', backgroundColor: P.border },
});
