import { useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
} from 'react-native';
import type { StoreAd } from '../services/stores';

export function StoreAdCard({ store }: { store: StoreAd }) {
  const [imageFailed, setImageFailed] = useState(false);

  const openAd = async () => {
    const url = store.location_url || store.whatsapp;
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {}
  };

  if (!store.image_url || imageFailed) {
    return null;
  }

  return (
    <Pressable
      onPress={openAd}
      disabled={!store.location_url && !store.whatsapp}
      style={({ pressed }) => [s.wrapper, pressed && s.pressed]}
    >
      <Image
        key={store.image_url}
        source={{ uri: store.image_url }}
        style={s.image}
        resizeMode="contain"
        onError={() => setImageFailed(true)}
      />
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrapper: {
    width: '100%',
    aspectRatio: 1200 / 500,
    marginTop: 14,
    marginBottom: 10,
    borderRadius: 14,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.9,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
