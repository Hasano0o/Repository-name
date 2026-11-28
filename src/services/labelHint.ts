/**
 * أخطاء ملصق هواوي (١٥ نوفمبر — 667 خطأ دخول هواوي في يومين): الأعضاء يكتبون كلمة ثانية من الملصق، والراوتر يقفل ٥ دقايق بعد كم غلطة.
 *  • WPS PIN (٨ أرقام) بدل «Password» — عضو H122-373 كتب `99999999`.
 *  • Wi-Fi Password (١١ خانة حروف كبيرة وأرقام) — عضو H122 كتب `AA9A9AA9AA9` = كلمة الواي فاي حرف بحرف.
 *  • جواله على راوتر ثاني: نفس العضو كان متصل بـ H155-383 وملصقه H122-373.
 * نسأله قبل ما نرسل الكلمة (ما تروح محاولة)، ونعطيه الموديل اللي رد (بدون دخول) يقارنه بالملصق.
 */
import { Alert } from 'react-native';
import { http } from '../drivers/http';
import { labelAdvice } from '../utils/password';

/** موديل هواوي اللي يرد على العنوان (device/basic_information — بدون دخول) */
export async function huaweiModelNoLogin(host: string): Promise<string | null> {
  try {
    const base = 'http://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const r = await http(`${base}/api/device/basic_information`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } }, 3000);
    const t = await r.text();
    return t.match(/<devicename>\s*([^<]{2,40}?)\s*<\/devicename>/i)?.[1] ?? null;
  } catch { return null; }
}

/** state-login (بدون دخول): wifipwdsamewithwebpwd=1 ← كلمة الدخول هي كلمة الواي فاي (E5785 · H122…) */
export async function huaweiSamePwdNoLogin(host: string): Promise<boolean> {
  try {
    const base = 'http://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const r = await http(`${base}/api/user/state-login`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } }, 3000);
    return /<wifipwdsamewithwebpwd>\s*1\s*<\/wifipwdsamewithwebpwd>/i.test(await r.text());
  } catch { return false; }
}

/** سطر «الراوتر اللي رد» — يكشف إن الجوال على شبكة راوتر ثاني */
export function modelLine(model: string | null): string {
  return model ? `\n\nالراوتر اللي جوالك متصل فيه: ${model}\nتأكد إنه نفس الموديل اللي على الملصق — لو غيره، جوالك على واي فاي راوتر ثاني.` : '';
}

/** true = كمّل الدخول · false = يرجع يعدّل الكلمة */
export function confirmLabelMixup(password: string, model: string | null, samePwd = false): Promise<boolean> {
  const mix = labelAdvice(password, samePwd);
  if (!mix) return Promise.resolve(true);
  if (mix === 'wifiPwd') {
    const body = 'راوترك يدخل بـ «كلمة الواي فاي» نفسها — اللي تتصل فيها بشبكته (في الملصق: WIFI KEY أو Wi-Fi Password)، مو «admin».'
      + '\nالراوتر نفسه يقول كذا، فـ admin بيرفضها ويقفل الدخول ٥ دقايق بعد كم محاولة.'
      + '\nلو أنت غيّرت كلمة الدخول بنفسك لـ admin، اضغط «متأكد، جرّب».'
      + modelLine(model);
    return new Promise(res => Alert.alert('اكتب كلمة الواي فاي', body, [
      { text: 'أعدّل الكلمة', style: 'cancel', onPress: () => res(false) },
      { text: 'متأكد، جرّب', onPress: () => res(true) },
    ], { cancelable: true, onDismiss: () => res(false) }));
  }
  const body = (mix === 'wps'
    ? 'الكلمة اللي كتبتها ٨ أرقام — هذا شكل «WPS PIN» في الملصق، مو كلمة الدخول.'
    : mix === 'digits'
      ? 'الكلمة اللي كتبتها كلها أرقام — كلمة دخول هواوي اللي على الملصق فيها حروف دايماً.'
      : 'الكلمة اللي كتبتها شكلها كلمة الواي فاي (Wi-Fi Password)، مو كلمة الدخول.')
    + '\nكلمة الدخول سطر «Password» في الملصق تحت IP — فيها حروف كبيرة وصغيرة وأرقام. لو أنت غيّرتها بنفسك لأرقام، اضغط «متأكد، جرّب».'
    + '\nكل كلمة غلط تقفل الراوتر ٥ دقايق.'
    + modelLine(model);
  return new Promise(res => Alert.alert('تأكد من الكلمة قبل نرسلها', body, [
    { text: 'أعدّل الكلمة', style: 'cancel', onPress: () => res(false) },
    { text: 'متأكد، جرّب', onPress: () => res(true) },
  ], { cancelable: true, onDismiss: () => res(false) }));
}
