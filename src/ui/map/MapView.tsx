// Карта района на Skia (docs/02-architecture.md, §5): слои — готовые пути, камера — общие значения Reanimated.
// Сдвиг — одним пальцем, масштаб — двумя вокруг точки между ними; ширина дорог на экране не зависит от масштаба
// (издалека — тоньше). По образцу anamnez: src/render/map/BuildMap.tsx @ d05c615 (камера и жесты).
//
// Два холста (0.10.1, по замеру на телефоне владельца): нижний — улицы, вода, зелень, железная дорога — не
// перерисовывается никогда, только камера двигает его матрицу; дороги — кусками по сетке района, и Skia не обводит
// куски за краем экрана. Верхний — свет часа и знаки смены: он перерисовывается, когда меняется смена, и больше не тянет
// за собой запись всей карты.
//
// Пока камера движется (палец, приближение, автопилот «Замера»), нижний холст рисует одну картинку района вместо сотен
// путей (0.10.2, по второму замеру: долгие кадры сдвига и приближения); камера встала на `IDLE_MS` — снова пути, чёткие
// на любом приближении. Так делают карты в телефонах: в движении при сильном приближении чуть мягче, на месте — чётко.
import { useLessMotion } from '../motion';
import { Canvas, Group, Image, Path, Rect, type SkImage, Skia, type Transforms3d } from '@shopify/react-native-skia';
import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { type SharedValue, useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { MapData } from '../../map/format';
import { T } from '../../i18n';
import { FONTS } from '../fonts';
import { C } from '../theme';
import { CASING_PX, MAP, ROAD_PX } from './palette';
import { cachedLampPaths, cachedMapImage, cachedMapPaths, type MapPaths } from './paths';
import { fitOf, roadWidth } from './scale';

/** Во сколько раз можно приблизить от «район заполняет экран». */
const MAX_ZOOM = 12;

/** Сдвиг камеры так, чтобы район не уходил с экрана целиком. */
function clampPan(v: number, size: number, view: number, zoom: number): number {
  'worklet';
  const w = size * zoom;
  if (w <= view) return (view - w) / 2;
  return Math.min(0, Math.max(view - w, v));
}

/** Ширина линии в единицах карты при текущем приближении (`roadWidth`). */
function useWidth(zoom: SharedValue<number>, fit: number, px: number) {
  return useDerivedValue(() => roadWidth(zoom.get(), fit, px));
}

/**
 * Автопилот камеры для «Замера» (спецификация прототипа, §8): `pan` — приближение ×3 и сдвиг по всему району,
 * `zoom` — от «район на экране» до ×8 и обратно вокруг середины; круг — 4 с. Камера движется на потоке интерфейса,
 * как от пальцев.
 */
export type Autopilot = 'pan' | 'zoom';
const LAP_MS = 4000;
/** Сколько камера должна стоять, мс, чтобы картинку района сменили чёткие пути. */
const IDLE_MS = 120;
/** Обрезка нижнего холста: в движении путей не видно — Skia отбрасывает их до растра; на месте — весь район. */
const NONE = Skia.XYWHRect(0, 0, 0, 0);

/** Слой знаков поверх улиц: рисуется в единицах карты, `zoom` — чтобы знаки держали свой размер на экране. */
export type MapOverlay = (zoom: SharedValue<number>) => React.ReactNode;

/** Улицы, вода, зелень и железная дорога: пропсы — готовые пути и общие значения камеры, поэтому холст не
 *  перерисовывается, когда перерисовывается то, что над ним. */
// стиль холста — плоским объектом: Canvas Skia в вебе кладёт его прямо в стиль элемента, массив там не годится
const MapLayers = memo(function MapLayers({ map, paths, image, width, height, transform, zoom, fit, motion }: {
  map: MapData; paths: MapPaths; image: SkImage | null; width: number; height: number; transform: SharedValue<Transforms3d>;
  zoom: SharedValue<number>; fit: number; motion: SharedValue<number>;
}) {
  const w0 = useWidth(zoom, fit, ROAD_PX[0]);
  const w1 = useWidth(zoom, fit, ROAD_PX[1]);
  const w2 = useWidth(zoom, fit, ROAD_PX[2]);
  const w3 = useWidth(zoom, fit, ROAD_PX[3]);
  const c0 = useWidth(zoom, fit, ROAD_PX[0] + CASING_PX * 2);
  const c1 = useWidth(zoom, fit, ROAD_PX[1] + CASING_PX * 2);
  const c2 = useWidth(zoom, fit, ROAD_PX[2] + CASING_PX * 2);
  const rail = useWidth(zoom, fit, 1.2);
  const t = paths.tiles;
  // картинки нет (нет поверхности) — пути рисуются и в движении
  const all = useMemo(() => Skia.XYWHRect(-map.width, -map.height, map.width * 3, map.height * 3), [map]);
  const has = image !== null;
  const clip = useDerivedValue(() => (has && motion.get() === 1 ? NONE : all));
  const shown = useDerivedValue(() => (has && motion.get() === 1 ? 1 : 0));
  const roads = (c: number, color: string, w: SharedValue<number>, key: string) =>
    t.roads[c].map((p, i) => <Path key={`${key}${i}`} path={p} color={color} style="stroke" strokeWidth={w} strokeCap="round" strokeJoin="round" />);
  return (
    <Canvas style={{ position: 'absolute', left: 0, top: 0, width, height }}>
      <Group transform={transform}>
        {image ? <Image image={image} x={0} y={0} width={map.width} height={map.height} fit="fill" opacity={shown} /> : null}
        <Group clip={clip}>
          <Path path={paths.green} color={MAP.green} />
          <Path path={paths.water} color={MAP.water} />
          {t.rail.map((p, i) => <Path key={`rl${i}`} path={p} color={MAP.rail} style="stroke" strokeWidth={rail} />)}
          {roads(3, MAP.road[3], w3, 'r3')}
          {roads(2, MAP.casing, c2, 'c2')}
          {roads(1, MAP.casing, c1, 'c1')}
          {roads(0, MAP.casing, c0, 'c0')}
          {roads(2, MAP.road[2], w2, 'r2')}
          {roads(1, MAP.road[1], w1, 'r1')}
          {roads(0, MAP.road[0], w0, 'r0')}
        </Group>
      </Group>
    </Canvas>
  );
});

/** Докат карты после пальца: наибольшая скорость, точек в секунду; затухание, 1/с; ниже этой скорости — стоп. */
const FLING_MAX = 2400;
const FLING_FRICTION = 5;
const FLING_STOP = 14;

/** Касание карты: точка в единицах карты и приближение (точек экрана на единицу карты) — чтобы найти знак под пальцем. */
export type MapTap = (x: number, y: number, zoom: number) => void;

export function MapView({ map, width, height, testID, overlay, dusk = 0, night = 0, autopilot, onTap }: { map: MapData; width: number; height: number; testID?: string; overlay?: MapOverlay; dusk?: number; night?: number; autopilot?: Autopilot; onTap?: MapTap }) {
  const lamps = night > 0 ? cachedLampPaths(map) : null;
  const paths = useMemo(() => cachedMapPaths(map), [map]);
  // при открытии и при наибольшем отдалении карта заполняет экран целиком, без пустых полос
  const fit = fitOf(map, width, height);
  const zoom = useSharedValue(fit);
  // начало — середина района
  const tx = useSharedValue(clampPan((width - map.width * fit) / 2, map.width, width, fit));
  const ty = useSharedValue(clampPan((height - map.height * fit) / 2, map.height, height, fit));
  const start = useSharedValue([0, 0, fit, 0, 0]);
  // камера движется: 1 — да (картинка района), 0 — стоит `IDLE_MS` и дольше (пути); сколько стоит, мс. Первые кадры
  // окна — картинкой: видеокарта получает её сразу при открытии, а не на первом движении пальца
  const motion = useSharedValue(1);
  const idle = useSharedValue(0);
  const image = useMemo(() => cachedMapImage(map, fit), [map, fit]);

  // карту отпустили на ходу — она докатывается и плавно встаёт (премиум-отделка); с «Меньше движения» встаёт сразу
  const less = useLessMotion();
  const vel = useSharedValue([0, 0]);

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => {
      'worklet';
      vel.set([0, 0]);
      start.set([tx.get(), ty.get(), zoom.get(), 0, 0]);
    })
    .onEnd(e => {
      'worklet';
      if (less) return;
      const cap = (v: number) => Math.max(-FLING_MAX, Math.min(FLING_MAX, v));
      vel.set([cap(e.velocityX), cap(e.velocityY)]);
    })
    .onUpdate(e => {
      'worklet';
      if (motion.get() !== 1) motion.set(1);
      idle.set(0);
      const s0 = start.get();
      tx.set(clampPan(s0[0] + e.translationX, map.width, width, zoom.get()));
      ty.set(clampPan(s0[1] + e.translationY, map.height, height, zoom.get()));
    });
  const pinch = Gesture.Pinch()
    .onStart(e => {
      'worklet';
      vel.set([0, 0]);
      start.set([tx.get(), ty.get(), zoom.get(), e.focalX, e.focalY]);
    })
    .onUpdate(e => {
      'worklet';
      if (motion.get() !== 1) motion.set(1);
      idle.set(0);
      const s0 = start.get();
      const z = Math.min(fit * MAX_ZOOM, Math.max(fit, s0[2] * e.scale));
      const k = z / s0[2];
      zoom.set(z);
      tx.set(clampPan(e.focalX - (s0[3] - s0[0]) * k, map.width, width, z));
      ty.set(clampPan(e.focalY - (s0[4] - s0[1]) * k, map.height, height, z));
    });
  // касание без сдвига — знак под пальцем (карточка бригады на пульте); сдвиг и приближение его отменяют
  const tap = Gesture.Tap()
    .maxDuration(300)
    .onEnd((e, ok) => {
      'worklet';
      if (!ok || !onTap) return;
      const z = zoom.get();
      scheduleOnRN(onTap, (e.x - tx.get()) / z, (e.y - ty.get()) / z, z);
    });
  const gesture = Gesture.Race(Gesture.Simultaneous(pan, pinch), tap);

  // камера встала на IDLE_MS — снова пути
  useFrameCallback(info => {
    'worklet';
    const v = vel.get();
    if (v[0] !== 0 || v[1] !== 0) {
      const dt = Math.min(info.timeSincePreviousFrame ?? 16, 48) / 1000;
      const x = clampPan(tx.get() + v[0] * dt, map.width, width, zoom.get());
      const y = clampPan(ty.get() + v[1] * dt, map.height, height, zoom.get());
      // упёрлась в край — по этой оси встала
      const k = Math.exp(-dt * FLING_FRICTION);
      const nx = x === tx.get() ? 0 : v[0] * k;
      const ny = y === ty.get() ? 0 : v[1] * k;
      tx.set(x);
      ty.set(y);
      vel.set(Math.abs(nx) + Math.abs(ny) < FLING_STOP ? [0, 0] : [nx, ny]);
      if (motion.get() !== 1) motion.set(1);
      idle.set(0);
      return;
    }
    if (motion.get() !== 1) return;
    const t = idle.get() + (info.timeSincePreviousFrame ?? 0);
    idle.set(t);
    if (t >= IDLE_MS) motion.set(0);
  }, true);

  useFrameCallback(info => {
    'worklet';
    if (!autopilot) return;
    if (motion.get() !== 1) motion.set(1);
    idle.set(0);
    const a = (2 * Math.PI * info.timeSinceFirstFrame) / LAP_MS;
    if (autopilot === 'pan') {
      const z = fit * 3;
      const cx = map.width * (0.5 + 0.35 * Math.sin(a));
      const cy = map.height * (0.5 + 0.35 * Math.sin(a * 0.7));
      zoom.set(z);
      tx.set(clampPan(width / 2 - cx * z, map.width, width, z));
      ty.set(clampPan(height / 2 - cy * z, map.height, height, z));
    } else {
      const z = fit * (1 + 3.5 * (1 - Math.cos(a)));
      zoom.set(z);
      tx.set(clampPan(width / 2 - (map.width / 2) * z, map.width, width, z));
      ty.set(clampPan(height / 2 - (map.height / 2) * z, map.height, height, z));
    }
  }, autopilot !== undefined);

  const transform = useDerivedValue<Transforms3d>(() => [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: zoom.get() }]);

  return (
    <View testID={testID} style={[styles.box, { width, height }]}>
      <GestureDetector gesture={gesture}>
        <View style={{ width, height }}>
          <MapLayers map={map} paths={paths} image={image} width={width} height={height} transform={transform} zoom={zoom} fit={fit} motion={motion} />
          <Canvas style={{ position: 'absolute', left: 0, top: 0, width, height }} pointerEvents="none">
            {/* свет часа (спецификация, §6): к вечеру карта темнеет, знаки поверх — нет */}
            {dusk > 0 ? <Rect x={0} y={0} width={width} height={height} color={MAP.night} opacity={dusk * MAP.nightMax + night * MAP.deepNight} /> : null}
            {/* ночь (срез, С6): фонари вдоль больших улиц — над затемнением, под знаками */}
            {lamps ? (
              <Group transform={transform} opacity={night}>
                <Path path={lamps.glow} color={MAP.lampGlow} opacity={MAP.lampGlowAlpha} />
                <Path path={lamps.core} color={MAP.lampCore} />
              </Group>
            ) : null}
            <Group transform={transform}>{overlay ? overlay(zoom) : null}</Group>
          </Canvas>
        </View>
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
