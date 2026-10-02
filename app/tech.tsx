import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert, Share, Vibration, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  LiveViewer, LiveReading, LiveReport, CmdAction, CMD_LABEL, SAY_ORDER,
  liveConfig, checkTechKey, reportText, SpeedPair, techSessions, TechSession,
} from '../src/services/live';
import { RemoteVideo } from '../src/ui/VideoUI';
import { ShareCardModal, ShareData } from '../src/ui/ShareCard';
import { fmtMbps } from '../src/utils/speedLive';
import { rsrpLevel, sinrLevel, Level } from '../src/utils/signal';
import { Icon } from '../src/ui/Icon';
import { SignalChart } from '../src/ui/SignalChart';
import { NetPanel } from '../src/ui/NetPanel';
import { PushToTalk, playVoice, VoiceNote } from '../src/ui/Voice';
import { CallController, CallInfo } from '../src/services/call';
import { CallButton, IncomingCall, CallBar, CallEnded } from '../src/ui/CallUI';
import { Signal } from '../src/drivers/types';
import {
  P, shadow, Hero, Section, MeterTile, InfoCell, Grid, Cell, PrimaryBtn, RANGE, ratioOf, lvlColor, lvlLabel,
} from '../src/ui/Pro';

import { tBd, tBg, tFg } from '../src/ui/theme';
const K_KEY = 'bandly_tech_key';
const K_NAME = 'bandly_tech_name';

type Log = { at: number; text: string; tone: 'ok' | 'err' | 'info' };

