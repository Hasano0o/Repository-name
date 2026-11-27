/**
 * الشريحة الإلكترونية — شاشة تجريبية (٢٧ نوفمبر، قرار حسن: «الاثنين مع بعض»).
 * تطلع للراوترات اللي الفحص لقى فيها eSIM (هواوي H155 / M5001 …):
 *   ١. الشرائح اللي في الراوتر (قراءة esim-profiles)
 *   ٢. صوّر باركود الشريحة الجديدة ← نطلع الكود (LPA:1$…) وننسخه/نشاركه
 *   ٣. «افتح صفحة الشريحة في راوترك» ← التحميل نفسه يصير من صفحة هواوي (صيغة down-profile ما شفناها من راوتر حقيقي —
 *      ما نرسل أمر تحميل بالتخمين، نفس قاعدة U30).
 * كل خطوة تنحسب (community/esim) + أول فتح يرسل ردود القراءة للرسيفر (تقرير esim-open) عشان نبني التحميل من التطبيق.
 */
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Share, StyleSheet } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { esimEvent } from '../../src/services/community';
import { sendSupportReport } from '../../src/services/errors';
import { maskLongDigits } from '../../src/utils/esimMask';
import { parseEsimProfiles, parseLpa, type EsimProfile } from '../../src/utils/esimParse';
import { C, tBg, tFg } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import { sheet } from '../../src/i18n';

const reportKey = (id: string) => `bandly.esimOpenReport.${id}`;

