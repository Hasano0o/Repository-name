/**
 * مكالمة صوت + فيديو حيّة بين العميل والفني (WebRTC) — الإشارات تمر عبر نفس اتصال وضع الفني،
 * والصوت/الفيديو يمشي مباشرة بين الجهازين، أو عبر خادم TURN على سيرفرنا لو الشبكة تمنع الاتصال المباشر.
 * الكاميرا: من جهة العميل فقط، وما تشتغل إلا لما يضغط العميل بنفسه (أو يوافق على طلب الفني).
 */
import { Platform, Vibration } from 'react-native';
import {
  RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, mediaDevices, MediaStream,
} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

export type CallState = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active';
export interface CallInfo {
  state: CallState;
  peer: string;          // اسم الطرف الثاني
  startedAt?: number;    // وقت بداية المكالمة الفعلية
  muted: boolean;
  speaker: boolean;
  ended?: string;        // سبب آخر إنهاء (للعرض لحظياً)
  // ═══ الفيديو ═══
  cam?: boolean;         // (العميل) الكاميرا شغالة
  facing?: 'environment' | 'user';
  localUrl?: string;     // (العميل) معاينة كاميرته
  peerCam?: boolean;     // (الفني) كاميرا العميل شغالة
  remoteUrl?: string;    // (الفني) بث كاميرا العميل
  videoRev?: number;     // يتغير لما يوصل مسار فيديو جديد (نعيد رسم العرض)
  point?: { x: number; y: number; at: number };  // (العميل) الفني أشّر هنا
  camReq?: number;       // (العميل) الفني طلب تشغيل الكاميرا
}
export interface RtcMsg { kind: string; data?: any; sid?: string; from?: string }

const RING_MS = 40000;

export class CallController {
  private pc: any = null;
  private stream: MediaStream | null = null;
  private peerSid: string | undefined;
  private pendingIce: any[] = [];
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private vstream: MediaStream | null = null;
  private vsender: any = null;
  private camBusy = false;
  info: CallInfo = { state: 'idle', peer: '', muted: false, speaker: true };

  constructor(private o: {
    role: 'cust' | 'tech';
    send: (kind: string, data?: any, to?: string) => void;
    getIce: () => Promise<any[]>;
    onChange: (info: CallInfo) => void;
    peerLabel: string;    // «الفني» أو «العميل»
  }) {}

  private set(p: Partial<CallInfo>) {
    this.info = { ...this.info, ...p };
    this.o.onChange({ ...this.info });
  }
  private tx(kind: string, data?: any) { this.o.send(kind, data, this.o.role === 'cust' ? this.peerSid : undefined); }
  get busy() { return this.info.state !== 'idle'; }

  // ═══ بدء مكالمة ═══
  call() {
    if (this.busy) return;
    this.peerSid = undefined;
    this.set({ state: 'outgoing', peer: this.o.peerLabel, muted: false, speaker: true, ended: undefined, startedAt: undefined });
    this.o.send('call');
    try { InCallManager.start({ media: 'audio', ringback: '_DTMF_' } as any); } catch {}
    this.ringTimer = setTimeout(() => this.hangup('ما رد أحد'), RING_MS);
  }

  accept() {
    if (this.info.state !== 'incoming') return;
    this.stopRing();
    this.set({ state: 'connecting' });
    this.setupPc().then(() => this.tx('accept')).catch(e => this.fail(e));
  }

  reject() {
    if (this.info.state !== 'incoming') return;
    this.stopRing();
    this.tx('reject');
    this.cleanup('رفضت المكالمة');
  }

  hangup(reason = 'انتهت المكالمة') {
    if (!this.busy) return;
    this.tx('hangup');
    this.cleanup(reason);
  }

  toggleMute() {
    const m = !this.info.muted;
    this.stream?.getAudioTracks().forEach((t: any) => { t.enabled = !m; });
    this.set({ muted: m });
  }

  toggleSpeaker() {
    const s = !this.info.speaker;
    try { InCallManager.setForceSpeakerphoneOn(s); } catch {}
    this.set({ speaker: s });
  }

