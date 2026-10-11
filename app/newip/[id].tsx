/**
 * آي بي جديد — يقطع اتصال البيانات في الراوتر ثواني ويرجّعه، فالشركة تعطي جلسة وآي بي جديد.
 * أسرع من إعادة تشغيل الراوتر (١٠–٢٠ ثانية بدل دقيقتين).
 * نعرض الآي بي العام (اللي تشوفه المواقع والألعاب) وآي بي الراوتر الداخلي عند الشركة، قبل وبعد.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { reportError } from '../../src/services/errors';
import { withSession } from '../../src/store/sessions';
import { waitOnline } from '../../src/utils/safeLock';
import { C, R, S, tBg, tBd, tFg } from '../../src/ui/theme';

import { sheet } from '../../src/i18n';
const ACCENT = '#0e7d93';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Ips { pub?: string; wan?: string }

/** الآي بي العام كما تشوفه المواقع — مصدرين، أي واحد يرد يكفي */
async function publicIp(): Promise<string | undefined> {
  const one = async (url: string, parse: (t: string) => string | undefined) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}b=${Date.now()}`, { signal: ctrl.signal });
      return parse(await r.text());
    } catch {
      return undefined;
    } finally {
      clearTimeout(t);
    }
  };
  const a = await one('https://api.ipify.org?format=json', t => { try { return JSON.parse(t).ip; } catch { return undefined; } });
  if (a) return a;
  return one('https://1.1.1.1/cdn-cgi/trace', t => t.match(/^ip=(.+)$/m)?.[1]?.trim());
}

async function readIps(r: SavedRouter): Promise<Ips> {
  const [pub, wan] = await Promise.all([
    publicIp(),
    withSession(r, async d => (d.getDeviceDetails ? (await d.getDeviceDetails()).wanIp : undefined), false).catch(() => undefined),
  ]);
  return { pub, wan: wan || undefined };
}

export default function NewIp() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [supported, setSupported] = useState(true);
  const [before, setBefore] = useState<Ips | null>(null);
  const [after, setAfter] = useState<Ips | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const r = await getRouter(id);
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try {
        const [can, reb] = await withSession(r, async d => [!!d.reconnectData, !!d.reboot] as const, false).catch(() => [false, false] as const);
        if (!mounted.current) return;
        setSupported(can);
        setCanReboot(reb && r.driverId !== 'device');
        setBefore(await readIps(r));
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => { mounted.current = false; };
  }, [id]);

  const [canReboot, setCanReboot] = useState(false);
  const [mode, setMode] = useState<'normal' | 'long' | 'reboot'>('normal');

  const run = (m: 'normal' | 'long' | 'reboot' = 'normal') => {
    if (!info) return;
    const msg = m === 'reboot'
      ? 'بنعيد تشغيل الراوتر — هذي أقوى طريقة لآي بي جديد. النت بينقطع حوالي دقيقتين.'
      : m === 'long'
        ? 'بنقطع النت ٤٠ ثانية تقريباً — الشركة تحتاج وقت أطول عشان تفك الآي بي القديم.'
        : 'بنقطع النت ثواني ونرجّعه عشان الشركة تعطيك آي بي جديد.\n\nأي تحميل أو لعبة شغالة بتنقطع لحظات.';
    setMode(m);
    Alert.alert('آي بي جديد', msg, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'يلا', onPress: async () => {
          setBusy(true); setError(''); setAfter(null);
          try {
            const old = before ?? await readIps(info);
            if (mounted.current) setBefore(old);
            if (m === 'reboot') {
              setStatus('نعيد تشغيل الراوتر...');
              await withSession(info, d => d.reboot!(), false);
              await sleep(30000);
            } else {
              setStatus(m === 'long' ? 'نقطع الاتصال ~٤٠ ثانية...' : 'نقطع الاتصال ونرجّعه...');
              await withSession(info, d => d.reconnectData!({ holdSecs: m === 'long' ? 35 : 10 }), false);
              await sleep(3000);
            }
            setStatus('ننتظر الراوتر يتصل...');
            const ok = await waitOnline(info, m === 'reboot' ? 150000 : 60000, () => !mounted.current);
            if (!ok) throw new Error('الراوتر ما رجع يتصل خلال دقيقة — انتظر شوي أو أعد تشغيله');
            setStatus('نقرأ الآي بي الجديد...');
            // أول ثواني بعد الاتصال ممكن ما يكون فيه نت — نحاول كم مرة
            let fresh: Ips = {};
            for (let i = 0; i < 4 && mounted.current; i++) {
              await sleep(2500);
              fresh = await readIps(info);
              if (fresh.pub) break;
            }
            if (mounted.current) setAfter(fresh);
          } catch (e: any) {
            if (mounted.current) setError(e?.message ?? String(e));
      reportError('newip', e, info);
          } finally {
            if (mounted.current) { setBusy(false); setStatus(''); }
          }
        },
      },
    ]);
  };

  const pubChanged = !!before?.pub && !!after?.pub && before.pub !== after.pub;
  const wanChanged = !!before?.wan && !!after?.wan && before.wan !== after.wan;

  const IpRow = ({ label, oldV, newV, changed }: { label: string; oldV?: string; newV?: string; changed: boolean }) => (
    <View style={s.ipRow}>
      <Text style={s.ipLbl}>{label}</Text>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Text style={[s.ip, after && s.ipOld]}>{oldV ?? '—'}</Text>
        {after && (
          <>
            <Text style={s.arrow}>←</Text>
            <Text style={[s.ip, { color: changed ? tFg('#0f7a52') : C.text }]}>{newV ?? '—'}</Text>
          </>
        )}
      </View>
    </View>
  );

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        <View style={s.card}>
          <Text style={s.title}>🔄 آي بي جديد</Text>
          <Text style={s.body}>
            نقطع اتصال البيانات في الراوتر ثواني ونرجّعه، فتعطيك الشركة آي بي جديد — أسرع من إعادة تشغيل الراوتر.
            يفيد لو لعبة أو موقع حاط عليك حظر مؤقت، أو النت علق على مسار بطيء.
          </Text>

          {loading ? <ActivityIndicator color={ACCENT} /> : (
            <View style={s.ipBox}>
              <IpRow label="الآي بي العام" oldV={before?.pub} newV={after?.pub} changed={pubChanged} />
              <IpRow label="آي بي الراوتر عند الشركة" oldV={before?.wan} newV={after?.wan} changed={wanChanged} />
            </View>
          )}

          {!loading && !supported && (
            <Text style={s.warn}>راوترك ما يسمح بقطع البيانات من التطبيق — أعد تشغيله يدوي عشان تاخذ آي بي جديد.</Text>
          )}

          {!loading && supported && (
            <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={() => run('normal')} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{after ? '🔄 جرّب مرة ثانية' : '🔄 خذ آي بي جديد'}</Text>}
            </Pressable>
          )}
          {!!status && <Text style={s.statusText}>{status}</Text>}
          {!!error && <Text style={s.err}>{error}</Text>}
        </View>

        {after && (
          <View style={[s.card, { borderColor: pubChanged || wanChanged ? tBd('#7fd4b8') : tBd('#f5cf8a') }]}>
            {pubChanged ? (
              <Text style={[s.verdict, { color: tFg('#0f7a52') }]}>✓ صار عندك آي بي جديد</Text>
            ) : wanChanged ? (
              <>
                <Text style={[s.verdict, { color: tFg('#0f7a52') }]}>✓ الراوتر أخذ جلسة جديدة</Text>
                <Text style={s.note}>
                  الآي بي العام بقى نفسه لأن الشركة تشارك الآي بي العام بين مشتركين كثير. هذا طبيعي، وجرّب مرة ثانية بعد دقيقة لو تحتاج آي بي عام مختلف.
                </Text>
              </>
            ) : (
              <>
                <Text style={[s.verdict, { color: tFg('#a15c00') }]}>الشركة رجّعت نفس الآي بي</Text>
                <Text style={s.note}>
                  {mode === 'reboot'
                    ? 'حتى بعد إعادة التشغيل — الشركة مثبّتة نفس الآي بي لشريحتك حالياً. جرّب بعد ساعة.'
                    : 'الشركة تحفظ آي بي الشريحة فترة قصيرة بعد الانقطاع. جرّب انقطاع أطول، ولو ما نفع أعد تشغيل الراوتر.'}
                </Text>
                {mode !== 'reboot' && (
                  <View style={{ gap: 8, marginTop: 4 }}>
                    {mode === 'normal' && (
                      <Pressable style={[s.btn2, busy && { opacity: 0.6 }]} onPress={() => run('long')} disabled={busy}>
                        <Text style={s.btn2Text}>⏱ جرّب بانقطاع أطول (٤٠ ثانية)</Text>
                      </Pressable>
                    )}
                    {canReboot && (
                      <Pressable style={[s.btn2, busy && { opacity: 0.6 }]} onPress={() => run('reboot')} disabled={busy}>
                        <Text style={s.btn2Text}>⏻ أعد تشغيل الراوتر (أقوى طريقة)</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        <Text style={s.foot}>
          الآي بي العام نقرأه من جوالك — لو جوالك مو متصل بواي فاي الراوتر، بيطلع آي بي شريحة الجوال بداله.
        </Text>
      </ScrollView>
    </LinearGradient>
  );
}

const s = sheet({
  page: { padding: S.lg, gap: S.md },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: R.lg, padding: S.lg, gap: S.sm },
  title: { color: C.text, fontWeight: '800', fontSize: 17, textAlign: 'right' },
  body: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  ipBox: { backgroundColor: tBg('#f1f6fb'), borderColor: tBd('#d4e2f0'), borderWidth: 1.5, borderRadius: 14, padding: 12, gap: 10 },
  ipRow: { gap: 3 },
  ipLbl: { color: C.muted, fontSize: 11.5, fontWeight: '700', textAlign: 'right' },
  ip: { color: C.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  ipOld: { color: C.muted, textDecorationLine: 'line-through', fontWeight: '600', fontSize: 13 },
  arrow: { color: C.muted, fontSize: 14, fontWeight: '800' },
  warn: { color: tFg('#b45309'), fontSize: 12.5, textAlign: 'right', fontWeight: '700', lineHeight: 19 },
  btn: { backgroundColor: ACCENT, borderRadius: R.md, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  btn2: { borderColor: ACCENT, borderWidth: 1.5, borderRadius: R.md, paddingVertical: 11, alignItems: 'center' },
  btn2Text: { color: tFg(ACCENT), fontWeight: '800', fontSize: 13.5 },
  statusText: { color: ACCENT, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  err: { color: C.red, fontSize: 12.5, textAlign: 'right', lineHeight: 19 },
  verdict: { fontWeight: '800', fontSize: 15, textAlign: 'right', lineHeight: 23 },
  note: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  foot: { color: C.muted, fontSize: 11.5, textAlign: 'center', lineHeight: 18, paddingHorizontal: 8 },
});
