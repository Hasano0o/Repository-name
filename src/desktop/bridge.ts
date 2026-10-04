/**
 * جسر نسخة الويندوز (desktop/ — Electron).
 * في الجوال هذا كله undefined وما يأثر على شي.
 */
export interface DesktopFetchResult {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: Uint8Array;
  url: string;
}

export interface DesktopBridge {
  version: string;
  fetch(id: number, req: {
    url: string;
    method: string;
    headers: [string, string][];
    body?: Uint8Array | string;
  }): Promise<DesktopFetchResult>;
  abort(id: number): void;
  secretGet(key: string): Promise<string | null>;
  secretSet(key: string, value: string): Promise<void>;
  secretDel(key: string): Promise<void>;
  /** نافذة رسالة ويندوز أصلية — ترجع رقم الزر المضغوط (أو آخر زر لو انقفلت) */
  dialog(title: string, message: string, buttons: string[], cancelId: number): Promise<number>;
  openExternal(url: string): void;
  /** حالة الشبكة من الويندوز (null خارج الويندوز). موجودة من نسخة 1.1 */
  netDiag?(): Promise<NetDiag | null>;
  /** يصلح الاتصال بصلاحية المسؤول — false لو المستخدم رفض */
  netRepair?(): Promise<boolean>;
  openWifiSettings?(): void;
  /** يفتح صفحة الفني في نافذة مستقلة (من نسخة 1.2) */
  openTech?(code?: string): void;
  /** يشيك على تحديث جديد ويعرض النتيجة */
  checkUpdate?(): void;
}

export interface NetDiag {
  /** عنوان الراوتر (البوابة) — null لو ما فيه */
  gateway: string | null;
  ip: string | null;
  /** الجهاز ما أخذ عنوان من الراوتر (169.254 أو بدون بوابة) */
  noAddress: boolean;
  wired: boolean;
  ssid: string | null;
  /** أكثر من جهاز يبث نفس اسم الواي فاي */
  duplicateSsid: boolean;
}

export const desktop: DesktopBridge | undefined =
  typeof globalThis !== 'undefined' ? (globalThis as any).bandlyDesktop : undefined;

export const isDesktop = !!desktop;
