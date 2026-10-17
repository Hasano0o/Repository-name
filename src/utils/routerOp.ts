/**
 * للشاشات: يشغّل عملية تعديل على الراوتر من خلال الطبقة الموحّدة (withRouterLock).
 * لو فيه عملية ثانية شغالة: ما يبدأ شي، ويعرض للمستخدم إن الراوتر مشغول، ويرجع undefined.
 * أي خطأ ثاني يطلع مثل ما هو (الشاشة تتعامل معه زي قبل).
 */
import { Alert } from 'react-native';
import { SavedRouter } from '../store/routers';
import { withRouterLock, isRouterBusyError, RouterOp } from '../store/sessions';

export async function runRouterOp<T>(
  r: SavedRouter,
  label: string,
  fn: (op: RouterOp) => Promise<T>,
): Promise<T | undefined> {
  try {
    return await withRouterLock(r, fn, { label });
  } catch (e) {
    if (isRouterBusyError(e)) {
      Alert.alert('الراوتر مشغول', (e as Error).message);
      return undefined;
    }
    throw e;
  }
}
