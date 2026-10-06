import { Clipboard, Platform } from 'react-native';

/** ينسخ نص للحافظة — على الجوال من RN نفسه (موجود بالنسخ القديمة)، وعلى الويندوز من المتصفح */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    } else {
      Clipboard.setString(text);
    }
    return true;
  } catch {
    return false;
  }
}
