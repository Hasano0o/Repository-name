import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { Profile } from '../store/profiles';

/** يطبّق ملف/وضع محفوظ مباشرة (بدون رجوع تلقائي — المستخدم اختاره بنفسه) */
export async function applyProfile(r: SavedRouter, p: Profile): Promise<boolean> {
  const applied = await withSession(r, async d => {
    if (!d.setBand) return false;
    if (p.mode && d.setNetworkMode) {
      const cur = d.getBandConfig ? await d.getBandConfig().catch(() => null) : null;
      if (!cur || cur.mode !== p.mode) { try { await d.setNetworkMode(p.mode); } catch {} }
    }
    await d.setBand(p.bands, p.nrBands);
    return true;
  }, false);
  if (applied) await new Promise(res => setTimeout(res, 6000));
  return applied;
}
