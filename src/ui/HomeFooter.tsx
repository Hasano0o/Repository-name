/**
 * أسفل الرئيسية — مرتّب في ثلاث كتل بدل سبع بطاقات:
 *  ١) ثلاث مربعات: وضع الفني · جهاز جديد · ادعُ ربعك
 *  ٢) تواصل مع المطوّر: سطر واحد بأربع أيقونات
 *  ٣) الإعدادات: المظهر · اللغة · نسخة التطبيق (كلها في بطاقة وحدة)
 */
import { ReactNode, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Alert, Platform } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import Svg, { Circle, Path } from 'react-native-svg';
import * as Updates from 'expo-updates';
import { router, Href } from 'expo-router';
import { Icon, IconName } from './Icon';
import { P } from './Pro';
import { THEME_PREF, ThemePref, setThemePref, tBg, tBd, tFg, isDark } from './theme';
import { desktop } from '../desktop/bridge';
import { invite } from './InviteCard';
import { sheet, LANG, Lang, setLang, EN_MODE } from '../i18n';
import { diagText, sendSupportReport } from '../services/errors';
import { sendAfterLoginPages } from '../services/authDump';
import { isUnlocked, setUnlocked } from '../assistant/store';

// ═══ ١) المربعات ═══
function PeopleIcon({ c = '#ffffff' }: { c?: string }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      <Circle cx={9} cy={8} r={3.4} fill={c} />
      <Path d="M2.6 19.5c.6-3.4 3.2-5.4 6.4-5.4s5.8 2 6.4 5.4" fill={c} />
      <Circle cx={17.2} cy={9} r={2.6} fill={c} opacity={0.7} />
      <Path d="M15.6 14.4c2.8-.3 5.2 1.4 5.8 4.6" stroke={c} strokeOpacity={0.7} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function Tile({ title, sub, colors, icon, onPress }: {
  title: string; sub: string; colors: [string, string]; icon: ReactNode; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.tile, pressed && s.pressed]}>
      <View style={[s.tileIcon, { backgroundColor: tBg(colors[1] + '1f'), borderColor: tBd(colors[1] + '33') }]}>{icon}</View>
      <Text style={s.tileTitle} numberOfLines={1}>{title}</Text>
      <Text style={s.tileSub} numberOfLines={1}>{sub}</Text>
    </Pressable>
  );
}

// ═══ ٢) التواصل ═══
const PHONE = '0562294460';
const PHONE_INTL = '966562294460';
const EMAIL = 'ko.1416@hotmail.com';
const WAYS: { id: string; label: string; icon: IconName; color: string; url: string }[] = [
  { id: 'wa', label: 'واتساب', icon: 'sms', color: '#25a35a', url: `https://wa.me/${PHONE_INTL}` },
  { id: 'tg', label: 'تليجرام', icon: 'send', color: '#2a9fd8', url: 'https://t.me/hasa_n20' },
  { id: 'call', label: 'اتصال', icon: 'call', color: '#2f6bff', url: `tel:${PHONE}` },
  { id: 'mail', label: 'إيميل', icon: 'mail', color: '#e07a3a', url: `mailto:${EMAIL}?subject=${encodeURIComponent('Bandly')}` },
];
const openWay = (url: string) =>
  Linking.openURL(url).catch(() => Alert.alert('ما قدرنا نفتحه', `تواصل معنا على ${PHONE} أو ${EMAIL}`));

// ═══ ٣) الإعدادات ═══
function Row({ icon, tint, label, value, children, onLabelPress }: {
  icon: IconName; tint: string; label: string; value: string; children: ReactNode; onLabelPress?: () => void;
}) {
  return (
    <View style={s.row}>
      <View style={[s.rowIcon, { backgroundColor: tBg(tint + '22') }]}><Icon name={icon} size={17} color={tint} stroke={2.2} /></View>
      <Pressable style={s.rowTxt} onPress={onLabelPress} disabled={!onLabelPress} accessible={!!onLabelPress}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowValue} numberOfLines={1}>{value}</Text>
      </Pressable>
      {children}
    </View>
  );
}

