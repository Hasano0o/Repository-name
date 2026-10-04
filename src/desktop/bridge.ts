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
}

export const desktop: DesktopBridge | undefined =
  typeof globalThis !== 'undefined' ? (globalThis as any).bandlyDesktop : undefined;

export const isDesktop = !!desktop;
