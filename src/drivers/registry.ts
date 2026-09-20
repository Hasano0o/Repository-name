import { RouterDriver } from './types';
import { HuaweiDriver } from './huawei';
import { ZteDriver } from './zte';
import { OpenWrtDriver } from './openwrt';
import { MikrotikDriver } from './mikrotik';

const factories: (() => RouterDriver)[] = [
  () => new HuaweiDriver(),
  () => new ZteDriver(),
  () => new OpenWrtDriver(),
  () => new MikrotikDriver(),
];

export async function detectDriver(host: string): Promise<RouterDriver | null> {
  for (const make of factories) {
    const d = make();
    try { if (await d.detect(host)) return d; } catch {}
  }
  return null;
}

export function driverById(id: string): RouterDriver | null {
  for (const make of factories) { const d = make(); if (d.id === id) return d; }
  return null;
}
