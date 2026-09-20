import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';

/**
 * وضع الصوت للتوجيه — مثل حساس الركن في السيارة:
 * كل ما تحسنت الإشارة تتقارب النغمات وتعلى نبرتها، فتوجّه الأنتنا بدون ما تشوف الشاشة.
 */
const SRC = {
  low: require('../../assets/sounds/beep-low.wav'),
  mid: require('../../assets/sounds/beep-mid.wav'),
  high: require('../../assets/sounds/beep-high.wav'),
};
type Tone = keyof typeof SRC;

export class AimBeeper {
  private players: Partial<Record<Tone, AudioPlayer>> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private score = 0;
  private running = false;

  async start() {
    if (this.running) return;
    this.running = true;
    try { await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }); } catch {}
    for (const t of Object.keys(SRC) as Tone[]) {
      try { this.players[t] = createAudioPlayer(SRC[t]); } catch {}
    }
    this.loop();
  }

  /** score من ٠ إلى ١ — نفس درجة الإشارة في الدائرة */
  update(score: number) {
    this.score = Math.max(0, Math.min(1, score));
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const p of Object.values(this.players)) {
      try { p?.remove(); } catch {}
    }
    this.players = {};
  }

  private loop = () => {
    if (!this.running) return;
    const sc = this.score;
    const tone: Tone = sc >= 0.72 ? 'high' : sc >= 0.45 ? 'mid' : 'low';
    const p = this.players[tone];
    if (p) {
      p.seekTo(0).then(() => p.play()).catch(() => {});
    }
    // ضعيف: نغمة كل ١.٣ ثانية — ممتاز: كل ١٥٠ms تقريباً (شبه متصلة)
    const gap = Math.round(1300 - Math.pow(sc, 1.4) * 1150);
    this.timer = setTimeout(this.loop, Math.max(150, gap));
  };
}
