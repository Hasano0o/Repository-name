/** نسخة الويب/الويندوز: الكاميرا والفيديو للجوال بس (react-native-webrtc) — هنا ما نعرض شي. */
import type { CallInfo } from '../services/call';

export function CamPreview(_p: { info: CallInfo; top: number; onFlip: () => void; onStop: () => void }) { return null; }
export function CamRequest(_p: { info: CallInfo; onAccept: () => void; onReject: () => void }) { return null; }
export function RemoteVideo(_p: { info: CallInfo; onPoint: (x: number, y: number) => void; onFlip: () => void }) { return null; }
