// Живая сцена за стеклом заглавного экрана (docs/08-game-design.md, §10: «за стеклом — живая сцена зала диспетчерской»;
// срез, часть С8б): зал, тёмный монитор с отсветом карты, край стола из Blender — тот же кадр, что у пульта; огонёк
// телефона мигает — на линии звонок. С «Меньше движения» огонёк просто горит. Только картинка: касаний у сцены нет.
import { Circle, Canvas, Group, Image, LinearGradient, RadialGradient, Rect, RoundedRect, useImage, vec } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLessMotion } from '../../ui/motion';
import { SCENE, UI } from '../palette';
import { pultLayout } from '../pult/layout';

const DESK = require('../../../assets/scenes/pult-desk.png');
/** Огонёк телефона: горит и гаснет, мс. */
const BLINK = 900;

export function TitleScene({ width: W, height: H }: { width: number; height: number }) {
  const L = useMemo(() => pultLayout(W, H), [W, H]);
  const desk = useImage(DESK);
  const less = useLessMotion();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (less) return;
    const id = setInterval(() => setOn(x => !x), BLINK);
    return () => clearInterval(id);
  }, [less]);
  const lit = less || on;
  const [lx, ly, lr] = L.phone.lamp;
  const mon = L.monitor;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="title-scene">
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={W} height={H}>
          <LinearGradient start={vec(0, 0)} end={vec(0, H)} colors={[SCENE.hallTop, SCENE.hallBottom]} />
        </Rect>
        {/* монитор: тёмный экран с отсветом карты района */}
        <RoundedRect x={mon.x} y={mon.y} width={mon.w} height={mon.h} r={10} color={SCENE.bezel} />
        <Rect x={L.screen.x} y={L.screen.y} width={L.screen.w} height={L.screen.h} color={UI.bg} />
        <Rect x={L.screen.x} y={L.screen.y} width={L.screen.w} height={L.screen.h}>
          <RadialGradient c={vec(W * 0.45, L.screen.y + L.screen.h * 0.45)} r={W * 0.9} colors={['rgba(126,166,201,0.16)', 'rgba(126,166,201,0)']} />
        </Rect>
        {desk ? <Image image={desk} x={L.desk.x} y={L.desk.y} width={L.desk.w} height={L.desk.h} fit="fill" /> : null}
        {lit ? (
          <Group>
            <Circle cx={lx} cy={ly} r={lr * 5}>
              <RadialGradient c={vec(lx, ly)} r={lr * 5} colors={['rgba(229,86,106,0.55)', 'rgba(229,86,106,0)']} />
            </Circle>
            <Circle cx={lx} cy={ly} r={lr * 1.1} color="#ff8a9a" />
          </Group>
        ) : null}
      </Canvas>
    </View>
  );
}
