import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { C } from './theme';

export function SyncIcon({ active }: { active: boolean }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.Text style={{ color: C.blue, fontSize: 20, opacity: active ? 1 : 0.3, transform: [{ rotate }] }}>
      ⟳
    </Animated.Text>
  );
}
