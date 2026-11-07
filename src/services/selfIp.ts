/**
 * آي بي جوالك على شبكة الراوتر — من WebRTC (موجود أصلاً لوضع الفني، بدون مكتبة جديدة):
 * اتصال فاضي بدون سيرفرات ← الجوال يطلّع عناوينه المحلية (host candidates) ← ناخذ اللي على شبكة الراوتر.
 * ما ينرسل شي لأي مكان.
 */
import { RTCPeerConnection } from 'react-native-webrtc';
import { pickLanIp } from '../utils/gameNet';

export async function selfLanIp(routerHost: string, timeoutMs = 3000): Promise<string | undefined> {
  let pc: any;
  try {
    pc = new RTCPeerConnection({ iceServers: [] } as any);
    pc.createDataChannel('lan');
    const lines: string[] = [];
    const done = new Promise<void>(res => {
      const t = setTimeout(res, timeoutMs);
      pc.addEventListener('icecandidate', (e: any) => {
        if (e?.candidate?.candidate) lines.push(String(e.candidate.candidate));
        else { clearTimeout(t); res(); }
      });
    });
    const offer = await pc.createOffer({} as any);
    await pc.setLocalDescription(offer);
    await done;
    // بعض النسخ تحط العناوين في الـ SDP بدل الحدث
    const sdp = String(pc.localDescription?.sdp ?? '');
    for (const l of sdp.split(/\r?\n/)) if (l.startsWith('a=candidate:')) lines.push(l);
    return pickLanIp(lines, routerHost);
  } catch {
    return undefined;
  } finally {
    try { pc?.close(); } catch {}
  }
}
