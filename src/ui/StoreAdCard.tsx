import { useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StoreAd } from '../services/stores';
import { C, tBd, tBg, tFg } from './theme';

/**
 * بطاقة الإعلان المدفوع أسفل الشاشة.
 * المحتوى (الصورة/الرابط/الواتساب/التفعيل) يجي من البوت عبر has-host.com/bandly/stores/active
 */
export function StoreAdCard({ store }: { store: StoreAd }) {
  const [imageFailed, setImageFailed] = useState(false);
  const url = store.location_url || store.whatsapp;

  const openAd = async () => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {}
  };

  if (!store.image_url || imageFailed) {
    return null;
  }

  return (
    <View style={s.section}>
      <View style={s.head}>
        <Text style={s.featured}>✨ إعلان مميز</Text>
        <View style={s.paid}>
          <Text style={s.paidText}>👑 مدفوع</Text>
        </View>
      </View>

      <Pressable
        onPress={openAd}
        disabled={!url}
        accessibilityRole="link"
        accessibilityLabel={`إعلان: ${store.name}`}
        style={({ pressed }) => [s.card, pressed && s.pressed]}
      >
        <Image
          key={store.image_url}
          source={{ uri: store.image_url }}
          style={s.image}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
        {!!url && (
          <View style={s.go}>
            <Text style={s.goText}>›</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginTop: 18, marginBottom: 12, gap: 8 },
  head: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  featured: { color: C.violet, fontWeight: '800', fontSize: 13.5 },
  paid: {
    backgroundColor: tBg('#efe8ff'),
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  paidText: { color: C.violet, fontWeight: '800', fontSize: 12 },
  card: {
    width: '100%',
    aspectRatio: 1200 / 500,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: tBg('#1b1f5e'),
    shadowColor: C.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  image: { width: '100%', height: '100%' },
  go: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: tBg('rgba(255,255,255,0.22)'),
    borderWidth: 1,
    borderColor: tBd('rgba(255,255,255,0.35)'),
    alignItems: 'center',
    justifyContent: 'center',
  },
  goText: { color: tFg('#fff'), fontSize: 20, fontWeight: '800', lineHeight: 22 },
});
