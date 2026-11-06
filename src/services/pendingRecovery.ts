/**
 * يشيك «تجارب ما خلصت» لكل الراوترات المحفوظة (store/pendingRestore) ويرجّع إعدادها — عند فتح التطبيق
 * ولما يرجع من الخلفية. مرة وحدة بالمرة، ومو أكثر من مرة كل ٣٠ ثانية.
 */
import { Alert } from 'react-native';
import { listRouters } from '../store/routers';
import { getPending } from '../store/pendingRestore';
import { recoverPending } from '../utils/safeLock';
import { diag } from './diag';

let running = false;
let lastRun = 0;

export async function runPendingRecovery(): Promise<void> {
  if (running || Date.now() - lastRun < 30_000) return;
  running = true;
  lastRun = Date.now();
  try {
    for (const r of await listRouters()) {
      if (r.host === 'demo' || r.host === 'device') continue;
      if (!(await getPending(r.id))) continue;
      try {
        const res = await recoverPending(r);
        if (res) Alert.alert(res.ok ? '✓ رجّعنا إعدادك' : '⚠️ تجربة ما خلصت', res.note);
      } catch (e) {
        diag(`[recover] ${String((e as any)?.message ?? e).slice(0, 80)}`);
      }
    }
  } finally {
    running = false;
  }
}