/** أزرار مجمّعة (segmented) */
function Seg<T extends string>({ items, value, onPick }: {
  items: { id: T; icon?: IconName; text?: string; a11y: string }[]; value: T; onPick: (v: T) => void;
}) {
  return (
    <View style={s.seg}>
      {items.map(it => {
        const on = it.id === value;
        return (
          <Pressable key={it.id} onPress={() => !on && onPick(it.id)} accessibilityLabel={it.a11y} hitSlop={3}
            style={({ pressed }) => [s.segBtn, on && s.segOn, pressed && { opacity: 0.7 }]}>
            {it.icon
              ? <Icon name={it.icon} size={16} color={on ? P.blue : P.sub} stroke={2.2} />
              : <Text style={[s.segTxt, on && { color: P.blue }]}>{it.text}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

const THEMES: { id: ThemePref; icon: IconName; a11y: string }[] = [
  { id: 'light', icon: 'sun', a11y: 'فاتح' },
  { id: 'dark', icon: 'moon', a11y: 'داكن' },
  { id: 'system', icon: 'phone', a11y: 'حسب الجوال' },
];
const LANGS: { id: Lang; text: string; a11y: string }[] = [
  { id: 'ar', text: 'ع', a11y: 'عربي' },
  { id: 'en', text: 'EN', a11y: 'English' },
];

const when = (d: Date | null) => {
  if (!d) return '—';
  return d.toLocaleString(EN_MODE ? 'en-GB' : 'ar-SA', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** زر التشخيص: يرسل آخر ما صار بين التطبيق والراوتر للمطوّر (بدون كلمات سر ولا بيانات شخصية) */
function DiagRow() {
  const [st, setSt] = useState<'' | 'busy' | 'ok' | 'fail'>('');
  const [note, setNote] = useState('');
  const send = async () => {
    setSt('busy');
    setNote('');
    const ok = await sendSupportReport('diag', diagText('تشخيص يدوي من المستخدم'));
    // راوتر يحتاج صفحات بعد الدخول (FiberHome الجديد) ← نسحبها ونرسلها مع التشخيص
    if (ok) {
      try { const n = await sendAfterLoginPages(m => setNote(m)); setNote(n ?? ''); } catch { setNote(''); }
    }
    setSt(ok ? 'ok' : 'fail');
  };
  return (
    <Row icon="report" tint="#8b5cf6" label="أرسل تشخيص للمطوّر"
      value={st === 'busy' && note ? note : st === 'ok' ? `✓ وصل للمطوّر${note ? ` · ${note}` : ''}` : st === 'fail' ? 'ما وصل — تأكد من النت' : 'عندك مشكلة؟ أرسلها بضغطة'}>
      <Pressable style={[s.mini, st === 'busy' && { opacity: 0.5 }]} onPress={send} disabled={st === 'busy' || st === 'ok'}>
        {st === 'busy' ? <ActivityIndicator size="small" color={P.blue} /> : <Text style={s.miniTxt}>{st === 'ok' ? '✓' : 'أرسل'}</Text>}
      </Pressable>
    </Row>
  );
}

function VersionRow() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ready, setReady] = useState(false);
  // ٥ ضغطات على «نسخة التطبيق» خلال ٤ ثواني ← يخفي/يظهر «مساعد Bandly» في صفحة الراوتر (على نفس الجهاز)
  const taps = useRef<number[]>([]);
  const secretTap = async () => {
    const now = Date.now();
    taps.current = [...taps.current.filter(t => now - t < 4000), now];
    if (taps.current.length < 5) return;
    taps.current = [];
    const on = !(await isUnlocked());
    await setUnlocked(on);
    Alert.alert(on ? 'مساعد Bandly ظهر 🧪' : 'مساعد Bandly اختفى', on ? 'تلقاه في صفحة الراوتر تحت «حسّن اتصالك».' : 'رجع مخفي. اضغط ٥ مرات مرة ثانية لو تبيه.');
  };

  if (desktop) {
    return (
      <Row icon="refresh" tint="#12a07a" label="نسخة التطبيق" value={`Windows ${desktop.version ?? ''}`}>
        {desktop.checkUpdate && (
          <Pressable style={s.mini} onPress={() => desktop?.checkUpdate?.()}><Text style={s.miniTxt}>تحقق</Text></Pressable>
        )}
      </Row>
    );
  }
  if (!Updates.isEnabled) return null;

  const version = Updates.isEmbeddedLaunch ? 'النسخة الأصلية' : `تحديث ${when(Updates.createdAt)}`;
  const check = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) setMsg('✓ عندك آخر نسخة');
      else {
        setMsg('نحمّل التحديث...');
        await Updates.fetchUpdateAsync();
        setReady(true); setMsg('✓ التحديث جاهز');
      }
    } catch (e: any) {
      setMsg(`ما قدرنا نتحقق: ${String(e?.message ?? e).slice(0, 80)}`);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Row icon="refresh" tint="#12a07a" label="نسخة التطبيق" value={msg || version} onLabelPress={secretTap}>
        {ready ? (
          <Pressable style={[s.mini, s.miniOn]} onPress={() => Updates.reloadAsync().catch(() => {})}>
            <Text style={[s.miniTxt, { color: '#fff' }]}>أعد التشغيل</Text>
          </Pressable>
        ) : (
          <Pressable style={[s.mini, busy && { opacity: 0.5 }]} onPress={check} disabled={busy}>
            {busy ? <ActivityIndicator size="small" color={P.blue} /> : <Text style={s.miniTxt}>تحقق</Text>}
          </Pressable>
        )}
      </Row>
      {Updates.isEmergencyLaunch && (
        <Text style={s.warn}>⚠️ آخر تحديث ما اشتغل، فرجعنا للنسخة الأصلية. اضغط «تحقق من التحديث»، ولو تكرر بلّغ المطوّر.</Text>
      )}
    </>
  );
}

const APPSTORE_REVIEW = 'https://apps.apple.com/app/id6819877993?action=write-review';

export function HomeFooter({ onExplore }: { onExplore: () => void }) {
  const themeLabel = THEMES.find(t => t.id === THEME_PREF)?.a11y ?? '';
  return (
    <View style={{ gap: 12, marginTop: 4 }}>
      <View style={s.tiles}>
        <Tile title="وضع الفني" sub="عميل عن بُعد" colors={['#22c3e6', '#0b86a1']}
          icon={<Icon name="aim" size={22} color={tFg('#0b86a1')} stroke={2.2} />}
          onPress={() => (desktop?.openTech ? desktop.openTech() : router.push('/tech' as Href))} />
        <Tile title="مو مدعوم؟" sub="نضيف راوترك" colors={['#fdba74', '#ea580c']}
          icon={<Icon name="compass" size={22} color={tFg('#ea580c')} stroke={2.2} />} onPress={onExplore} />
        <Tile title="ادعُ ربعك" sub="شارك الرابط" colors={['#f472b6', '#c0389b']}
          icon={<PeopleIcon c={tFg('#c0389b')} />} onPress={invite} />
      </View>

      {/* تقييم في App Store — رابط صفحة الكتابة مباشرة (مسموح عند Apple، بدون فلترة ولا مكافأة) */}
      {Platform.OS === 'ios' && (
        <Pressable onPress={() => openWay(APPSTORE_REVIEW)}
          style={({ pressed }) => [s.card, s.contact, pressed && s.pressed]}>
          <View style={[s.way, { backgroundColor: '#f5a524' }]}>
            <Text style={{ fontSize: 16 }}>⭐</Text>
          </View>
          <View style={s.rowTxt}>
            <Text style={s.rowLabel}>قيّم Bandly</Text>
            <Text style={s.rowValue}>عجبك التطبيق؟ تقييمك في App Store يساعدنا نوصل لناس أكثر</Text>
          </View>
          <View style={{ transform: [{ scaleX: -1 }] }}><Icon name="chevron" size={16} color={P.faint} /></View>
        </Pressable>
      )}

      <Pressable onPress={() => openWay('https://t.me/BandlyHelp')}
        style={({ pressed }) => [s.card, s.contact, pressed && s.pressed]}>
        <View style={[s.way, { backgroundColor: '#ef4444' }]}>
          <Icon name="settings" size={17} color="#fff" stroke={2.2} />
        </View>
        <View style={s.rowTxt}>
          <Text style={s.rowLabel}>حلول المشاكل</Text>
          <Text style={s.rowValue}>قروب الدعم في تليجرام — اسأل ونساعدك</Text>
        </View>
        <View style={{ transform: [{ scaleX: -1 }] }}><Icon name="chevron" size={16} color={P.faint} /></View>
      </Pressable>

      <View style={[s.card, s.contact]}>
        <View style={s.rowTxt}>
          <Text style={s.rowLabel}>تواصل مع المطوّر</Text>
          <Text style={s.rowValue}>اقتراح أو مشكلة؟</Text>
        </View>
        <View style={s.ways}>
          {WAYS.map(w => (
            <Pressable key={w.id} onPress={() => openWay(w.url)} accessibilityLabel={w.label} hitSlop={3}
              style={({ pressed }) => [s.way, { backgroundColor: w.color }, pressed && s.pressed]}>
              <Icon name={w.icon} size={17} color="#fff" stroke={2.2} />
            </Pressable>
          ))}
        </View>
      </View>

      <View style={s.card}>
        <Row icon="sun" tint="#f59e0b" label="المظهر" value={themeLabel}>
          <Seg items={THEMES} value={THEME_PREF} onPick={t => { setThemePref(t); }} />
        </Row>
        <View style={s.sep} />
        <Row icon="globe" tint="#2f6bff" label="اللغة" value={LANG === 'en' ? 'English' : 'العربية'}>
          <Seg items={LANGS} value={LANG} onPick={l => { setLang(l); }} />
        </Row>
        <View style={s.sep} />
        <DiagRow />
        {(desktop || Updates.isEnabled) && <View style={s.sep} />}
        <VersionRow />
      </View>
    </View>
  );
}

const SOFT = isDark
  ? { borderWidth: 1, borderColor: P.border }
  : { borderWidth: 0, shadowColor: '#1b2b5c', shadowOpacity: 0.09, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 };

const s = sheet({
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  tiles: { flexDirection: 'row-reverse', gap: 10 },
  tile: {
    flex: 1, alignItems: 'center', gap: 4, paddingVertical: 16, paddingHorizontal: 6,
    backgroundColor: P.card, borderRadius: 22, ...SOFT,
  },
  tileIcon: { width: 48, height: 48, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  tileTitle: { color: P.text, fontSize: 13, fontWeight: '800' },
  tileSub: { color: P.sub, fontSize: 10.5, fontWeight: '600' },

  card: { backgroundColor: P.card, borderRadius: 22, ...SOFT, paddingHorizontal: 14, paddingVertical: 4 },
  contact: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 12 },
  ways: { flexDirection: 'row-reverse', gap: 7 },
  way: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 10 },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTxt: { flex: 1, minWidth: 0 },
  rowLabel: { color: P.text, fontSize: 13.5, fontWeight: '800', textAlign: 'right' },
  rowValue: { color: P.sub, fontSize: 11, fontWeight: '600', textAlign: 'right', marginTop: 1 },
  sep: { height: 1, backgroundColor: P.border, opacity: 0.6 },

  seg: { flexDirection: 'row-reverse', backgroundColor: P.soft, borderRadius: 12, padding: 3, gap: 2 },
  segBtn: { minWidth: 36, height: 30, paddingHorizontal: 8, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: P.card, borderWidth: 1, borderColor: tBd('#c7d7fe') },
  segTxt: { color: P.sub, fontSize: 13, fontWeight: '800' },

  mini: { borderWidth: 1.2, borderColor: P.blue, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12, minWidth: 64, alignItems: 'center' },
  miniOn: { backgroundColor: P.blue },
  miniTxt: { color: P.blue, fontSize: 12, fontWeight: '800' },
  warn: { color: P.red, fontSize: 11.5, textAlign: 'right', lineHeight: 17, paddingBottom: 8 },
});
