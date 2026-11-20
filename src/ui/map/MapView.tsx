// Карта района на Skia (docs/02-architecture.md, §5): слои — готовые пути, камера — общие значения Reanimated.
// Сдвиг — одним пальцем, масштаб — двумя вокруг точки между ними; ширина дорог на экране не зависит от масштаба
// (издалека — тоньше). По образцу anamnez: src/render/map/BuildMap.tsx @ d05c615 (камера и жесты).
import { Canvas, Group, Path, Rect } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { type SharedValue, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import type { MapData } from '../../map/format';
import { T } from '../../i18n';
import { FONTS } from '../fonts';
import { C } from '../theme';
import { CASING_PX, MAP, ROAD_PX } from './palette';
import { cachedMapPaths } from './paths';

/** Во сколько раз можно приблизить от «район заполняет экран». */
const MAX_ZOOM = 12;
/** С какого приближения дороги рисуются полной шириной. */
const DETAIL = 4;

/** Сдвиг камеры так, чтобы район не уходил с экрана целиком. */
function clampPan(v: number, size: number, view: number, zoom: number): number {
  'worklet';
  const w = size * zoom;
  if (w <= view) return (view - w) / 2;
  return Math.min(0, Math.max(view - w, v));
}

/** Ширина линии в единицах карты: на экране — `px`, издалека — тоньше (до трети). */
function useWidth(zoom: SharedValue<number>, fit: number, px: number) {
  return useDerivedValue(() => {
    const k = Math.min(1, Math.max(0.35, zoom.get() / (fit * DETAIL)));
    return (px * k) / zoom.get();
  });
}

/** Слой знаков поверх улиц: рисуется в единицах карты, `zoom` — чтобы знаки держали свой размер на экране. */
export type MapOverlay = (zoom: SharedValue<number>) => React.ReactNode;

export function MapView({ map, width, height, testID, overlay, dusk = 0 }: { map: MapData; width: number; height: number; testID?: string; overlay?: MapOverlay; dusk?: number }) {
  const paths = useMemo(() => cachedMapPaths(map), [map]);
  // при открытии и при наибольшем отдалении карта заполняет экран целиком, без пустых полос
  const fit = Math.max(width / map.width, height / map.height);
  const zoom = useSharedValue(fit);
  // начало — середина района
  const tx = useSharedValue(clampPan((width - map.width * fit) / 2, map.width, width, fit));
  const ty = useSharedValue(clampPan((height - map.height * fit) / 2, map.height, height, fit));
  const start = useSharedValue([0, 0, fit, 0, 0]);

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => {
      'worklet';
      start.set([tx.get(), ty.get(), zoom.get(), 0, 0]);
    })
    .onUpdate(e => {
      'worklet';
      const s0 = start.get();
      tx.set(clampPan(s0[0] + e.translationX, map.width, width, zoom.get()));
      ty.set(clampPan(s0[1] + e.translationY, map.height, height, zoom.get()));
    });
  const pinch = Gesture.Pinch()
    .onStart(e => {
      'worklet';
      start.set([tx.get(), ty.get(), zoom.get(), e.focalX, e.focalY]);
    })
    .onUpdate(e => {
      'worklet';
      const s0 = start.get();
      const z = Math.min(fit * MAX_ZOOM, Math.max(fit, s0[2] * e.scale));
      const k = z / s0[2];
      zoom.set(z);
      tx.set(clampPan(e.focalX - (s0[3] - s0[0]) * k, map.width, width, z));
      ty.set(clampPan(e.focalY - (s0[4] - s0[1]) * k, map.height, height, z));
    });
  const gesture = Gesture.Simultaneous(pan, pinch);

  const transform = useDerivedValue(() => [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: zoom.get() }]);
  const w0 = useWidth(zoom, fit, ROAD_PX[0]);
  const w1 = useWidth(zoom, fit, ROAD_PX[1]);
  const w2 = useWidth(zoom, fit, ROAD_PX[2]);
  const w3 = useWidth(zoom, fit, ROAD_PX[3]);
  const c0 = useWidth(zoom, fit, ROAD_PX[0] + CASING_PX * 2);
  const c1 = useWidth(zoom, fit, ROAD_PX[1] + CASING_PX * 2);
  const c2 = useWidth(zoom, fit, ROAD_PX[2] + CASING_PX * 2);
  const rail = useWidth(zoom, fit, 1.2);

  return (
    <View testID={testID} style={[styles.box, { width, height }]}>
      <GestureDetector gesture={gesture}>
        <Canvas style={{ width, height }}>
          <Group transform={transform}>
            <Path path={paths.green} color={MAP.green} />
            <Path path={paths.water} color={MAP.water} />
            <Path path={paths.rail} color={MAP.rail} style="stroke" strokeWidth={rail} />
            <Path path={paths.roads[3]} color={MAP.road[3]} style="stroke" strokeWidth={w3} strokeCap="round" strokeJoin="round" />
            <Path path={paths.roads[2]} color={MAP.casing} style="stroke" strokeWidth={c2} strokeCap="round" strokeJoin="round" />
            <Path path={paths.roads[1]} color={MAP.casing} style="stroke" strokeWidth={c1} strokeCap="round" strokeJoin="round" />
            <Path path={paths.roads[0]} color={MAP.casing} style="stroke" strokeWidth={c0} strokeCap="round" strokeJoin="round" />
            <Path path={paths.roads[2]} color={MAP.road[2]} style="stroke" strokeWidth={w2} strokeCap="round" strokeJoin="round" />
            <Path path={paths.roads[1]} color={MAP.road[1]} style="stroke" strokeWidth={w1} strokeCap="round" strokeJoin="round" />
            <Path path={paths.roads[0]} color={MAP.road[0]} style="stroke" strokeWidth={w0} strokeCap="round" strokeJoin="round" />
          </Group>
          {/* свет часа (спецификация, §6): к вечеру карта темнеет, знаки поверх — нет */}
          {dusk > 0 ? <Rect x={0} y={0} width={width} height={height} color={MAP.night} opacity={dusk * MAP.nightMax} /> : null}
          <Group transform={transform}>{overlay ? overlay(zoom) : null}</Group>
        </Canvas>
      </GestureDetector>
      {/* ADR 0004: указание OpenStreetMap видно на карте всегда */}
      <Text style={styles.osm} testID="map-osm">{T.map.osm}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: MAP.land, overflow: 'hidden' },
  osm: { position: 'absolute', right: 6, bottom: 4, fontSize: 11, color: C.inkSoft, fontFamily: FONTS.body, backgroundColor: 'rgba(236,237,230,0.8)', paddingHorizontal: 4 },
});