export default function EsimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [model, setModel] = useState<string | undefined>();
  const [profiles, setProfiles] = useState<EsimProfile[] | null>(null);
  const [err, setErr] = useState('');
  const [scan, setScan] = useState(false);
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [perm, requestPerm] = useCameraPermissions();
  const lock = useRef(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive || !r) { if (alive) setErr('الراوتر غير موجود'); return; }
      setInfo(r);
      try {
        const res = await withSession(r, async d => {
          const raw = d.getEsimRaw ? await d.getEsimRaw() : null;
          const m = await d.getDeviceDetails?.().then(x => x.model).catch(() => undefined);
          return { raw, m };
        }, false);
        if (!alive) return;
        setModel(res.m);
        setProfiles(parseEsimProfiles(res.raw?.raw['sim/esim-profiles'] ?? ''));
        esimEvent('open', { model: res.m, brand: r.driverId, esim: res.raw?.enabled ? 'yes' : 'unknown' }).catch(() => {});
        // أول فتح: ردود القراءة للرسيفر (الأرقام الطويلة مخفية) — منها نبني التحميل من التطبيق
        if (res.raw && !(await AsyncStorage.getItem(reportKey(r.id)).catch(() => null))) {
          const text = [`model: ${res.m ?? ''}`, ...Object.entries(res.raw.raw).map(([p, t]) => `── ${p}\n${p.startsWith('page:') ? t : maskLongDigits(t)}`)].join('\n');
          if (await sendSupportReport('esim-open', text, r)) await AsyncStorage.setItem(reportKey(r.id), '1').catch(() => {});
        }
      } catch (e: any) {
        if (alive) { setErr(e?.message ?? 'ما قدرنا نقرأ الراوتر'); setProfiles([]); }
      }
    })();
    return () => { alive = false; };
  }, [id]));

  const startScan = async () => {
    setNote('');
    if (!perm?.granted) {
      const p = await requestPerm();
      if (!p.granted) { setNote('نحتاج إذن الكاميرا عشان نقرأ الباركود'); return; }
    }
    lock.current = false;
    setScan(true);
  };
  const onQr = ({ data }: { data: string }) => {
    if (lock.current) return;
    if (!parseLpa(data)) { setNote('هذا مو باركود شريحة — باركود الشريحة يبدأ بـ LPA:1$'); return; }
    lock.current = true;
    setScan(false);
    setCode(data.trim());
    setNote('');
    if (info) esimEvent('scan', { model, brand: info.driverId, esim: 'yes' }).catch(() => {});
  };
  const share = () => { Share.share({ message: code }).catch(() => {}); };
  const openPage = () => {
    if (!info) return;
    esimEvent('page', { model, brand: info.driverId, esim: 'yes' }).catch(() => {});
    const host = /^https?:\/\//.test(info.host) ? info.host.replace(/\/+$/, '') : `http://${info.host}`;
    // واجهة هواوي Vue (hash): صفحة «إدارة eSIM» اسمها esimmanagement — لو ما فتحت، تطلع الرئيسية ويدخلها من القائمة
    Linking.openURL(`${host}/html/index.html#/esimmanagement`).catch(() => Linking.openURL(host).catch(() => {}));
  };

  if (!info && !err) return <View style={s.center}><ActivityIndicator color={C.text} /></View>;
  const lpa = code ? parseLpa(code) : null;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      <View style={s.beta}><Text style={s.betaTxt}>تجريبي — نجهّز التحميل من التطبيق نفسه</Text></View>
      {!!err && <Text style={s.err}>{err}</Text>}

      <GlassCard title="الشرائح اللي في راوترك" icon="📶" collapsible={false}>
        {profiles === null ? <ActivityIndicator color={C.text} /> : profiles.length === 0 ? (
          <Text style={s.hint}>ما لقينا شرائح إلكترونية محمّلة في الراوتر.</Text>
        ) : profiles.map((p, i) => (
          <View key={i} style={s.prof}>
            <Text style={s.profName} numberOfLines={1}>{p.name}</Text>
            {p.active !== undefined && (
              <Text style={[s.profState, { color: p.active ? tFg('#16a34a') : C.sub }]}>{p.active ? 'شغالة' : 'موقفة'}</Text>
            )}
          </View>
        ))}
      </GlassCard>

      <GlassCard title="أضف شريحة جديدة" icon="➕" collapsible={false}>
        <Text style={s.p}>١. صوّر باركود الشريحة اللي عطتك إياه الشركة.</Text>
        {scan ? (
          <View style={s.camBox}>
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onQr} />
            <Pressable style={s.camClose} onPress={() => setScan(false)}><Text style={s.camCloseTxt}>إلغاء</Text></Pressable>
          </View>
        ) : (
          <Pressable style={s.btn} onPress={startScan}><Text style={s.btnTxt}>📷 صوّر الباركود</Text></Pressable>
        )}
        {!!lpa && (
          <View style={s.codeBox}>
            <Text style={s.codeLbl}>{`الشركة: ${lpa.smdp}`}</Text>
            <Text style={s.code} selectable numberOfLines={2}>{code}</Text>
            <Pressable style={[s.btn, s.btnGhost]} onPress={share}><Text style={[s.btnTxt, { color: C.text }]}>انسخ / شارك الكود</Text></Pressable>
          </View>
        )}
        <Text style={s.p}>٢. افتح صفحة الشريحة في راوترك، وادخل، واختر «إضافة» وحط الكود.</Text>
        <Pressable style={s.btn} onPress={openPage}><Text style={s.btnTxt}>افتح صفحة الشريحة في راوترك</Text></Pressable>
        {!!note && <Text style={s.err}>{note}</Text>}
        <Text style={s.hint}>التحميل يصير من صفحة الراوتر نفسه — أضمن لشريحتك. قريب يصير من التطبيق مباشرة.</Text>
      </GlassCard>
    </ScrollView>
  );
}

const s = sheet({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  beta: { alignSelf: 'flex-end', backgroundColor: tBg('#4f46e5'), borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  betaTxt: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  p: { color: C.text, fontSize: 14, lineHeight: 22, textAlign: 'right', marginTop: 6 },
  hint: { color: C.sub, fontSize: 12.5, lineHeight: 19, textAlign: 'right', marginTop: 8 },
  err: { color: tFg('#dc2626'), fontSize: 13, textAlign: 'right', marginTop: 6 },
  prof: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.cardBorder },
  profName: { color: C.text, fontSize: 14, fontWeight: '800', flexShrink: 1 },
  profState: { fontSize: 12.5, fontWeight: '800' },
  btn: { backgroundColor: tBg('#4f46e5'), borderRadius: 14, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  btnGhost: { backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder },
  btnTxt: { color: '#fff', fontSize: 14, fontWeight: '900' },
  camBox: { height: 260, borderRadius: 16, overflow: 'hidden', marginTop: 10, backgroundColor: '#000' },
  camClose: { position: 'absolute', bottom: 10, alignSelf: 'center', backgroundColor: '#000a', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6 },
  camCloseTxt: { color: '#fff', fontWeight: '800' },
  codeBox: { marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder },
  codeLbl: { color: C.sub, fontSize: 12, textAlign: 'right' },
  code: { color: C.text, fontSize: 12.5, marginTop: 4, textAlign: 'left' },
});