export default function TechScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState(typeof params.code === 'string' ? params.code : '');
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [needKey, setNeedKey] = useState(false);
  const [joining, setJoining] = useState(false);
  const [phase, setPhase] = useState<'join' | 'live'>('join');
  const [err, setErr] = useState('');

  const [label, setLabel] = useState('');
  const [conn, setConn] = useState<'on' | 'off'>('off');
  const [customer, setCustomer] = useState(false);
  const [hist, setHist] = useState<LiveReading[]>([]);
  const [say, setSay] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<Log[]>([]);
  const [report, setReport] = useState<{ why: string; r: LiveReport } | null>(null);
  const viewer = useRef<LiveViewer | null>(null);
  const [callInfo, setCallInfo] = useState<CallInfo>({ state: 'idle', peer: '', muted: false, speaker: true });
  const callRef = useRef<CallController | null>(null);
  const endCall = () => { callRef.current?.dispose(); callRef.current = null; };
  const [lastVoice, setLastVoice] = useState<{ url: string; from: string; dur: number } | null>(null);
  const gotHello = useRef(false);
  const [speed, setSpeed] = useState<SpeedPair>({});
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [past, setPast] = useState<{ sessions: TechSession[]; rating?: number; rating_n?: number } | null>(null);
  const [pastOpen, setPastOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [k, n, cfg] = await Promise.all([
        AsyncStorage.getItem(K_KEY), AsyncStorage.getItem(K_NAME), liveConfig(),
      ]);
      if (k) { setKey(k); techSessions(k).then(p => { if (p.sessions.length || p.rating_n) setPast(p); }); }
      if (n) setName(n);
      setNeedKey(!!cfg.require_tech_key);
    })();
  }, []);

  useFocusEffect(useCallback(() => () => { callRef.current?.dispose(); callRef.current = null; viewer.current?.close(); viewer.current = null; }, []));

  const addLog = (text: string, tone: Log['tone'] = 'info') =>
    setLogs(l => [{ at: Date.now(), text, tone }, ...l].slice(0, 30));

  const join = async () => {
    const c = code.replace(/\D/g, '');
    if (c.length !== 6) { setErr('الكود ٦ أرقام'); return; }
    setErr('');
    setJoining(true);
    try {
      if (needKey) {
        const chk = await checkTechKey(key.trim());
        if (!chk.ok) { setErr('مفتاح الفني غير صالح أو منتهي — تواصل معنا للاشتراك'); return; }
        if (!name.trim() && chk.name) setName(chk.name);
      }
      await AsyncStorage.multiSet([[K_KEY, key.trim()], [K_NAME, name.trim()]]);
      setHist([]); setLogs([]); setReport(null); setCustomer(false); setSpeed({});
      endCall();
      viewer.current?.close();
      gotHello.current = false;
      const v = new LiveViewer(c, key.trim(), name.trim(), {
        onState: (s, cc) => {
          setConn(s === 'on' ? 'on' : 'off');
          if (s === 'dead') {
            if (cc === 4404) { setErr('الكود غلط أو الجلسة انتهت'); if (!gotHello.current) setPhase('join'); }
            if (cc === 4401) { setErr('مفتاح الفني غير صالح أو منتهي'); setPhase('join'); }
            if (cc === 4429) { setErr('محاولات كثيرة، جرّب بعد شوي'); setPhase('join'); }
          }
        },
        onHello: m => {
          gotHello.current = true;
          setPhase('live');
          setLabel(m.label || 'راوتر العميل');
          setSay(m.say || {});
          setHist(m.history || []);
          setCustomer(m.customer);
          setSpeed(m.speed || {});
          if (m.ended && m.report) setReport({ why: 'ended', r: m.report });
        },
        onSpeed: sp => { setSpeed(sp); addLog('العميل قاس السرعة 🚀', 'ok'); Vibration.vibrate(30); },
        onReading: r => { setHist(h => [...h, r].slice(-60)); setCustomer(true); },
        onCustomer: on => { setCustomer(on); addLog(on ? 'العميل رجع للتطبيق' : 'العميل طلع من التطبيق', on ? 'ok' : 'err'); },
        onCmdSent: (a, delivered) => addLog(`أرسلنا «${CMD_LABEL[a]}» — بانتظار موافقة العميل${delivered ? '' : ' (العميل مو متصل)'}`),
        onCmdResult: (ok, msg) => { addLog(msg, ok ? 'ok' : 'err'); Vibration.vibrate(); },
        onRtc: m => callRef.current?.handle(m),
        onVoice: v => {
          if (v.echo) return;
          setLastVoice({ url: v.url, from: v.from, dur: v.dur });
          playVoice(v.url);
          Vibration.vibrate(40);
        },
        onEnd: (why, r) => {
          endCall(); if (r) setReport({ why, r }); setConn('off');
          if (key.trim()) setTimeout(() => techSessions(key.trim()).then(p => setPast(p)), 1500);
        },
      });
      viewer.current = v;
      callRef.current = new CallController({
        role: 'tech', peerLabel: 'العميل',
        send: (kind, data) => v.rtc(kind, data),
        getIce: () => v.iceServers(),
        onChange: setCallInfo,
      });
    } finally {
      setJoining(false);
    }
  };

  const leave = () => {
    endCall();
    viewer.current?.close();
    viewer.current = null;
    setPhase('join');
  };

  const askCam = () => {
    if (callInfo.peerCam) return;
    callRef.current?.requestCam();
    addLog('طلبنا من العميل يشغّل الكاميرا — بانتظار موافقته');
    Vibration.vibrate(20);
  };
  const reportImage = (rp: LiveReport) => setShareData({
    router: label || 'راوتر العميل',
    before: rp.first?.rsrp, after: rp.last?.rsrp, best: rp.best?.rsrp,
    sinrBefore: rp.first?.sinr, sinrAfter: rp.last?.sinr,
    tower: rp.last?.band ? `${rp.last.band}${rp.last.pci ? ` · PCI ${rp.last.pci}` : ''}` : undefined,
    speed: rp.speed && (rp.speed.before || rp.speed.after) ? rp.speed : speed,
    tech: name.trim() || undefined, minutes: Math.max(1, Math.round(rp.duration_sec / 60)),
  });

  const sendSay = (k: string) => { viewer.current?.say(k); Vibration.vibrate(20); };
  const sendCmd = (a: CmdAction) => {
    Alert.alert('إرسال طلب للعميل', `${CMD_LABEL[a]}\nيتنفذ بعد موافقة العميل من جواله.`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'أرسل', onPress: () => viewer.current?.cmd(a) },
    ]);
  };

  // ═══ شاشة الدخول ═══
  if (phase === 'join') {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: P.bg }} contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 30 }]}
        keyboardShouldPersistTaps="handled">
        <Hero>
          <Text style={s.kicker}>Bandly</Text>
          <Text style={s.heroTitle}>وضع الفني</Text>
          <Text style={s.heroSub}>شوف إشارة راوتر العميل حيّة ووجّهه وأنت في مكانك</Text>
        </Hero>
        <Section title="كود العميل" sub="العميل يضغط «شارك مع فني» في مساعد التوجيه ويعطيك الكود" icon="aim">
          <TextInput value={code} onChangeText={t => setCode(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad" maxLength={6} placeholder="••••••" placeholderTextColor={P.faint}
            style={s.codeIn} />
          <TextInput value={name} onChangeText={setName} placeholder="اسمك (يظهر للعميل)" placeholderTextColor={P.faint}
            style={s.in} />
          {needKey && (
            <TextInput value={key} onChangeText={setKey} placeholder="مفتاح الفني (من اشتراكك)" placeholderTextColor={P.faint}
              autoCapitalize="characters" style={s.in} />
          )}
          {!!err && <Text style={s.err}>{err}</Text>}
          <PrimaryBtn text="ابدأ المتابعة" icon="login" onPress={join} busy={joining} style={{ marginTop: 12 }} />
        </Section>
        <View style={s.howCard}>
          <Text style={s.howTitle}>كيف تشتغل؟</Text>
          {['العميل يفتح Bandly ← مساعد التوجيه ← «شارك مع فني»',
            'يرسل لك الكود أو الرابط بالواتساب',
            'تشوف قراءته حيّة وتكلّمه صوت وصورة 📹 — تلمس الفيديو فيطلع له مؤشر',
            'تقدر تطلب تثبيت البرج — يتنفذ بعد موافقته'].map((t, i) => (
            <View key={i} style={s.howRow}>
              <View style={s.howNum}><Text style={s.howNumTxt}>{i + 1}</Text></View>
              <Text style={s.howTxt}>{t}</Text>
            </View>
          ))}
        </View>
        {!!past && (
          <Section title="جلساتي السابقة" icon="clock" tone={P.green} toneSoft={P.greenSoft}
            sub={past.rating_n ? `تقييمك ⭐ ${past.rating} من ٥ (${past.rating_n} تقييم)` : 'تقييمات العملاء تطلع هنا'}
            right={past.sessions.length > 3 ? (
              <Pressable onPress={() => setPastOpen(o => !o)} hitSlop={8}><Text style={s.more}>{pastOpen ? 'أقل' : 'الكل'}</Text></Pressable>
            ) : undefined}>
            {past.sessions.length === 0 && <Text style={s.log}>ما فيه جلسات للحين</Text>}
            {past.sessions.slice(0, pastOpen ? 50 : 3).map(x => (
              <View key={`${x.code}-${x.at}`} style={s.pastRow}>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={s.pastTitle} numberOfLines={1}>{x.label || 'راوتر'}{x.stars ? `  ${'★'.repeat(x.stars)}` : ''}</Text>
                  <Text style={s.pastSub}>
                    {new Date(x.at * 1000).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' })} · {Math.max(1, Math.round(x.dur / 60))} د
                    {x.speed?.before && x.speed?.after ? ` · ${'\u2066'}${fmtMbps(x.speed.before.down)}→${fmtMbps(x.speed.after.down)} Mbps${'\u2069'}` : ''}
                  </Text>
                </View>
                <Text style={[s.pastGain, { color: (x.gain ?? 0) > 0 ? P.green : (x.gain ?? 0) < 0 ? P.red : P.sub }]}>
                  {x.gain == null ? '—' : `${'\u2066'}${x.gain > 0 ? '+' : ''}${x.gain} dB${'\u2069'}`}
                </Text>
              </View>
            ))}
          </Section>
        )}
      </ScrollView>
    );
  }

  // ═══ الجلسة الحيّة ═══
  const r = hist[hist.length - 1];
  const withR = hist.filter(x => x.rsrp !== undefined && x.rsrp !== null);
  const first = withR[0];
  const best = withR.reduce<LiveReading | undefined>((b, x) => (!b || (x.rsrp as number) > (b.rsrp as number) ? x : b), undefined);
  const lr: Level = rsrpLevel(r?.rsrp);
  const gap = best && r?.rsrp != null ? Math.round((best.rsrp as number) - r.rsrp) : undefined;
  const d = (v?: number, base?: number) => (v == null || base == null ? '' : Math.round(v - base) > 0 ? `↑ +${Math.round(v - base)}` : Math.round(v - base) < 0 ? `↓ ${Math.round(v - base)}` : '• 0');

  return (
    <View style={{ flex: 1, backgroundColor: P.bg }}>
      <CallBar info={callInfo} onHangup={() => callRef.current?.hangup()}
        onMute={() => callRef.current?.toggleMute()} onSpeaker={() => callRef.current?.toggleSpeaker()}
        onCam={askCam} camOn={!!callInfo.peerCam} />
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 30 }]}>
        <Hero>
          <View style={s.heroRow}>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={s.kicker}>جلسة {code}</Text>
              <Text style={s.heroTitle} numberOfLines={1}>{label}</Text>
            </View>
            <View style={s.tag}>
              <View style={[s.dot, { backgroundColor: report ? tBg('#ff5a5f') : conn === 'on' && customer ? tBg('#16c784') : tBg('#ffb020') }]} />
              <Text style={s.tagTxt}>{report ? 'انتهت' : conn !== 'on' ? 'نتصل…' : customer ? 'العميل متصل' : 'بانتظار العميل'}</Text>
            </View>
          </View>
        </Hero>

        <RemoteVideo info={callInfo} onPoint={(x, y) => callRef.current?.point(x, y)} onFlip={() => callRef.current?.requestFlip()} />

        {!r && !report && (
          <View style={s.waitCard}>
            <ActivityIndicator color={P.blue} />
            <Text style={s.waitTxt}>بانتظار أول قراءة من جوال العميل…</Text>
          </View>
        )}

        {!!r && (
          <>
            <View style={s.card}>
              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={s.cardTitle}>أفضل نقطة</Text>
                <Text style={[s.cardTitle, { color: P.green }]}>{best ? `${best.rsrp} dBm${best.pci ? ` · PCI ${best.pci}` : ''}` : '—'}</Text>
              </View>
              <Text style={[s.bestGap, { textAlign: 'right', color: gap === undefined ? P.sub : gap <= 1 ? P.green : gap >= 5 ? P.red : P.amber }]}>
                {gap === undefined ? 'نجمع القراءات…' : gap <= 1 ? 'العميل على أفضل نقطة ✓' : `العميل أقل من أفضل نقطة بـ ${gap} dB`}
              </Text>
            </View>
            {!!r.pinned && <Text style={s.pinned}>الراوتر مثبّت على {r.pinned}</Text>}
            {!!r.sig && <NetPanel signal={r.sig as Signal} ping={r.ping} />}
            <View style={s.card}>
              <Text style={s.cardTitle}>تاريخ الإشارة</Text>
              <SignalChart values={withR.map(x => x.rsrp as number)} color={lvlColor(lr)} />
              <View style={s.chartLbls}><Text style={s.chartLbl}>قبل دقيقتين</Text><Text style={s.chartLbl}>الآن</Text></View>
            </View>
          </>
        )}

        {(speed.before || speed.after) && (
          <View style={s.card}>
            <Text style={s.cardTitle}>سرعة العميل 🚀</Text>
            <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
              {(['before', 'after'] as const).map(k => {
                const x = speed[k];
                const pct = k === 'after' && x && speed.before && speed.before.down > 0 ? Math.round(((x.down - speed.before.down) / speed.before.down) * 100) : undefined;
                return (
                  <View key={k} style={s.spBox}>
                    <Text style={s.spLbl}>{k === 'before' ? 'قبل' : 'بعد'}</Text>
                    <Text style={s.spVal}>{x ? fmtMbps(x.down) : '—'}<Text style={s.spUnit}> Mbps</Text></Text>
                    <Text style={s.spSub}>{x ? `${'\u2066'}⬆ ${fmtMbps(x.up)} · ${x.ping} ms${'\u2069'}` : 'بانتظار العميل'}</Text>
                    {pct !== undefined && <Text style={[s.spPct, { color: pct >= 0 ? P.green : P.red }]}>{`${'\u2066'}${pct > 0 ? '+' : ''}${pct}%${'\u2069'}`}</Text>}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {!report && (
          <>
            <Section title="وجّه العميل" sub="تطلع رسالة كبيرة على جواله مع اهتزاز" icon="aim">
              <CallButton label="اتصل بالعميل" disabled={!customer || callInfo.state !== 'idle'}
                onPress={() => callRef.current?.call()}
                hint={customer ? 'مكالمة صوتية حيّة وأنت تشوف قراءته' : 'الزر يتفعّل أول ما يكون العميل متصل'} />
              <CallEnded info={callInfo} />
              {callInfo.state === 'active' && !callInfo.peerCam && (
                <Pressable onPress={askCam} style={s.camAsk}>
                  <Icon name="video" size={17} color={P.blue} stroke={2.2} />
                  <Text style={s.camAskTxt}>اطلب من العميل يشغّل الكاميرا</Text>
                </Pressable>
              )}
              <PushToTalk label="أو أرسل رسالة صوتية (اضغط مطوّل)" disabled={!customer}
                onSend={(uri, dur) => viewer.current ? viewer.current.voice(uri, dur) : Promise.resolve()} />
              {!!lastVoice && <VoiceNote from={lastVoice.from} dur={lastVoice.dur} onReplay={() => playVoice(lastVoice.url)} />}
              <View style={s.sayGrid}>
                {SAY_ORDER.filter(k => say[k]).map(k => (
                  <Pressable key={k} onPress={() => sendSay(k)}
                    style={({ pressed }) => [s.sayBtn, k === 'stop' && s.sayStop, pressed && { opacity: 0.6 }]}>
                    <Text style={[s.sayTxt, k === 'stop' && { color: tFg('#0b7a47'), fontSize: 16 }]}>{say[k]}</Text>
                  </Pressable>
                ))}
              </View>
            </Section>

            <Section title="أوامر الراوتر" sub="ما تتنفذ إلا بعد موافقة العميل" icon="tower" tone={P.violet} toneSoft={P.violetSoft}>
              <View style={s.sayGrid}>
                <Pressable style={[s.sayBtn, s.cmdBtn]} onPress={() => sendCmd('lock_current')}>
                  <Text style={[s.sayTxt, { color: P.violet }]}>{CMD_LABEL.lock_current}</Text>
                </Pressable>
                <Pressable style={[s.sayBtn, s.cmdBtn]} onPress={() => sendCmd('lock_best')}>
                  <Text style={[s.sayTxt, { color: P.violet }]}>{CMD_LABEL.lock_best}</Text>
                </Pressable>
                <Pressable style={[s.sayBtn, s.unlockBtn]} onPress={() => sendCmd('unlock')}>
                  <Text style={[s.sayTxt, { color: P.red }]}>{CMD_LABEL.unlock}</Text>
                </Pressable>
              </View>
              {logs.length > 0 && (
                <View style={{ marginTop: 12, gap: 6 }}>
                  {logs.slice(0, 6).map(l => (
                    <Text key={l.at + l.text} style={[s.log, l.tone === 'ok' && { color: P.green }, l.tone === 'err' && { color: P.red }]}>
                      {l.tone === 'ok' ? '✓ ' : l.tone === 'err' ? '✗ ' : '• '}{l.text}
                    </Text>
                  ))}
                </View>
              )}
            </Section>
          </>
        )}

        {!!report && (
          <Section title="تقرير الجلسة" sub={report.why === 'customer' ? 'العميل أنهى الجلسة' : 'انتهت الجلسة'}
            icon="report" tone={P.green} toneSoft={P.greenSoft}>
            <Text style={[s.gain, { color: (report.r.gain_db ?? 0) > 0 ? P.green : (report.r.gain_db ?? 0) < 0 ? P.red : P.sub }]}>
              {report.r.gain_db == null ? '—' : `${report.r.gain_db > 0 ? '+' : ''}${report.r.gain_db} dB`}
            </Text>
            <Text style={s.gainLbl}>التحسن في قوة الإشارة</Text>
            {[
              ['القراءة في البداية', report.r.first], ['أفضل قراءة', report.r.best], ['القراءة النهائية', report.r.last],
            ].map(([l, x]: any) => (
              <View key={l} style={s.repRow}>
                <Text style={s.repVal}>{x ? `${x.rsrp} dBm${x.band ? ` · ${x.band}` : ''}` : '—'}</Text>
                <Text style={s.repLbl}>{l}</Text>
              </View>
            ))}
            <PrimaryBtn text="أرسل التقرير كصورة" icon="share" style={{ marginTop: 14 }}
              colors={[tBg('#12b76a'), tBg('#0ea5a0')]} onPress={() => reportImage(report.r)} />
            <Pressable style={s.leave} onPress={() => Share.share({ message: reportText(report.r, name.trim() || undefined) }).catch(() => {})}>
              <Text style={s.leaveTxt}>أو أرسله كنص</Text>
            </Pressable>
          </Section>
        )}

        <Pressable onPress={leave} style={s.leave}>
          <Icon name="refresh" size={15} color={P.sub} />
          <Text style={s.leaveTxt}>جلسة جديدة / كود ثاني</Text>
        </Pressable>
      </ScrollView>
      <IncomingCall info={callInfo} onAccept={() => callRef.current?.accept()} onReject={() => callRef.current?.reject()} />
      <ShareCardModal data={shareData} onClose={() => setShareData(null)} />
    </View>
  );
}

const deltaColor = (v?: number, base?: number) =>
  v == null || base == null ? P.sub : v - base > 0.5 ? '#13B783' : v - base < -0.5 ? '#DC2626' : '#71809A';

const s = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  kicker: { color: tFg('rgba(255,255,255,0.8)'), fontSize: 12, fontWeight: '700', textAlign: 'right' },
  heroTitle: { color: tFg('#fff'), fontSize: 24, fontWeight: '800', textAlign: 'right' },
  heroSub: { color: tFg('rgba(255,255,255,0.88)'), fontSize: 13, textAlign: 'right', marginTop: 4 },
  heroRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  tag: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: tBg('rgba(255,255,255,0.18)'), borderRadius: 999, paddingHorizontal: 10, height: 30 },
  tagTxt: { color: tFg('#fff'), fontSize: 12, fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4 },

  codeIn: {
    marginTop: 14, backgroundColor: P.soft, borderWidth: 1.5, borderColor: P.border, borderRadius: 16,
    fontSize: 30, letterSpacing: 8, textAlign: 'center', paddingVertical: 12, color: P.text, fontWeight: '700',
  },
  in: {
    marginTop: 10, backgroundColor: P.soft, borderWidth: 1.5, borderColor: P.border, borderRadius: 14,
    fontSize: 15, paddingVertical: 12, paddingHorizontal: 14, color: P.text, textAlign: 'right',
  },
  err: { color: P.red, fontSize: 12.5, fontWeight: '700', textAlign: 'center', marginTop: 10 },

  howCard: { backgroundColor: tBg('#faf8ff'), borderRadius: 20, padding: 16, gap: 8, borderWidth: 1, borderColor: tBd('#e6ddff') },
  howTitle: { color: P.violet, fontSize: 14.5, fontWeight: '800', textAlign: 'right', marginBottom: 4 },
  howRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  howNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: P.violetSoft, alignItems: 'center', justifyContent: 'center' },
  howNumTxt: { color: P.violet, fontSize: 11, fontWeight: '800' },
  howTxt: { flex: 1, color: tFg('#4b5675'), fontSize: 13, textAlign: 'right', lineHeight: 20 },

  card: { backgroundColor: P.card, borderRadius: 22, padding: 14, borderWidth: 1, borderColor: P.border, ...shadow },
  waitCard: { backgroundColor: P.card, borderRadius: 22, padding: 24, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: P.border },
  waitTxt: { color: P.sub, fontSize: 13 },
  delta: { fontSize: 11.5, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  cardTitle: { color: P.text, fontSize: 15, fontWeight: '800', textAlign: 'right', marginBottom: 6 },
  pingTag: { backgroundColor: tBg('rgba(255,255,255,0.18)'), borderRadius: 999, paddingHorizontal: 10, height: 30, justifyContent: 'center' },
  pingTxt: { color: tFg('#fff'), fontSize: 12, fontWeight: '800' },
  best: { marginTop: 12, backgroundColor: P.greenSoft, borderRadius: 14, padding: 10, gap: 2 },
  bestTxt: { color: tFg('#0b7a47'), fontSize: 13, fontWeight: '700', textAlign: 'right' },
  bestGap: { fontSize: 12, fontWeight: '800', textAlign: 'right' },
  pinned: { color: P.violet, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  chartLbls: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  chartLbl: { color: P.faint, fontSize: 10.5, fontWeight: '700' },

  sayGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  sayBtn: {
    width: '48.5%', backgroundColor: P.soft, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1.5, borderColor: P.border,
  },
  sayStop: { width: '100%', backgroundColor: P.greenSoft, borderColor: tBd('#c9f0dc') },
  sayTxt: { color: P.text, fontSize: 13.5, fontWeight: '800', textAlign: 'center' },
  cmdBtn: { backgroundColor: P.violetSoft, borderColor: tBd('#ded5ff') },
  unlockBtn: { width: '100%', backgroundColor: P.redSoft, borderColor: tBd('#ffdde2') },
  log: { color: P.sub, fontSize: 12.5, textAlign: 'right', backgroundColor: P.soft, borderRadius: 14, padding: 8 },

  gain: { fontSize: 40, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  gainLbl: { color: P.sub, fontSize: 12, textAlign: 'center', marginBottom: 8 },
  repRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: P.border },
  repLbl: { color: P.sub, fontSize: 13 },
  repVal: { color: P.text, fontSize: 13.5, fontWeight: '800' },

  camAsk: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: P.blueSoft, borderRadius: 16, paddingVertical: 12, marginBottom: 4 },
  camAskTxt: { color: P.blue, fontSize: 13.5, fontWeight: '800' },
  spBox: { flex: 1, backgroundColor: P.soft, borderRadius: 16, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: P.border },
  spLbl: { color: P.sub, fontSize: 12, fontWeight: '800' },
  spVal: { color: P.text, fontSize: 22, fontWeight: '800' },
  spUnit: { color: P.sub, fontSize: 11, fontWeight: '700' },
  spSub: { color: P.sub, fontSize: 11.5, fontWeight: '700' },
  spPct: { fontSize: 13.5, fontWeight: '800', marginTop: 2 },
  more: { color: P.blue, fontSize: 13, fontWeight: '800' },
  pastRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: P.border },
  pastTitle: { color: P.text, fontSize: 14, fontWeight: '800' },
  pastSub: { color: P.sub, fontSize: 11.5, marginTop: 1 },
  pastGain: { fontSize: 15, fontWeight: '800' },
  leave: { flexDirection: 'row-reverse', alignSelf: 'center', alignItems: 'center', gap: 6, padding: 12 },
  leaveTxt: { color: P.sub, fontSize: 13, fontWeight: '700' },
});
