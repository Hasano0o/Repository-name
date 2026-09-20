import { CellTower } from '../drivers/types';

export type Proximity = 'veryClose' | 'close' | 'medium' | 'far' | 'veryFar' | 'unknown';

export const PROX_LABEL: Record<Proximity, string> = {
  veryClose: 'قريب جداً',
  close: 'قريب',
  medium: 'متوسط',
  far: 'بعيد',
  veryFar: 'بعيد جداً',
  unknown: 'غير معروف',
};

export const PROX_COLOR: Record<Proximity, string> = {
  veryClose: '#12b76a',
  close: '#5ba644',
  medium: '#f79009',
  far: '#f97316',
  veryFar: '#e5484d',
  unknown: '#9aa1bd',
};

export function proximity(rsrp?: number): Proximity {
  if (rsrp === undefined) return 'unknown';
  if (rsrp >= -80) return 'veryClose';
  if (rsrp >= -90) return 'close';
  if (rsrp >= -100) return 'medium';
  if (rsrp >= -110) return 'far';
  return 'veryFar';
}

export function proximityBars(rsrp?: number): number {
  if (rsrp === undefined) return 0;
  if (rsrp >= -80) return 5;
  if (rsrp >= -90) return 4;
  if (rsrp >= -100) return 3;
  if (rsrp >= -110) return 2;
  return 1;
}

export const KIND_LABEL: Record<CellTower['kind'], string> = {
  serving: 'البرج الحالي',
  secondary: 'برج مدمج',
  neighbor: 'برج مجاور',
};

export function towerKey(t: CellTower, i: number) {
  return `${t.kind}-${t.tech}-${t.arfcn ?? ''}-${t.pci ?? ''}-${i}`;
}

export function towerTitle(t: CellTower) {
  const band = t.band ? (t.tech === 'NR' ? `n${t.band}` : `B${t.band}`) : t.tech;
  return t.pci ? `${band} · PCI ${t.pci}` : band;
}