  // ═══ الكاميرا (العميل) ═══
  async toggleCam(): Promise<void> {
    if (this.o.role !== 'cust' || this.info.state !== 'active' || !this.pc || this.camBusy) return;
    this.camBusy = true;
    try {
      if (this.info.cam) { this.stopCam(); return; }
      const facing = this.info.facing ?? 'environment';
      let vs: MediaStream;
      try {
        vs = await mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: facing, width: 640, height: 480, frameRate: 15 } as any,
        }) as MediaStream;
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        throw new Error(/permission|denied|NotAllowed/i.test(msg) ? 'اسمح للتطبيق باستخدام الكاميرا من الإعدادات' : 'ما قدرنا نشغّل الكاميرا');
      }
      const track: any = vs.getVideoTracks()[0];
      this.vstream = vs;
      if (this.vsender) {
        await this.vsender.replaceTrack(track);
      } else {
        this.vsender = this.pc.addTrack(track, this.stream);
        const offer = await this.pc.createOffer({});
        await this.pc.setLocalDescription(offer);
        this.tx('offer', { type: offer.type, sdp: offer.sdp });
      }
      this.set({ cam: true, facing, localUrl: (vs as any).toURL(), camReq: undefined });
      this.tx('cam', { on: true });
    } finally {
      this.camBusy = false;
    }
  }

  flipCam() {
    if (!this.info.cam || !this.vstream) return;
    const t: any = this.vstream.getVideoTracks()[0];
    try { t._switchCamera(); } catch { return; }
    const facing = this.info.facing === 'user' ? 'environment' : 'user';
    this.set({ facing });
    this.tx('cam', { on: true, facing });
  }

  clearCamReq() { this.set({ camReq: undefined }); }

  private stopCam(silent = false) {
    try { this.vsender?.replaceTrack(null); } catch {}
    try { this.vstream?.getTracks().forEach((t: any) => t.stop()); } catch {}
    this.vstream = null;
    this.set({ cam: false, localUrl: undefined, point: undefined });
    if (!silent) this.tx('cam', { on: false });
  }

  // ═══ الفيديو (الفني) ═══
  requestCam() { if (this.o.role === 'tech' && this.info.state === 'active') this.tx('camreq'); }
  requestFlip() { if (this.o.role === 'tech' && this.info.peerCam) this.tx('flip'); }
  /** x,y من ٠ إلى ١ على صورة الكاميرا */
  point(x: number, y: number) {
    if (this.o.role === 'tech' && this.info.peerCam) this.tx('point', { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  }

  // ═══ الرسائل الواردة ═══
  async handle(m: RtcMsg) {
    const st = this.info.state;
    try {
      switch (m.kind) {
        case 'call':
          if (st !== 'idle') { this.o.send('busy', undefined, m.sid); return; }
          this.peerSid = m.sid;
          this.set({ state: 'incoming', peer: m.from || this.o.peerLabel, muted: false, speaker: true, ended: undefined, startedAt: undefined });
          this.startRing();
          this.ringTimer = setTimeout(() => { if (this.info.state === 'incoming') { this.stopRing(); this.cleanup('مكالمة فائتة'); } }, RING_MS);
          break;
        case 'accept':
          if (st !== 'outgoing') return;
          this.peerSid = m.sid;
          this.clearRingTimer();
          try { InCallManager.stopRingback(); } catch {}
          this.set({ state: 'connecting', peer: m.from || this.info.peer });
          await this.setupPc();
          { const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
            await this.pc.setLocalDescription(offer);
            this.tx('offer', { type: offer.type, sdp: offer.sdp }); }
          break;
        case 'offer':
          if (!this.pc) return;
          await this.pc.setRemoteDescription(new RTCSessionDescription(m.data));
          await this.flushIce();
          { const ans = await this.pc.createAnswer();
            await this.pc.setLocalDescription(ans);
            this.tx('answer', { type: ans.type, sdp: ans.sdp }); }
          break;
        case 'answer':
          if (!this.pc) return;
          await this.pc.setRemoteDescription(new RTCSessionDescription(m.data));
          await this.flushIce();
          break;
        case 'ice':
          if (!m.data) return;
          if (this.pc && this.pc.remoteDescription) await this.pc.addIceCandidate(new RTCIceCandidate(m.data));
          else this.pendingIce.push(m.data);
          break;
        case 'cam':
          if (this.o.role === 'tech') this.set({ peerCam: !!m.data?.on });
          break;
        case 'camreq':
          if (this.o.role === 'cust' && st === 'active' && !this.info.cam) {
            Vibration.vibrate(Platform.OS === 'android' ? [0, 120, 80, 120] : 10);
            this.set({ camReq: Date.now() });
          }
          break;
        case 'flip':
          if (this.o.role === 'cust') this.flipCam();
          break;
        case 'point':
          if (this.o.role === 'cust' && this.info.cam && m.data) {
            const x = Math.max(0, Math.min(1, Number(m.data.x))), y = Math.max(0, Math.min(1, Number(m.data.y)));
            if (Number.isFinite(x) && Number.isFinite(y)) {
              Vibration.vibrate(Platform.OS === 'android' ? 40 : 10);
              this.set({ point: { x, y, at: Date.now() } });
            }
          }
          break;
        case 'reject': if (st === 'outgoing') this.cleanup('رفض المكالمة'); break;
        case 'busy': if (st === 'outgoing') this.cleanup('مشغول بمكالمة ثانية'); break;
        case 'taken': if (st === 'incoming') { this.stopRing(); this.cleanup('ردّ فني ثاني'); } break;
        case 'hangup': if (st !== 'idle') { this.stopRing(); this.cleanup('انتهت المكالمة'); } break;
        case 'gone':
          if (st !== 'idle' && (!m.sid || !this.peerSid || m.sid === this.peerSid)) { this.stopRing(); this.cleanup('انقطع الطرف الثاني'); }
          break;
      }
    } catch (e) { this.fail(e); }
  }

  // ═══ داخلي ═══
  private async setupPc() {
    const iceServers = await this.o.getIce();
    this.stream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;
    const pc: any = new RTCPeerConnection({ iceServers } as any);
    this.pc = pc;
    this.stream.getTracks().forEach((t: any) => pc.addTrack(t, this.stream));
    pc.addEventListener('track', (e: any) => {
      if (e.track?.kind !== 'video') return;
      const rs = e.streams?.[0];
      if (rs) this.set({ remoteUrl: rs.toURL(), videoRev: (this.info.videoRev ?? 0) + 1 });
    });
    pc.addEventListener('icecandidate', (e: any) => { if (e.candidate) this.tx('ice', e.candidate.toJSON ? e.candidate.toJSON() : e.candidate); });
    pc.addEventListener('connectionstatechange', () => {
      const cs = pc.connectionState;
      if (cs === 'connected' && this.info.state !== 'active') {
        try { InCallManager.start({ media: 'audio' } as any); InCallManager.setForceSpeakerphoneOn(this.info.speaker); } catch {}
        Vibration.vibrate(Platform.OS === 'android' ? 60 : 10);
        this.set({ state: 'active', startedAt: Date.now() });
      }
      if (cs === 'failed') this.hangup('تعذّر وصل الصوت — جرّب مرة ثانية');
      if (cs === 'disconnected') {
        setTimeout(() => { if (this.pc === pc && pc.connectionState === 'disconnected') this.hangup('انقطع الاتصال'); }, 8000);
      }
    });
  }

  private async flushIce() {
    const q = this.pendingIce; this.pendingIce = [];
    for (const c of q) { try { await this.pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
  }

  private startRing() {
    try { InCallManager.startRingtone('_DEFAULT_', [0, 700, 500], 'playback', 40); } catch {}
    Vibration.vibrate([0, 700, 500], true);
  }
  private stopRing() {
    this.clearRingTimer();
    try { InCallManager.stopRingtone(); } catch {}
    Vibration.cancel();
  }
  private clearRingTimer() { if (this.ringTimer) { clearTimeout(this.ringTimer); this.ringTimer = null; } }

  private fail(e: any) {
    const msg = String(e?.message ?? e);
    if (this.info.state === 'active') return;   // خطأ جانبي (مثلاً إعادة تفاوض) ما يقطع مكالمة شغالة
    this.hangup(/permission|denied|NotAllowed/i.test(msg) ? 'اسمح للتطبيق باستخدام الميكروفون' : 'تعذّر بدء المكالمة');
  }

  private cleanup(reason: string) {
    this.clearRingTimer();
    try { InCallManager.stopRingback(); } catch {}
    try { this.stream?.getTracks().forEach((t: any) => t.stop()); } catch {}
    try { this.vstream?.getTracks().forEach((t: any) => t.stop()); } catch {}
    this.vstream = null; this.vsender = null;
    try { this.pc?.close(); } catch {}
    this.pc = null; this.stream = null; this.pendingIce = []; this.peerSid = undefined;
    try { InCallManager.stop(); } catch {}
    this.set({
      state: 'idle', ended: reason, startedAt: undefined, muted: false,
      cam: false, localUrl: undefined, peerCam: false, remoteUrl: undefined, point: undefined, camReq: undefined,
    });
  }

  dispose() { if (this.busy) this.hangup(); }
}
