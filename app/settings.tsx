/**
 * الإعدادات (٢٧ نوفمبر — تصميم بإرشادات ui-ux-pro-max): كل خيارات التطبيق العامة بمكان واحد،
 * بدل ما تكون متفرّقة (المظهر واللغة تحت الرئيسية · منطقة اللعبة في شاشة البنق · المشاركة في «أفضل شركة»).
 * - مجموعات بعناوين (العرض · الألعاب · التنبيهات والخصوصية · الدعم · عن التطبيق)
 * - كل زر ٤٤ نقطة على الأقل، أيقونات SVG، حالة «مختار» لقارئ الشاشة، ألوان من P (فاتح/داكن)
 * - المظهر واللغة يعيدون تشغيل التطبيق ← نقولها قبل الضغط
 */
import { ReactNode, useCallback, useState } from 'react';
import { Platform, Switch } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../src/i18n/rn';
import { router, useFocusEffect, type Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName } from '../src/ui/Icon';
import { P } from '../src/ui/Pro';
import { THEME_PREF, ThemePref, setThemePref, isDark, tBd } from '../src/ui/theme';
import { sheet, LANG, Lang, setLang } from '../src/i18n';
import { REGIONS, REGION_KEY, regionById } from '../src/utils/latency';
import { isMonitorRegistered } from '../src/tasks/monitor';
import { Consent, getConsent, setConsent } from '../src/services/community';
import { getWatchMode, setWatchMode, type WatchMode } from '../src/store/lockWatch';
import { getCity, setCity } from '../src/services/stats';
import { CityPicker } from '../src/ui/CityAsk';
import { DiagRow, VersionRow, WAYS, openWay, APPSTORE_REVIEW } from '../src/ui/HomeFooter';
import { desktop } from '../src/desktop/bridge';

// ═══ قطع التصميم ═══
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.secTitle} accessibilityRole="header">{title}</Text>
      <View style={s.card}>{children}</View>
      {!!note && <Text style={s.secNote}>{note}</Text>}
    </View>
  );
}

