export interface RouterIdentity {
  manufacturer?: string;
  model?: string;
  softwareVersion?: string;
  hardwareVersion?: string;
}

export type RouterIdentityFields = Partial<RouterIdentity>;

export function cleanRouterIdentity(
  identity: RouterIdentityFields,
): RouterIdentityFields {
  const clean: RouterIdentityFields = {};

  for (const key of [
    'manufacturer',
    'model',
    'softwareVersion',
    'hardwareVersion',
  ] as const) {
    const value = identity[key];

    if (typeof value === 'string' && value.trim()) {
      clean[key] = value.trim();
    }
  }

  return clean;
}