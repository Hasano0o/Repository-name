export const BAND_FREQ: Record<number, string> = {
  1: '2100', 2: '1900', 3: '1800', 4: '1700', 5: '850', 7: '2600', 8: '900',
  12: '700', 13: '700', 17: '700', 18: '850', 19: '850', 20: '800', 25: '1900',
  26: '850', 28: '700', 32: '1500', 34: '2000', 38: '2600', 39: '1900', 40: '2300',
  41: '2500', 42: '3500', 43: '3700', 66: '1700', 71: '600',
};

export const bandFreq = (b: number) => (BAND_FREQ[b] ? `${BAND_FREQ[b]} MHz` : '');

export const SCAN_PREFERRED = [1, 3, 7, 8, 20, 28, 38, 40, 41, 42];

export const NR_FREQ: Record<number, string> = {
  1: '2100', 3: '1800', 5: '850', 8: '900', 20: '800', 28: '700',
  38: '2600', 40: '2300', 41: '2500', 77: '3700', 78: '3500', 79: '4700',
};

export const nrFreq = (b: number) => (NR_FREQ[b] ? `${NR_FREQ[b]} MHz` : '');

export const bandLabel = (tech: 'LTE' | 'NR', b: number) => (tech === 'NR' ? 'n' : 'B') + b;
export const freqLabel = (tech: 'LTE' | 'NR', b: number) => (tech === 'NR' ? nrFreq(b) : bandFreq(b));
