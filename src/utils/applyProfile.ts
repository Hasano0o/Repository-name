import { SavedRouter } from '../store/routers';
import { routerWrite } from '../store/sessions';
import { Profile } from '../store/profiles';

/** يطبّق ملف/وضع محفوظ مباشرة (بدون رجوع تلقائي — المستخدم اختاره بنفسه) */
export async function applyProfile(r: SavedRouter, p: Profile): Promise<boolean> {
  // من خلال الطبقة الموحّدة: لو فيه عملية ثانية على الراوتر يرمي «مشغول» وما يكتب شي
  const applied = await routerWrite(r, async d => {
    if (!d.setBand) return false;
    if (p.mode && d.setNetworkMode) {
      const cur = d.getBandConfig ? await d.getBandConfig().catch(() => null) : null;
      if (!cur || cur.mode !== p.mode) { try { await d.setNetworkMode(p.mode); } catch {} }
    }
    await d.setBand(p.bands, p.nrBands);
    return true;
  }, { label: `تطبيق «${p.name}»` });
  if (applied) await new Promise(res => setTimeout(res, 6000));
  return applied;
}
