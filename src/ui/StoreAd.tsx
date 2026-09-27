import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { fetchActiveStore } from '../services/stores';
import { StoreAdCard } from './StoreAdCard';
import type { StoreAd as StoreAdType } from '../services/stores';

export function StoreAd() {
  const [store, setStore] = useState<StoreAdType | null>(null);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      fetchActiveStore().then((result) => {
        if (mounted) {
          setStore(result);
        }
      });

      return () => {
        mounted = false;
      };
    }, [])
  );

  if (!store) {
    return null;
  }

  return <StoreAdCard store={store} />;
}
