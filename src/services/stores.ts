export type StoreAd = {
  id: number;
  name: string;
  image_url: string;
  location_url: string;
  whatsapp: string;
  active: boolean;
};

const API_URL = 'https://has-host.com/bandly/stores/active';

function normalizeHttpsUrl(value: unknown): string {
  if (typeof value !== 'string') return '';

  const raw = value.trim();
  if (!raw) return '';

  if (/^https:\/\//i.test(raw)) {
    return raw;
  }

  if (/^http:\/\//i.test(raw)) {
    return '';
  }

  return `https://${raw}`;
}

function normalizeWhatsapp(value: unknown): string {
  if (typeof value !== 'string') return '';

  const digits = value.replace(/\D/g, '');

  if (digits.length < 10 || digits.length > 15) {
    return '';
  }

  return `https://wa.me/${digits}`;
}

function normalizeStore(value: unknown): StoreAd | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const item = value as Record<string, unknown>;

  const id = Number(item.id);
  const name =
    typeof item.name === 'string'
      ? item.name.trim()
      : '';

  if (!Number.isFinite(id) || id <= 0 || !name) {
    return null;
  }

  return {
    id,
    name,
    image_url: normalizeHttpsUrl(item.image_url),
    location_url: normalizeHttpsUrl(item.location_url),
    whatsapp: normalizeWhatsapp(item.whatsapp),
    active: item.active === true,
  };
}

export async function fetchActiveStore(): Promise<StoreAd | null> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 8000);

  try {
    const response = await fetch(API_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data: unknown = await response.json();

    if (!Array.isArray(data)) {
      return null;
    }

    for (const item of data) {
      const store = normalizeStore(item);

      if (store && store.active) {
        return store;
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
