/**
 * مركز التحكم — إعدادات الراوتر المتقدمة في مكان واحد ومرتب:
 *   🎮 الألعاب (NAT / UPnP / DMZ)   📶 الواي فاي   🌙 الليل (الأنوار)   🛠 الصيانة (إعادة تشغيل تلقائية)
 * كل قسم يظهر بس لو الراوتر يدعمه. وكل تغيير نقرأه بعد الحفظ ونتأكد إنه انحفظ فعلاً.
 */
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet, Switch, Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, Href } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { ConnectedDevice, RouterExtras } from '../../src/drivers/types';
import { Icon, IconName } from '../../src/ui/Icon';
import { P, shadow } from '../../src/ui/Pro';
import { C, tBg, tBd, tFg } from '../../src/ui/theme';

type Key = 'nat' | 'upnp' | 'dmz' | 'led' | 'reboot';

const hhmm = (mins: number) => `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
const LED_PRESETS = [
  { label: '١٢ص – ٦ص', start: '00:00', end: '06:00' },
  { label: '١١م – ٧ص', start: '23:00', end: '07:00' },
  { label: '١٠م – ٦ص', start: '22:00', end: '06:00' },
];

/* ═══ قطع التصميم ═══ */

function Section({ icon, title, caption, colors, children }: {
  icon: IconName; title: string; caption: string; colors: [string, string]; children: ReactNode;
}) {
  return (
    <View style={[s.section, shadow]}>
      <View style={s.secHead}>
        <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.secIcon}>
          <Icon name={icon} size={20} color="#fff" stroke={2.2} />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={s.secTitle}>{title}</Text>
          <Text style={s.secCap}>{caption}</Text>
        </View>
      </View>
      <View style={s.secBody}>{children}</View>
    </View>
  );
}

function Row({ title, sub, right, last, children }: {
  title: string; sub?: string; right?: ReactNode; last?: boolean; children?: ReactNode;
}) {
  return (
    <View style={[s.row, !last && s.rowLine]}>
      <View style={s.rowTop}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.rowTitle}>{title}</Text>
          {!!sub && <Text style={s.rowSub}>{sub}</Text>}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

function Toggle({ value, busy, onChange, color }: { value: boolean; busy: boolean; onChange: (v: boolean) => void; color: string }) {
  if (busy) return <ActivityIndicator color={color} style={{ width: 51 }} />;
  return (
    <Switch value={value} onValueChange={onChange}
      trackColor={{ true: color, false: '#cbd5e1' }} thumbColor="#ffffff" ios_backgroundColor="#cbd5e1" />
  );
}

function Badge({ text, tone }: { text: string; tone: 'good' | 'warn' | 'info' }) {
  const c = tone === 'good' ? ['#e7f8ef', '#0f7a52'] : tone === 'warn' ? ['#fff5e3', '#b45309'] : ['#e8efff', '#1d3f9e'];
  return <View style={[s.badge, { backgroundColor: tBg(c[0]) }]}><Text style={[s.badgeTxt, { color: tFg(c[1]) }]}>{text}</Text></View>;
}

/* ═══ الشاشة ═══ */

export default function ControlCenter() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [ex, setEx] = useState<RouterExtras | null>(null);
  const [wifiCh, setWifiCh] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Key | null>(null);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<ConnectedDevice[] | null>(null);
  const [devNames, setDevNames] = useState<Record<string, string>>({});
  const mounted = useRef(true);

  const read = useCallback(async (r: SavedRouter) => {
    const v = await withSession(r, async d => (d.getExtras ? d.getExtras() : {}), false);
    if (mounted.current) setEx(v);
    return v;
  }, []);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const r = await getRouter(id);
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try {
        const caps = await withSession(r, async d => ({ wifi: !!d.setWifiChannel }), false).catch(() => ({ wifi: false }));
        if (mounted.current) setWifiCh(caps.wifi);
        await read(r);
        const devs = await withSession(r, d => (d.getDevices ? d.getDevices() : Promise.resolve([] as ConnectedDevice[])), false).catch(() => []);
        if (mounted.current) setDevNames(Object.fromEntries(devs.filter(x => x.ip).map(x => [x.ip!, x.name || x.mac])));
      } catch (e: any) {
        if (mounted.current) setError(e?.message ?? String(e));
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => { mounted.current = false; };
  }, [id, read]);

  /** نطبّق ثم نقرأ ونتأكد — لو ما انحفظ نقول للمستخدم */
  const apply = async (key: Key, fn: (d: any) => Promise<void>, check: (v: RouterExtras) => boolean) => {
    if (!info || busy) return;
    setBusy(key); setError('');
    try {
      await withSession(info, fn, false);
      await new Promise(r => setTimeout(r, 1200));
      const v = await read(info);
      if (!check(v)) Alert.alert('ما انحفظ', 'الراوتر رد بموافقة بس الإعداد ما تغيّر. ممكن موديلك ما يسمح بهالتعديل من خارج صفحته.');
    } catch (e: any) {
      if (mounted.current) setError(e?.message ?? String(e));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const pickDmz = async () => {
    if (!info) return;
    const devs = await withSession(info, d => (d.getDevices ? d.getDevices() : Promise.resolve([] as ConnectedDevice[])), false).catch(() => []);
    setPicker(devs.filter(d => d.ip));
  };

  const empty = ex && !ex.nat && ex.upnp === undefined && !ex.dmz && !ex.ledNight && !ex.autoReboot;
  const games = ex && (ex.nat || ex.upnp !== undefined || ex.dmz);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        <LinearGradient colors={['#1d2b64', '#3b2f8f']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.hero}>
          <View style={s.heroRing} />
          <View style={[s.heroRing, s.heroRing2]} />
          <Text style={s.heroKicker}>{info?.name ?? 'الراوتر'}</Text>
          <Text style={s.heroTitle}>مركز التحكم</Text>
          <Text style={s.heroSub}>إعدادات الراوتر المتقدمة في مكان واحد. كل تغيير نتأكد إنه انحفظ.</Text>
        </LinearGradient>

        {loading ? (
          <View style={s.loading}><ActivityIndicator color={P.violet} /><Text style={s.loadingTxt}>نقرأ إعدادات الراوتر...</Text></View>
        ) : (
          <>
            {!!error && <View style={s.err}><Text style={s.errTxt}>{error}</Text></View>}

            {games && (
              <Section icon="game" title="الألعاب" caption="بنق أثبت واتصال مفتوح للبلايستيشن والإكس بوكس" colors={['#8b5cf6', '#5b34c9']}>
                {ex!.nat && (
                  <Row title="نوع الـ NAT" sub="«مفتوح» يحل مشكلة NAT مقيّد في الألعاب والمكالمات الجماعية."
                    right={busy === 'nat' ? <ActivityIndicator color="#7050f0" /> : <Badge text={ex!.nat === 'cone' ? 'مناسب للألعاب ✓' : 'مقيّد'} tone={ex!.nat === 'cone' ? 'good' : 'warn'} />}>
                    <View style={s.seg}>
                      {([['cone', 'مفتوح', 'للألعاب'], ['symmetric', 'مقيّد', 'أمان أعلى']] as const).map(([v, t, sub]) => {
                        const on = ex!.nat === v;
                        return (
                          <Pressable key={v} disabled={!!busy || on} style={[s.segBtn, on && s.segOn]}
                            onPress={() => apply('nat', d => d.setNat(v), x => x.nat === v)}>
                            <Text style={[s.segTxt, on && s.segTxtOn]}>{t}</Text>
                            <Text style={[s.segSub, on && { color: tFg('#5b34c9') }]}>{sub}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </Row>
                )}
                {ex!.upnp !== undefined && (
                  <Row title="فتح المنافذ تلقائياً (UPnP)" sub="الجهاز يفتح المنافذ اللي تحتاجها اللعبة لحاله."
                    last={!ex!.dmz}
                    right={<Toggle value={ex!.upnp} busy={busy === 'upnp'} color="#7050f0"
                      onChange={v => apply('upnp', d => d.setUpnp(v), x => x.upnp === v)} />}>
                    {!!ex!.upnpMaps?.length && (
                      <View style={s.maps}>
                        <Text style={s.mapsTitle}>منافذ مفتوحة الحين</Text>
                        {ex!.upnpMaps.slice(0, 6).map((m, i) => (
                          <Text key={i} style={s.mapsRow}>
                            {(devNames[m.ip] || m.ip)}{m.app ? ` · ${m.app}` : ''} · {m.port} {m.proto}
                          </Text>
                        ))}
                      </View>
                    )}
                  </Row>
                )}
                {ex!.dmz && (
                  <Row title="جهاز الألعاب المفتوح (DMZ)" last
                    sub={ex!.dmz.on
                      ? `مفتوح بالكامل لـ: ${devNames[ex!.dmz.ip] || ex!.dmz.ip}`
                      : 'تفتح كل المنافذ لجهاز واحد. للبلايستيشن أو الإكس بوكس بس، مو للجوال أو اللابتوب.'}
                    right={<Toggle value={ex!.dmz.on} busy={busy === 'dmz'} color="#7050f0"
                      onChange={v => (v ? pickDmz() : apply('dmz', d => d.setDmz(false, ex!.dmz!.ip), x => !x.dmz?.on))} />}>
                    {ex!.dmz.on && (
                      <Pressable onPress={pickDmz} disabled={!!busy} style={s.linkBtn}>
                        <Text style={s.linkTxt}>غيّر الجهاز</Text>
                      </Pressable>
                    )}
                  </Row>
                )}
              </Section>
            )}

            {wifiCh && (
              <Section icon="wifi" title="الواي فاي" caption="اتصال أنظف بين أجهزتك والراوتر" colors={['#38bdf8', '#2563eb']}>
                <Pressable onPress={() => info && router.push(`/wifich/${info.id}` as Href)} style={({ pressed }) => [s.navRow, pressed && { opacity: 0.7 }]}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.rowTitle}>قناة الواي فاي</Text>
                    <Text style={s.rowSub}>نجرّب القنوات ونثبّت الأنظف — يقل التذبذب والتقطيع.</Text>
                  </View>
                  <View style={s.chev}><Icon name="chevron" size={16} color={tFg('#2563eb')} stroke={2.4} /></View>
                </Pressable>
              </Section>
            )}

            {ex?.ledNight && (
              <Section icon="moon" title="وضع الليل" caption="أنوار الراوتر تنطفي وقت النوم" colors={['#6366f1', '#312e81']}>
                <Row title="إطفاء الأنوار بالليل" last
                  sub={ex.ledNight.on ? `من ${ex.ledNight.start} إلى ${ex.ledNight.end} — النت شغّال عادي` : 'الأنوار تشتغل طول اليوم'}
                  right={<Toggle value={ex.ledNight.on} busy={busy === 'led'} color="#4f46e5"
                    onChange={v => apply('led', d => d.setLedNight(v, ex.ledNight!.start, ex.ledNight!.end), x => x.ledNight?.on === v)} />}>
                  {ex.ledNight.on && (
                    <View style={s.chips}>
                      {LED_PRESETS.map(p => {
                        const on = ex.ledNight!.start === p.start && ex.ledNight!.end === p.end;
                        return (
                          <Pressable key={p.label} disabled={!!busy || on} style={[s.chip, on && s.chipOn]}
                            onPress={() => apply('led', d => d.setLedNight(true, p.start, p.end), x => x.ledNight?.start === p.start)}>
                            <Text style={[s.chipTxt, on && s.chipTxtOn]}>{p.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </Row>
              </Section>
            )}

            {ex?.autoReboot && (
              <Section icon="refresh" title="الصيانة" caption="راوتر مرتاح = سرعة ثابتة" colors={['#2dd4bf', '#0f766e']}>
                <Row title="إعادة تشغيل تلقائية" last
                  sub={ex.autoReboot.on
                    ? `كل ${ex.autoReboot.everyDays} أيام، وقت ما أحد يستخدم النت (بين ${hhmm(ex.autoReboot.from)} و ${hhmm(ex.autoReboot.to)} الفجر).`
                    : 'طافية. ننصح تشغّلها — تنظّف ذاكرة الراوتر وتمنع البطء مع الأيام.'}
                  right={<Toggle value={ex.autoReboot.on} busy={busy === 'reboot'} color="#0f766e"
                    onChange={v => apply('reboot', d => d.setAutoReboot(v), x => x.autoReboot?.on === v)} />} />
              </Section>
            )}

            {empty && !wifiCh && (
              <View style={[s.section, shadow, { alignItems: 'center', padding: 22 }]}>
                <Text style={s.rowTitle}>راوترك ما يسمح بهالإعدادات من التطبيق</Text>
                <Text style={[s.rowSub, { textAlign: 'center', marginTop: 6 }]}>نضيف دعم موديلات أكثر مع التحديثات.</Text>
              </View>
            )}

            <Text style={s.foot}>🔒 نقرأ كل إعداد بعد ما ينحفظ ونتأكد منه. ما نغيّر شي بدون ما تضغط.</Text>
          </>
        )}
      </ScrollView>

      <Modal visible={!!picker} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={s.backdrop} onPress={() => setPicker(null)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={s.grip} />
          <Text style={s.sheetTitle}>اختر جهاز الألعاب</Text>
          <Text style={s.sheetSub}>بنفتح له كل المنافذ. اختر البلايستيشن أو الإكس بوكس.</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {picker?.length ? picker.map(d => (
              <Pressable key={d.mac} style={({ pressed }) => [s.devRow, pressed && { backgroundColor: C.rowBg }]}
                onPress={() => { setPicker(null); apply('dmz', x => x.setDmz(true, d.ip!, d.mac), v => !!v.dmz?.on && v.dmz.ip === d.ip); }}>
                <View style={s.devIcon}><Icon name={/play|xbox|ps\d|بلاي|اكس/i.test(d.name || '') ? 'game' : 'phone'} size={18} color={tFg('#5b34c9')} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.devName}>{d.name || 'جهاز بدون اسم'}</Text>
                  <Text style={s.devIp}>{d.ip}</Text>
                </View>
              </Pressable>
            )) : <Text style={[s.rowSub, { textAlign: 'center', padding: 20 }]}>ما لقينا أجهزة متصلة</Text>}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 16 },
  hero: { borderRadius: 26, padding: 20, paddingTop: 22, overflow: 'hidden', gap: 4 },
  heroRing: { position: 'absolute', width: 220, height: 220, borderRadius: 110, borderWidth: 26, borderColor: 'rgba(255,255,255,0.06)', left: -70, top: -60 },
  heroRing2: { width: 140, height: 140, borderRadius: 70, borderWidth: 16, left: 40, top: 70, borderColor: 'rgba(255,255,255,0.05)' },
  heroKicker: { color: '#c7d2fe', fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  heroTitle: { color: '#ffffff', fontSize: 26, fontWeight: '900', textAlign: 'right' },
  heroSub: { color: '#e0e7ff', fontSize: 13.5, lineHeight: 21, textAlign: 'right', marginTop: 2 },
  loading: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  loadingTxt: { color: P.sub, fontSize: 13 },
  section: { backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' },
  secHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, padding: 16, paddingBottom: 6 },
  secIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  secTitle: { color: C.text, fontSize: 17, fontWeight: '900', textAlign: 'right' },
  secCap: { color: P.sub, fontSize: 12.5, textAlign: 'right', marginTop: 2 },
  secBody: { paddingHorizontal: 16, paddingBottom: 6 },
  row: { paddingVertical: 14, gap: 10 },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.cardBorder },
  rowTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  rowTitle: { color: C.text, fontSize: 15, fontWeight: '800', textAlign: 'right' },
  rowSub: { color: P.sub, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt: { fontSize: 11.5, fontWeight: '800' },
  seg: { flexDirection: 'row-reverse', backgroundColor: C.rowBg, borderRadius: 16, padding: 4, gap: 4 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12 },
  segOn: { backgroundColor: tBg('#ffffff'), borderWidth: 1.5, borderColor: tBd('#c4b5fd') },
  segTxt: { color: P.sub, fontSize: 14.5, fontWeight: '900' },
  segTxtOn: { color: tFg('#5b34c9') },
  segSub: { color: P.faint, fontSize: 11, fontWeight: '700', marginTop: 1 },
  maps: { backgroundColor: tBg('#f5f3ff'), borderRadius: 14, padding: 10, gap: 4 },
  mapsTitle: { color: tFg('#5b34c9'), fontSize: 12, fontWeight: '800', textAlign: 'right' },
  mapsRow: { color: C.text, fontSize: 12.5, textAlign: 'right' },
  linkBtn: { alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: tBg('#f5f3ff') },
  linkTxt: { color: tFg('#5b34c9'), fontSize: 13, fontWeight: '800' },
  navRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 14 },
  chev: { width: 30, height: 30, borderRadius: 10, backgroundColor: tBg('#e8efff'), alignItems: 'center', justifyContent: 'center', transform: [{ scaleX: -1 }] },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.rowBg, borderWidth: 1.5, borderColor: C.cardBorder },
  chipOn: { backgroundColor: tBg('#4f46e5'), borderColor: tBd('#4f46e5') },
  chipTxt: { color: C.text, fontSize: 13, fontWeight: '800' },
  chipTxtOn: { color: tFg('#ffffff') },
  err: { backgroundColor: tBg('#fff1f2'), borderRadius: 14, padding: 12, borderWidth: 1, borderColor: tBd('#fecdd3') },
  errTxt: { color: tFg('#be123c'), fontSize: 13.5, lineHeight: 21, textAlign: 'right' },
  foot: { color: P.faint, fontSize: 12, textAlign: 'center', lineHeight: 19, paddingHorizontal: 10 },
  backdrop: { flex: 1, backgroundColor: 'rgba(8,12,30,0.45)' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, gap: 6 },
  grip: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: C.cardBorder, marginBottom: 6 },
  sheetTitle: { color: C.text, fontSize: 18, fontWeight: '900', textAlign: 'right' },
  sheetSub: { color: P.sub, fontSize: 13, textAlign: 'right', marginBottom: 8 },
  devRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 14 },
  devIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: tBg('#f5f3ff'), alignItems: 'center', justifyContent: 'center' },
  devName: { color: C.text, fontSize: 15, fontWeight: '800', textAlign: 'right' },
  devIp: { color: P.sub, fontSize: 12.5, textAlign: 'right' },
});
