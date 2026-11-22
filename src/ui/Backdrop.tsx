// Фон экранов программы (docs/13-art.md, §7): зал диспетчерской ночью — тот же кадр, что на заглавном экране
// (blender/title.py), размытый и приглушённый; поверх — затемнение сверху вниз, чтобы текст читался. Рисуется один раз,
// не каждый кадр. Только картинка: касаний нет, экранный диктор его не читает.
import { Blur, Canvas, Fill, Image, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import { useSkiaImage } from './skiaAssets';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SCENE } from '../scenes/palette';

export const HALL = require('../../assets/scenes/title-hall.jpg');

export function Backdrop({ blur = 14, dim = 0.62 }: { blur?: number; dim?: number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const hall = useSkiaImage(HALL);
  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden onLayout={e => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {size ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color={SCENE.hallTop} />
          {hall ? (
            <Image image={hall} x={-blur * 2} y={-blur * 2} width={size.w + blur * 4} height={size.h + blur * 4} fit="cover">
              <Blur blur={blur} mode="clamp" />
            </Image>
          ) : null}
          <Rect x={0} y={0} width={size.w} height={size.h}>
            <LinearGradient start={vec(0, 0)} end={vec(0, size.h)} colors={[`rgba(14,18,21,${dim})`, `rgba(14,18,21,${Math.min(1, dim + 0.22)})`]} />
          </Rect>
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { backgroundColor: SCENE.hallTop } });
