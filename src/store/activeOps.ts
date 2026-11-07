/** «العملية الحالية» — النسخة المربوطة بـ AsyncStorage (المنطق في activeOpsCore.ts) */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createActiveOps } from './activeOpsCore';

export const activeOps = createActiveOps({
  get: k => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: k => AsyncStorage.removeItem(k),
});
export { pillFor } from './activeOpsCore';
