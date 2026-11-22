// Движение интерфейса (docs/13-art.md, §7): короткие переходы без пружин и тряски (брендбук студии, «Интерфейс»).
// Появление экрана и его частей, отклик кнопки на палец, счёт числа на итоге. С «Меньше движения» всё стоит сразу
// на месте (ADR устава 0023, правило 6). Reanimated 4: значения и стили — на потоке интерфейса, кадры JS не занимают.
import React, { useEffect, useState } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useLessMotion } from './motion';

/** Длительности, мс: отклик, появление части, смена экрана. */
export const MOTION = { press: 90, part: 320, screen: 220, count: 900 } as const;
const EASE = Easing.out(Easing.cubic);

/** Часть экрана появляется: проявляется и поднимается на `rise` точек. `delay` — очередь частей. */
export function Appear({ children, delay = 0, rise = 10, duration = MOTION.part, style }: { children: React.ReactNode; delay?: number; rise?: number; duration?: number; style?: StyleProp<ViewStyle> }) {
  const less = useLessMotion();
  const t = useSharedValue(less ? 1 : 0);
  useEffect(() => {
    t.value = less ? 1 : withDelay(delay, withTiming(1, { duration, easing: EASE, reduceMotion: ReduceMotion.Never }));
  }, [less, delay, duration, t]);
  const anim = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateY: (1 - t.value) * rise }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** Нажимаемое с откликом: под пальцем чуть сжимается и темнеет; с «Меньше движения» — только темнеет. */
export function Press({ children, style, pressedStyle, disabled, onPressIn, onPressOut, ...rest }: Omit<PressableProps, 'style' | 'children'> & { children: React.ReactNode; style?: StyleProp<ViewStyle>; pressedStyle?: StyleProp<ViewStyle> }) {
  const less = useLessMotion();
  const p = useSharedValue(0);
  const [down, setDown] = useState(false);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.025 * p.value }] }));
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={e => {
        setDown(true);
        if (!less) p.value = withTiming(1, { duration: MOTION.press, easing: EASE, reduceMotion: ReduceMotion.Never });
        onPressIn?.(e);
      }}
      onPressOut={e => {
        setDown(false);
        if (!less) p.value = withTiming(0, { duration: MOTION.press * 2, easing: EASE, reduceMotion: ReduceMotion.Never });
        onPressOut?.(e);
      }}>
      <Animated.View style={[style, down && pressedStyle, anim]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Число на итоге считает от нуля до значения; с «Меньше движения» стоит сразу. Кадров — не больше 30 в секунду. */
export function useCountUp(value: number, delay = 0): number {
  const less = useLessMotion();
  const [shown, setShown] = useState(0);
  const still = less || value === 0;
  useEffect(() => {
    if (still) return;
    let raf = 0;
    let t0 = 0;
    let last = -1;
    const tick = (now: number) => {
      if (!t0) t0 = now + delay;
      const k = Math.min(1, Math.max(0, (now - t0) / MOTION.count));
      const v = Math.round(value * (1 - (1 - k) ** 3));
      if (v !== last) { last = v; setShown(v); }
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, still, delay]);
  return still ? value : shown;
}

/** Доля 0…1 плавно идёт к новому значению — полоса загрузки и полосы итога. */
export function useEased(value: number, duration: number = MOTION.part) {
  const less = useLessMotion();
  const t = useSharedValue(less ? value : 0);
  useEffect(() => {
    t.value = less ? value : withTiming(value, { duration, easing: EASE, reduceMotion: ReduceMotion.Never });
  }, [value, less, duration, t]);
  return t;
}
