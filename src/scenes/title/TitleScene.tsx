// Живая сцена за стеклом заглавного экрана (docs/08-game-design.md, §10; docs/13-art.md, §7): зал диспетчерской ночью —
// кадр Cycles из Blender (blender/title.py): видеостена с картой района, мониторы, стол под лампой. Поверх Skia рисует
// то, что живёт: на видеостене расходятся круги вызова — как на значке игры, — и мигает огонёк телефона на столе. С
// «Меньше движения» круги стоят, огонёк горит. Только картинка: касаний у сцены нет.
import { Canvas, Circle, Fill, Group, Image, LinearGradient, RadialGradient, Rect, useImage, vec } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { TITLE } from '../../art/title.gen';
import { HALL } from '../../ui/Backdrop';
import { useLessMotion } from '../../ui/motion';
import { SCENE, UI } from '../palette';

/** Шаг жизни сцены, мс: круг вызова расходится за четыре шага, огонёк телефона горит и гаснет через шаг. */
const STEP = 700;

/** Кадр заполняет экран целиком (как `cover`), верх кадра — у верха экрана: потолок и видеостена не режутся. */
export function titleFit(W: number, H: number): { k: number; x: number; y: number } {
  const k = Math.max(W / TITLE.w, H / TITLE.h);
  return { k, x: (W - TITLE.w * k) / 2, y: Math.min(0, (H - TITLE.h * k) * 0.35) };
}

export function TitleScene({ width: W, height: H }: { width: number; height: number }) {
  const hall = useImage(HALL);
  const less = useLessMotion();
  const f = useMemo(() => titleFit(W, H), [W, H]);
  // сцена живёт шагами, а не кадрами: четыре перерисовки за три секунды
  const [n, setN] = useState(0);
  useEffect(() => {
    if (less) return;
    const id = setInterval(() => setN(x => (x + 1) % 4), STEP);
    return () => clearInterval(id);
  }, [less]);
  const at = (p: readonly number[]) => [f.x + p[0] * f.k, f.y + p[1] * f.k] as const;
  const [cx, cy] = at(TITLE.call);
  const [lx, ly] = at(TITLE.lamp);
  const lr = Math.max(2, TITLE.lamp[2] * f.k);
  const ring = Math.max(5, TITLE.callR * f.k);
  const lit = less || n % 2 === 0;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="title-scene">
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color={SCENE.hallTop} />
        {hall ? <Image image={hall} x={f.x} y={f.y} width={TITLE.w * f.k} height={TITLE.h * f.k} fit="fill" /> : null}
        {/* вызов на видеостене: точка и расходящиеся круги — кумач тёмной темы */}
        <Group>
          <Circle cx={cx} cy={cy} r={ring * 4}>
            <RadialGradient c={vec(cx, cy)} r={ring * 4} colors={['rgba(229,86,106,0.30)', 'rgba(229,86,106,0)']} />
          </Circle>
          {(less ? [1, 2] : [n]).map(i => (
            <Circle key={i} cx={cx} cy={cy} r={ring * (1 + i * 0.75)} style="stroke" strokeWidth={1.5} color={UI.red} opacity={less ? 0.7 - i * 0.2 : 0.85 - i * 0.22} />
          ))}
          <Circle cx={cx} cy={cy} r={ring * 0.42} color={UI.red} />
        </Group>
        {lit ? (
          <Group>
            <Circle cx={lx} cy={ly} r={lr * 6}>
              <RadialGradient c={vec(lx, ly)} r={lr * 6} colors={['rgba(229,86,106,0.5)', 'rgba(229,86,106,0)']} />
            </Circle>
            <Circle cx={lx} cy={ly} r={lr} color="#ff8a9a" />
          </Group>
        ) : null}
        {/* сверху — затемнение под логотип, снизу — под окно меню */}
        <Rect x={0} y={0} width={W} height={H * 0.3}>
          <LinearGradient start={vec(0, 0)} end={vec(0, H * 0.3)} colors={['rgba(14,18,21,0.82)', 'rgba(14,18,21,0)']} />
        </Rect>
        <Rect x={0} y={H * 0.45} width={W} height={H * 0.55}>
          <LinearGradient start={vec(0, H * 0.45)} end={vec(0, H)} colors={['rgba(14,18,21,0)', 'rgba(14,18,21,0.88)']} />
        </Rect>
      </Canvas>
    </View>
  );
}