function IconBadge({ name, tint }: { name: IconName; tint: string }) {
  return (
    <View style={[s.badge, { backgroundColor: tint + (isDark ? '33' : '1f') }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Icon name={name} size={18} color={tint} stroke={2.2} />
    </View>
  );
}

/** سطر: أيقونة · عنوان + قيمة · (عنصر تحكم أو سهم). ينضغط كامل لو فيه onPress */
function Row({ icon, tint, label, value, onPress, right, a11yHint, first }: {
  icon: IconName; tint: string; label: string; value?: string; onPress?: () => void; right?: ReactNode; a11yHint?: string; first?: boolean;
}) {
  const body = (
    <>
      <IconBadge name={icon} tint={tint} />
      <View style={s.rowTxt}>
        <Text style={s.rowLabel} numberOfLines={1}>{label}</Text>
        {!!value && <Text style={s.rowValue} numberOfLines={2}>{value}</Text>}
      </View>
      {right ?? (onPress ? <View style={s.chev}><Icon name="chevron" size={16} color={P.sub} /></View> : null)}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint={a11yHint}
      style={({ pressed }) => [s.row, !first && s.rowSep, pressed && s.pressed]}>
      {body}
    </Pressable>
  ) : (
    <View style={[s.row, !first && s.rowSep]}>{body}</View>
  );
}

/** اختيار من خيارات قليلة — كل خيار ٤٤ نقطة، بأيقونة ونص (مو أيقونة بس) */
function Segmented<T extends string>({ items, value, onPick, label }: {
  items: { id: T; icon?: IconName; text: string }[]; value: T; onPick: (v: T) => void; label: string;
}) {
  return (
    <View style={s.seg} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {items.map(it => {
        const on = it.id === value;
        return (
          <Pressable key={it.id} onPress={() => !on && onPick(it.id)}
            accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} accessibilityLabel={it.text}
            style={({ pressed }) => [s.segBtn, on && s.segOn, pressed && !on && { opacity: 0.7 }]}>
            {!!it.icon && <Icon name={it.icon} size={16} color={on ? P.blue : P.sub} stroke={2.2} />}
            <Text style={[s.segTxt, on && s.segTxtOn]} numberOfLines={1}>{it.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const THEMES: { id: ThemePref; icon: IconName; text: string }[] = [
  { id: 'light', icon: 'sun', text: 'فاتح' },
  { id: 'dark', icon: 'moon', text: 'داكن' },
  { id: 'system', icon: 'phone', text: 'تلقائي' },
];
const LANGS: { id: Lang; icon: IconName; text: string }[] = [
  { id: 'ar', icon: 'globe', text: 'العربية' },
  { id: 'en', icon: 'globe', text: 'English' },
];

export default function Settings() {
  const insets = useSafeAreaInsets();
  const [region, setRegion] = useState<string>(REGIONS[0].id);
  const [regionOpen, setRegionOpen] = useState(false);
  const [monitorOn, setMonitorOn] = useState<boolean | null>(null);
  const [consent, setConsentState] = useState<Consent>(null);
  const [city, setCityState] = useState('');
  const [cityOpen, setCityOpen] = useState(false);
  const [watch, setWatchState] = useState<WatchMode>('auto');

  useFocusEffect(useCallback(() => {
    let on = true;
    AsyncStorage.getItem(REGION_KEY).then(v => { if (on && v) setRegion(regionById(v).id); }).catch(() => {});
    isMonitorRegistered().then(v => on && setMonitorOn(v)).catch(() => on && setMonitorOn(false));
    getConsent().then(v => on && setConsentState(v)).catch(() => {});
    getCity().then(v => on && setCityState(v)).catch(() => {});
    getWatchMode().then(v => on && setWatchState(v)).catch(() => {});
    return () => { on = false; };
  }, []));

  const pickRegion = (id: string) => {
    setRegion(id);
    setRegionOpen(false);
    AsyncStorage.setItem(REGION_KEY, id).catch(() => {});
  };
  const toggleConsent = (v: boolean) => {
    const next: Consent = v ? 'on' : 'off';
    setConsentState(next);
    setConsent(next).catch(() => {});
  };
  const pickCity = (v: string) => {
    setCityOpen(false);
    setCityState(v);
    setCity(v).catch(() => {});
  };

  // «حارس التثبيت»: تلقائي ← اسألني ← طافي
  const nextWatch = () => {
    const n: WatchMode = watch === 'auto' ? 'ask' : watch === 'ask' ? 'off' : 'auto';
    setWatchState(n);
    setWatchMode(n).catch(() => {});
  };
  const watchTxt = watch === 'auto' ? 'تلقائي — لو التثبيت صار أضعف بعد ساعات نرجّع إعدادك' : watch === 'ask' ? 'يسألني قبل ما يرجّع' : 'طافي';
  const reg = regionById(region);
  const cityTxt = city && city !== '-' ? city : 'ما حددتها';

  return (
    <ScrollView style={s.wrap} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}>
      <Section title="العرض" note="تغيير المظهر أو اللغة يعيد تشغيل التطبيق ثانية وحدة.">
        <View style={[s.block, { paddingTop: 12 }]}>
          <View style={s.blockHead}><IconBadge name="sun" tint={P.amber} /><Text style={s.rowLabel}>المظهر</Text></View>
          <Segmented label="المظهر" items={THEMES} value={THEME_PREF} onPick={t => { setThemePref(t); }} />
        </View>
        <View style={[s.block, s.rowSep]}>
          <View style={s.blockHead}><IconBadge name="globe" tint={P.blue} /><Text style={s.rowLabel}>اللغة</Text></View>
          <Segmented label="اللغة" items={LANGS} value={LANG} onPick={l => { setLang(l); }} />
        </View>
      </Section>

      <Section title="الألعاب" note="البنق في كل التطبيق (التوجيه، الأبراج، كاشف اللاق) يتقاس لهالسيرفر.">
        <Row first icon="game" tint={P.violet} label="سيرفر اللعبة" value={`${reg.name} · ${reg.hint}`}
          onPress={() => setRegionOpen(o => !o)} a11yHint="يفتح قائمة السيرفرات"
          right={regionOpen
            ? <View style={[s.chev, { transform: [] }]}><Icon name="down" size={16} color={P.sub} /></View>
            : <View style={s.chev}><Icon name="chevron" size={16} color={P.sub} /></View>} />
        {regionOpen && (
          <View style={s.options}>
            {REGIONS.map(r => {
              const on = r.id === region;
              return (
                <Pressable key={r.id} onPress={() => pickRegion(r.id)} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }}
                  style={({ pressed }) => [s.opt, on && s.optOn, pressed && s.pressed]}>
                  <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.radioDot} />}</View>
                  <View style={s.rowTxt}>
                    <Text style={[s.optName, on && { color: P.blue }]} numberOfLines={1}>{r.name}</Text>
                    <Text style={s.rowValue} numberOfLines={1}>{r.hint}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </Section>

      <Section title="التنبيهات والخصوصية">
        <Row first icon="bell" tint={P.green} label="المراقبة بالخلفية"
          value={monitorOn === null ? '…' : monitorOn ? 'شغّالة — ننبّهك لو طاحت الشبكة' : 'موقفة'}
          onPress={() => router.push('/monitor' as Href)} />
        <Row icon="share" tint={P.cyan} label="شارك نتايجي مع الأعضاء"
          value="أرقام بدون اسم ولا رقم — تساعد أهل حيّك يعرفون أفضل شركة وبرج"
          right={
            <Switch value={consent === 'on'} onValueChange={toggleConsent}
              accessibilityLabel="شارك نتايجي مع الأعضاء"
              trackColor={{ false: isDark ? '#3a4660' : '#cfd6e4', true: P.blue }}
              thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined}
              ios_backgroundColor={isDark ? '#3a4660' : '#cfd6e4'} />
          } />
        <Row icon="lock" tint={P.violet} label="حارس التثبيت" value={watchTxt} onPress={nextWatch} a11yHint="يبدّل بين تلقائي، يسألني، وطافي" />
        <Row icon="pin" tint={P.red} label="مدينتي" value={cityTxt} onPress={() => setCityOpen(true)} a11yHint="يفتح اختيار المدينة" />
      </Section>

      <Section title="الدعم">
        <View style={[s.block, { paddingVertical: 12 }]}>
          <View style={s.blockHead}><IconBadge name="sms" tint={P.blue} /><Text style={s.rowLabel}>تواصل مع المطوّر</Text></View>
          <View style={s.ways}>
            {WAYS.map(w => (
              <Pressable key={w.id} onPress={() => openWay(w.url)} accessibilityRole="button" accessibilityLabel={w.label}
                style={({ pressed }) => [s.way, pressed && s.pressed]}>
                <View style={[s.wayIcon, { backgroundColor: w.color }]}><Icon name={w.icon} size={17} color="#fff" stroke={2.2} /></View>
                <Text style={s.wayTxt} numberOfLines={1}>{w.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Row icon="user" tint={P.red} label="حلول المشاكل" value="قروب الدعم على تليجرام" onPress={() => openWay('https://t.me/BandlyHelp')} />
        {Platform.OS === 'ios' && (
          <Row icon="star" tint={P.amber} label="قيّم Bandly" value="تقييمك يساعدنا نوصل لناس أكثر" onPress={() => openWay(APPSTORE_REVIEW)} />
        )}
        <View style={[s.embed, s.rowSep]}><DiagRow /></View>
      </Section>

      {(desktop || Platform.OS !== 'web') && (
        <Section title="عن التطبيق">
          <View style={s.embed}><VersionRow /></View>
        </Section>
      )}

      <CityPicker visible={cityOpen} onClose={() => setCityOpen(false)} onPick={pickCity} />
    </ScrollView>
  );
}

const SOFT = isDark
  ? { borderWidth: 1, borderColor: P.border }
  : { borderWidth: 0, shadowColor: '#1b2b5c', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 };

const s = sheet({
  wrap: { flex: 1, backgroundColor: P.bg },
  content: { padding: 16, gap: 22 },
  pressed: { opacity: 0.75 },
  section: { gap: 8 },
  secTitle: { color: P.sub, fontSize: 13, fontWeight: '800', textAlign: 'right', paddingHorizontal: 6 },
  secNote: { color: P.sub, fontSize: 12, lineHeight: 18, textAlign: 'right', paddingHorizontal: 6 },
  card: { backgroundColor: P.card, borderRadius: 20, paddingHorizontal: 14, overflow: 'hidden', ...SOFT },

  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10 },
  rowSep: { borderTopWidth: 1, borderTopColor: P.border },
  badge: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowTxt: { flex: 1, minWidth: 0 },
  rowLabel: { color: P.text, fontSize: 15, fontWeight: '800', textAlign: 'right' },
  rowValue: { color: P.sub, fontSize: 12.5, lineHeight: 18, fontWeight: '600', textAlign: 'right', marginTop: 2 },
  chev: { width: 24, height: 44, alignItems: 'center', justifyContent: 'center', transform: [{ scaleX: -1 }] },

  block: { gap: 10, paddingBottom: 12, paddingTop: 12 },
  blockHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  seg: { flexDirection: 'row-reverse', backgroundColor: P.soft, borderRadius: 14, padding: 4, gap: 4 },
  segBtn: { flex: 1, minHeight: 44, borderRadius: 11, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 6 },
  segOn: { backgroundColor: P.card, borderWidth: 1.5, borderColor: tBd('#c7d7fe') },
  segTxt: { color: P.sub, fontSize: 13.5, fontWeight: '800' },
  segTxtOn: { color: P.blue },

  options: { borderTopWidth: 1, borderTopColor: P.border, paddingVertical: 6, gap: 2 },
  opt: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 6, borderRadius: 12 },
  optOn: { backgroundColor: P.blueSoft },
  optName: { color: P.text, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: P.sub, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: P.blue },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: P.blue },

  ways: { flexDirection: 'row-reverse', gap: 8 },
  way: { flex: 1, alignItems: 'center', gap: 6, minHeight: 64, paddingVertical: 6, borderRadius: 14, backgroundColor: P.soft },
  wayIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  wayTxt: { color: P.text, fontSize: 12, fontWeight: '800' },
  embed: { paddingVertical: 2 },
});
