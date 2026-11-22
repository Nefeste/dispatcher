// Знаки на карте (часть П3; docs/13-art.md, §1): подстанции, больницы, вызовы и бригады. Рисуются внутри группы
// камеры карты в её единицах, но держат свой размер на экране: группа знака делит масштаб на приближение. Положение
// бригад — общее значение, его каждый кадр пишет экран пульта (по пути и часам смены).
import { Circle, Group, Path, Rect, RoundedRect, type SkFont, type SkPath, Skia, Text } from '@shopify/react-native-skia';
import React from 'react';
import { type SharedValue, useDerivedValue } from 'react-native-reanimated';
import { MARK, VAN } from './palette';

export interface CrewMarkProps {
  i: number;
  pos: SharedValue<number[]>;
  zoom: SharedValue<number>;
  label: string;
  color: string;
  /** занятая бригада — машина с маячками на крыше, свободная — без: цвет никогда не единственный знак */
  busy: boolean;
  /** едет на вызов или везёт в больницу — маячки горят */
  siren: boolean;
  /** такт маячков: 0 — горит синий, 1 — красный, −1 — оба ровно («Меньше движения») */
  blink: SharedValue<number>;
  font: SkFont | null;
  /** сдвиг на экране, точки: бригады в одном месте встают рядом, а не друг на друга */
  dx?: number;
  dy?: number;
}

/** Бригада — машина скорой сбоку, цвета своего состояния, с номером на кузове. У занятой на крыше — маячки; едет на
 *  вызов или в больницу — маячки мигают синим и красным по очереди. Мигание — отклик на то, что игрок послал бригаду
 *  (устав, ADR 0023, правило 6); «Меньше движения» — горят ровно. */
export function CrewMark({ i, pos, zoom, label, color, busy, siren, blink, font, dx = 0, dy = 0 }: CrewMarkProps) {
  const transform = useDerivedValue(() => {
    const p = pos.get();
    return [{ translateX: p[i * 2] }, { translateY: p[i * 2 + 1] }, { scale: 1 / zoom.get() }, { translateX: dx }, { translateY: dy }];
  });
  const blue = useDerivedValue(() => (siren && blink.get() !== 1 ? VAN.blue : VAN.blueOff));
  const red = useDerivedValue(() => (siren && blink.get() !== 0 ? VAN.red : VAN.redOff));
  const glowBlue = useDerivedValue(() => (siren && blink.get() === 0 ? 0.45 : 0));
  const glowRed = useDerivedValue(() => (siren && blink.get() === 1 ? 0.45 : 0));
  const [body, glass] = vanPaths();
  const w = font ? font.getTextWidth(label) : 0;
  return (
    <Group transform={transform}>
      {busy ? (
        <Group>
          <Circle cx={-5.5} cy={-14} r={7} color={VAN.blue} opacity={glowBlue} />
          <Circle cx={-0.5} cy={-14} r={7} color={VAN.red} opacity={glowRed} />
          <RoundedRect x={-9.5} y={-17} width={13} height={6} r={2} color={MARK.halo} />
          <RoundedRect x={-8.5} y={-16} width={5.5} height={4} r={1.2} color={blue} />
          <RoundedRect x={-2.5} y={-16} width={5.5} height={4} r={1.2} color={red} />
        </Group>
      ) : null}
      <Path path={body} color={MARK.halo} style="stroke" strokeWidth={3.5} strokeJoin="round" />
      <Path path={body} color={color} />
      <Path path={glass} color={VAN.glass} opacity={0.9} />
      {[-8.5, 8.5].map(x => (
        <Group key={x}>
          <Circle cx={x} cy={5.5} r={4} color={MARK.halo} />
          <Circle cx={x} cy={5.5} r={2.8} color={VAN.wheel} />
        </Group>
      ))}
      {font ? <Text x={-4.5 - w / 2} y={1.8} text={label} font={font} color={MARK.label} /> : null}
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

/** Машина скорой сбоку, мордой вправо: кузов-фургон, скос лобового стекла, капот; центр — середина кузова. */
function van(): [SkPath, SkPath] {
  const b = Skia.PathBuilder.Make();
  b.moveTo(-16, -8.5);
  b.lineTo(-14, -10.5);
  b.lineTo(4, -10.5);
  b.lineTo(8.5, -2.5);
  b.lineTo(14.5, -1.5);
  b.lineTo(16, 0.5);
  b.lineTo(16, 5);
  b.lineTo(-16, 5);
  b.close();
  const g = Skia.PathBuilder.Make();
  g.moveTo(4.5, -9);
  g.lineTo(7.8, -2.6);
  g.lineTo(4.5, -2.6);
  g.close();
  return [b.detach(), g.detach()];
}

// пути знаков — один раз, но не при загрузке модуля: в вебе Skia (CanvasKit) готова только к первому кадру
let vans: [SkPath, SkPath] | null = null;
function vanPaths(): [SkPath, SkPath] {
  if (!vans) vans = van();
  return vans;
}

let houses: [SkPath, SkPath] | null = null;
function housePaths(): [SkPath, SkPath] {
  if (!houses) houses = [house(1), house(1.25)];
  return houses;
}
