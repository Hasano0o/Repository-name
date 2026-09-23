import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

let handlerSet = false;

/** يُستدعى مرة عند إقلاع التطبيق — يحدد كيف تُعرض الإشعارات والتطبيق مفتوح */
export function initNotificationHandler() {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** قناة إشعارات أندرويد — لازمة عشان تظهر التنبيهات بصوت واهتزاز */
export async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('monitor', {
      name: 'مراقبة الاتصال',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#2f6bff',
    });
  } catch {}
}

/** يطلب إذن الإشعارات من المستخدم — يرجع true لو سمح */
export async function requestNotifyPermission(): Promise<boolean> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) { await ensureAndroidChannel(); return true; }
    const req = await Notifications.requestPermissionsAsync();
    if (req.granted) await ensureAndroidChannel();
    return req.granted;
  } catch {
    return false;
  }
}

export async function hasNotifyPermission(): Promise<boolean> {
  try { return (await Notifications.getPermissionsAsync()).granted; } catch { return false; }
}

/** يرسل إشعاراً محلياً فوراً */
export async function notify(title: string, body: string, _routerId?: string) {
  try {
    await ensureAndroidChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        // لا نضع routerId في data — يظهر في iOS Notification Center
        // و Android Drawer، ولا حاجة له في الإشعار نفسه.
      },
      trigger: null,
    });
  } catch {}
}
