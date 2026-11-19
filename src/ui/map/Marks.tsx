// Знаки на карте (часть П3; docs/13-art.md, §1): подстанции, больницы, вызовы и бригады. Рисуются внутри группы
// камеры карты в её единицах, но держат свой размер на экране: группа знака делит масштаб на приближение. Положение
// бригад — общее значение, его каждый кадр пишет экран пульта (по пути и часам смены).
import { Circle, Group, Path, Rect, RoundedRect, type SkFont, type SkPath, Skia, Text } from '@shopify/react-native-skia';
import React from 'react';
import { type SharedValue, useDerivedValue } from 'react-native-reanimated';
import { MARK } from './palette';

export interface CrewMarkProps {
  i: number;
  pos: SharedValue<number[]>;
  zoom: SharedValue<number>;
  label: string;
  color: string;
  /** занятая бригада — квадрат, свободная — круг: цвет никогда не единственный знак */
  busy: boolean;
  font: SkFont | null;
  /** сдвиг на экране, точки: бригады в одном месте встают рядом, а не друг на друга */
  dx?: number;
  dy?: number;
}

export function CrewMark({ i, pos, zoom, label, color, busy, font, dx = 0, dy = 0 }: CrewMarkProps) {
  const transform = useDerivedValue(() => {
    const p = pos.get();
    return [{ translateX: p[i * 2] }, { translateY: p[i * 2 + 1] }, { scale: 1 / zoom.get() }, { translateX: dx }, { translateY: dy }];
  });
  const w = font ? font.getTextWidth(label) : 0;
  return (
    <Group transform={transform}>
      {busy ? (
        <>
          <RoundedRect x={-12} y={-12} width={24} height={24} r={6} color={MARK.halo} />
          <RoundedRect x={-10} y={-10} width={20} height={20} r={5} color={color} />
        </>
      ) : (
        <>
          <Circle cx={0} cy={0} r={12} color={MARK.halo} />
          <Circle cx={0} cy={0} r={10} color={color} />
        </>
      )}
      {font ? <Text x={-w / 2} y={4.5} text={label} font={font} color={MARK.label} /> : null}
    </Group>
  );
}

/** Неподвижный знак: подстанция (дом) или больница (буква H на квадрате). */
export function PlaceMark({ x, y, zoom, kind, font }: { x: number; y: number; zoom: SharedValue<number>; kind: 'base' | 'hospital'; font: SkFont | null }) {
  const transform = useDerivedValue(() => [{ translateX: x }, { translateY: y }, { scale: 1 / zoom.get() }]);
  if (kind === 'base') {
    const [h, halo] = housePaths();
    return (
      <Group transform={transform}>
        <Path path={halo} color={MARK.halo} />
        <Path path={h} color={MARK.base} />
      </Group>
    );
  }
  const w = font ? font.getTextWidth('H') : 0;
  return (
    <Group transform={transform}>
      <RoundedRect x={-10} y={-10} width={20} height={20} r={4} color={MARK.halo} />
      <Rect x={-8} y={-8} width={16} height={16} color={MARK.hospital} />
      {font ? <Text x={-w / 2} y={4.5} text="H" font={font} color={MARK.label} /> : null}
    </Group>
  );
}

/** Вызов: кольцо цвета формы и точка; у экстренного — двойное кольцо (форма, а не только цвет). */
export function CallMark({ x, y, zoom, color, emergency }: { x: number; y: number; zoom: SharedValue<number>; color: string; emergency: boolean }) {
  const transform = useDerivedValue(() => [{ translateX: x }, { translateY: y }, { scale: 1 / zoom.get() }]);
  return (
    <Group transform={transform}>
      <Circle cx={0} cy={0} r={14} color={color} style="stroke" strokeWidth={3} />
      {emergency ? <Circle cx={0} cy={0} r={19} color={color} style="stroke" strokeWidth={2} /> : null}
      <Circle cx={0} cy={0} r={4} color={color} />
    </Group>
  );
}

/** Путь бригады — линия по улицам; толщина на экране постоянна. */
export function RouteLine({ path, zoom, color }: { path: SkPath; zoom: SharedValue<number>; color: string }) {
  const width = useDerivedValue(() => 4 / zoom.get());
  return <Path path={path} color={color} style="stroke" strokeWidth={width} strokeCap="round" strokeJoin="round" opacity={0.8} />;
}

function house(s: number): SkPath {
  const b = Skia.PathBuilder.Make();
  b.moveTo(0, -11 * s);
  b.lineTo(10 * s, -2 * s);
  b.lineTo(10 * s, 9 * s);
  b.lineTo(-10 * s, 9 * s);
  b.lineTo(-10 * s, -2 * s);
  b.close();
  return b.detach();
}

// пути знаков — один раз, но не при загрузке модуля: в вебе Skia (CanvasKit) готова только к первому кадру
let houses: [SkPath, SkPath] | null = null;
function housePaths(): [SkPath, SkPath] {
  if (!houses) houses = [house(1), house(1.25)];
  return houses;
}
