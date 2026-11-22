/**
 * «نشّط الدمج» (طلب عضو ٢٢ نوفمبر): الراوتر يفصل الدمج وقت الخمول وأحياناً ما يرجع إلا بإعادة تشغيل.
 * ١) تحميل ٨ ثواني ونقرأ النواقل (قراءة بس — wakeCa heavy)  ٢) بموافقته: قطع البيانات ورجوعها  ٣) بموافقته: إعادة تشغيل.
 * يستخدمه: بطاقة «الأساسي والثانوي» (صفحة الراوتر) + شاشة الأساسي والثانوي (combo).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { SavedRouter } from '../store/routers';
import { withSession, routerWrite, dropSession } from '../store/sessions';
import { wakeCa, hasCa, WokeCa } from '../services/caWake';

export type CaAct = '' | 'burst' | 'reconnect';

export function useCaActivate(r: SavedRouter | null, onBack: (w: WokeCa | null) => void) {
  const [act, setAct] = useState<CaAct>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const done = (ok: boolean, text: string) => { if (alive.current) { setAct(''); setMsg({ ok, text }); } };

  const offerReboot = (rt: SavedRouter, canReboot: boolean, afterReconnect: boolean) => {
    const why = afterReconnect ? 'جرّبنا التحميل وإعادة الاتصال والدمج ما رجع.' : 'جرّبنا التحميل والدمج ما رجع.';
    if (!canReboot) { done(false, `${why} البرج ممكن ما يعطي دمج الحين — جرّب بعد شوي أو أعد تشغيل الراوتر من زره.`); return; }
    done(false, why);
    Alert.alert('الدمج ما رجع', `${why}\n\nإعادة تشغيل الراوتر ترجّعه غالباً — النت ينقطع دقيقتين تقريباً.`, [
      { text: 'لاحقاً', style: 'cancel' },
      {
        text: 'إعادة تشغيل', style: 'destructive', onPress: async () => {
          try {
            await routerWrite(rt, d => d.reboot!(), { label: 'إعادة تشغيل' });
            dropSession(rt.id);
            done(true, 'الراوتر يعيد التشغيل — ارجع بعد دقيقتين وشوف الدمج');
          } catch (e: any) {
            done(false, e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  /** hadCa: الشاشة تعرض دمج الحين — لو التحميل أكّده نقول «الدمج شغال» بدل «رجع» */
  const activate = useCallback(async (hadCa = false) => {
    if (!r || act) return;
    setMsg(null);
    setAct('burst');
    const w0 = await wakeCa(r, true, true);
    if (hasCa(w0)) {
      const n = w0!.carriers.length;
      onBack(w0);
      done(true, hadCa ? `الدمج شغال — ${n} نواقل` : `رجع الدمج — ${n} نواقل`);
      return;
    }
    const caps = await withSession(r, async d => ({ rc: !!d.reconnectData, rb: !!d.reboot }), false).catch(() => ({ rc: false, rb: false }));
    if (!alive.current) return;
    if (!caps.rc) { offerReboot(r, caps.rb, false); return; }
    setAct('');
    Alert.alert('نعيد الاتصال بالشركة؟', 'التحميل ما رجّع الدمج. نقطع البيانات ونرجّعها — النت ينقطع حوالي ١٥ ثانية، وغالباً يرجع الدمج بدون إعادة تشغيل.', [
      { text: 'لا', style: 'cancel', onPress: () => done(false, 'الدمج ما رجع بالتحميل') },
      {
        text: 'أعد الاتصال', onPress: async () => {
          setAct('reconnect');
          try {
            await routerWrite(r, d => d.reconnectData!({ holdSecs: 8 }), { label: 'تنشيط الدمج' });
          } catch (e: any) {
            done(false, e?.message ?? String(e));
            return;
          }
          await new Promise(res => setTimeout(res, 12_000));
          const w = await wakeCa(r, true, true);
          if (hasCa(w)) { onBack(w); done(true, `رجع الدمج — ${w!.carriers.length} نواقل`); return; }
          offerReboot(r, caps.rb, true);
        },
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, act, onBack]);

  const label = act === 'burst' ? 'نحمّل شوي عشان يرجع الدمج…' : act === 'reconnect' ? 'نعيد الاتصال بالشركة…' : 'نشّط الدمج';
  return { act, msg, activate, label };
}
