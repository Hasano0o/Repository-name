/**
 * نسخة الويب/الويندوز: مكتبة المكالمات (react-native-webrtc) للجوال بس — تحميلها في المتصفح يطيّح التطبيق.
 * هنا نفس الأنواع وكلاس فاضي، فالمشاركة مع الفني تشتغل بدون مكالمة صوت/كاميرا.
 */
export type CallState = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active';
export interface CallInfo {
  state: CallState;
  peer: string;
  startedAt?: number;
  muted: boolean;
  speaker: boolean;
  ended?: string;
  cam?: boolean;
  facing?: 'environment' | 'user';
  localUrl?: string;
  peerCam?: boolean;
  remoteUrl?: string;
  videoRev?: number;
  point?: { x: number; y: number; at: number };
  camReq?: number;
}
export interface RtcMsg { kind: string; data?: any; sid?: string; from?: string }

export class CallController {
  info: CallInfo = { state: 'idle', peer: '', muted: false, speaker: true };
  constructor(_o: unknown) {}
  get busy() { return false; }
  call() {}
  accept() {}
  reject() {}
  hangup(_reason?: string) {}
  toggleMute() {}
  toggleSpeaker() {}
  async toggleCam(): Promise<void> { throw new Error('الكاميرا متوفرة في تطبيق الجوال بس'); }
  clearCamReq() {}
  flipCam() {}
  point(_x: number, _y: number) {}
  async handle(_m: RtcMsg) {}
  dispose() {}
}
