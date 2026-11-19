// Сцена «Пульт» (ADR 0009; docs/08-game-design.md, §10): монитор с живой картой района почти на весь экран, над картой —
// строка программы (часы смены, скорость, линия), под картой — вызовы, ждущие бригаду; внизу — край стола из Blender
// (assets/scenes/pult-desk.png, blender/pult.py) с телефоном и рацией. Skia рисует поверх кадра то, что меняется:
// огонёк линии, экранчики телефона и рации, строку рации. Касание телефона, рации и часов — прозрачные области над
// кадром с подписями для чтения с экрана.
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { Onest_600SemiBold } from '@expo-google-fonts/onest/600SemiBold';
import {
  Canvas,
  Circle,
  Group,
  Image,
  LinearGradient,
  RadialGradient,
  Rect,
  RoundedRect,
  Skia,
  Text as SkText,
  type SkFont,
  useFont,
  useImage,
  vec,
} from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { T } from '../../i18n';
import type { MapData } from '../../map/format';
import { type MapOverlay, MapView } from '../../ui/map/MapView';
import { FORM, SCENE, UI } from '../palette';
import { type Quad, type Rect as Box, pultLayout, quadMatrix } from './layout';

const DESK = require('../../../assets/scenes/pult-desk.png');

/** Местные размеры экранчиков: текст пишется в них, матрица кладёт его в перспективу кадра. */
const LCD = { w: 200, h: 56 } as const;

/** Вызов, ждущий бригаду, — плашка под картой. */
export interface WaitingTile {
  id: string;
  kind: 'emergency' | 'urgent';
  /** сколько ждёт, игровых минут */
  minutes: number;
}

export interface PultProps {
  width: number;
  height: number;
  map: MapData;
  /** секунды от полуночи — часы смены */
  clock: number;
  /** скорость смены: 0 — пауза */
  speed: number;
  /** звонков на линии */
  line: number;
  waiting: readonly WaitingTile[];
  /** последняя строка рации или пусто */
  radio: { crew: number; what: 'scene' | 'base' } | null;
  overlay?: MapOverlay;
  onPhone: () => void;
  onRadio: () => void;
  onClock: () => void;
  onSpeed: () => void;
}

function Lcd({ quad, font, back, ink, text }: { quad: Quad; font: SkFont | null; back: string; ink: string; text: string }) {
  const m = useMemo(() => Skia.Matrix(quadMatrix(LCD.w, LCD.h, quad)), [quad]);
  return (
    <Group matrix={m}>
      <Rect x={0} y={0} width={LCD.w} height={LCD.h} color={back} />
      <Rect x={0} y={0} width={LCD.w} height={LCD.h}>
        <LinearGradient start={vec(0, 0)} end={vec(0, LCD.h)} colors={['rgba(255,255,255,0.18)', 'rgba(0,0,0,0.12)']} />
      </Rect>
      {font ? <SkText x={10} y={LCD.h * 0.68} text={text} font={font} color={ink} /> : null}
    </Group>
  );
}

function width(font: SkFont | null, s: string) {
  return font ? font.getTextWidth(s) : 0;
}

export function PultScene({ width: W, height: H, map, clock, speed, line, waiting, radio, overlay, onPhone, onRadio, onClock, onSpeed }: PultProps) {
  const L = useMemo(() => pultLayout(W, H), [W, H]);
  const desk = useImage(DESK);
  const bar = useFont(Onest_500Medium, 15);
  const small = useFont(Onest_400Regular, 12);
  const head = useFont(Onest_500Medium, 12);
  const tile = useFont(Onest_500Medium, 13);
  const lcd = useFont(Onest_600SemiBold, 28);
  const lineText = T.pult.line(line);
  const paused = speed === 0;
  const clockText = T.pult.clock(clock);
  const speedText = paused ? T.pult.paused : T.pult.speed(speed);
  const speedX = 34 + width(bar, clockText) + 14;
  const radioSays = radio ? T.pult.radioSays(radio.crew, radio.what) : null;
  const mon = L.monitor;
  const deskBack = L.desk.y + L.desk.h * 0.24;
  const deskFront = L.desk.y + L.desk.h * 0.9;
  const [lx, ly, lr] = L.phone.lamp;
  const radioTop = L.radio.tap.y;
  const bubbleW = width(tile, radioSays ?? '') + 20;
  const bubbleX = Math.min(W - bubbleW - 8, L.radio.tap.x + L.radio.tap.w / 2 - bubbleW / 2);

  return (
    <View style={{ width: W, height: H }} testID="pult">
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Canvas style={StyleSheet.absoluteFill}>
          {/* зал над монитором, перегородка за столом, темнота под столом */}
          <Rect x={0} y={0} width={W} height={H}>
            <LinearGradient start={vec(0, 0)} end={vec(0, H)} colors={[SCENE.hallTop, SCENE.hallBottom]} />
          </Rect>
          <Rect x={0} y={mon.y + mon.h} width={W} height={deskBack - mon.y - mon.h + 4}>
            <LinearGradient start={vec(0, mon.y + mon.h)} end={vec(0, deskBack)} colors={[SCENE.partitionShade, SCENE.partition]} />
          </Rect>
          <Rect x={0} y={deskFront} width={W} height={H - deskFront} color={SCENE.underDesk} />
          {/* монитор: рамка уходит за края экрана — сидим близко */}
          <RoundedRect x={mon.x} y={mon.y} width={mon.w} height={mon.h} r={10} color={SCENE.bezel} />
          <RoundedRect x={mon.x} y={mon.y} width={mon.w} height={mon.h} r={10} color={SCENE.bezelEdge} style="stroke" strokeWidth={1} />
          <Rect x={L.screen.x} y={L.screen.y} width={L.screen.w} height={L.screen.h} color={UI.bg} />
          <Circle cx={W * 0.86} cy={mon.y + mon.h - 9} r={2} color={SCENE.led} />
        </Canvas>
      </View>

      <View style={[styles.abs, { left: L.map.x, top: L.map.y }]}>
        <MapView map={map} width={L.map.w} height={L.map.h} testID="map-view" overlay={overlay} />
      </View>

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Canvas style={StyleSheet.absoluteFill}>
          {/* строка программы: часы смены и скорость, линия */}
          <Rect x={L.bar.x} y={L.bar.y} width={L.bar.w} height={L.bar.h} color={UI.bg} />
          <Rect x={L.bar.x} y={L.bar.y + L.bar.h - 1} width={L.bar.w} height={1} color={UI.line} />
          <Rect x={14} y={L.bar.y + 12} width={4} height={14} color={paused ? UI.amber : UI.dim} />
          <Rect x={21} y={L.bar.y + 12} width={4} height={14} color={paused ? UI.amber : UI.dim} />
          {bar ? <SkText x={34} y={L.bar.y + 25} text={clockText} font={bar} color={UI.text} /> : null}
          <RoundedRect x={speedX - 8} y={L.bar.y + 8} width={width(bar, speedText) + 16} height={L.bar.h - 16} r={8} color={paused ? UI.amber : UI.panel} />
          {bar ? <SkText x={speedX} y={L.bar.y + 25} text={speedText} font={bar} color={paused ? UI.bg : UI.text} /> : null}
          {bar ? <SkText x={W - 14 - width(bar, lineText)} y={L.bar.y + 25} text={lineText} font={bar} color={line > 0 ? UI.red : UI.dim} /> : null}

          {/* вызовы, ждущие бригаду */}
          <Rect x={L.waiting.x} y={L.waiting.y} width={L.waiting.w} height={L.waiting.h} color={UI.bg} />
          <Rect x={L.waiting.x} y={L.waiting.y} width={L.waiting.w} height={1} color={UI.line} />
          {head ? <SkText x={12} y={L.waiting.y + 16} text={T.pult.waitingHead} font={head} color={UI.dim} /> : null}
          {!waiting.length && small ? <SkText x={12} y={L.waiting.y + 44} text={T.pult.waitingNone} font={small} color={UI.dim} /> : null}
          {waiting.slice(0, 2).map((c, i) => {
            const [letter, form] = T.pult.forms[c.kind];
            const n = T.pult.callNo(c.id);
            const waited = T.pult.waited(c.minutes);
            const kind = c.kind;
            const tw = (W - 12 * 3) / 2;
            const x = 12 + i * (tw + 12);
            const y = L.waiting.y + 22;
            return (
              <Group key={c.id}>
                <RoundedRect x={x} y={y} width={tw} height={38} r={6} color={UI.panel} />
                <Circle cx={x + 15} cy={y + 19} r={10} color={FORM[kind]} />
                {tile ? <SkText x={x + 15 - width(tile, letter) / 2} y={y + 23.5} text={letter} font={tile} color={UI.bg} /> : null}
                {tile ? <SkText x={x + 32} y={y + 16} text={`${n} · ${form}`} font={tile} color={UI.text} /> : null}
                {small ? <SkText x={x + 32} y={y + 31} text={waited} font={small} color={UI.dim} /> : null}
              </Group>
            );
          })}

          {/* блик на стекле монитора */}
          <Rect x={L.screen.x} y={L.screen.y} width={L.screen.w} height={L.screen.h}>
            <LinearGradient start={vec(0, L.screen.y)} end={vec(W, L.screen.y + L.screen.h)} colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.03)']} positions={[0, 0.5, 1]} />
          </Rect>

          {/* край стола из Blender */}
          {desk ? <Image image={desk} x={L.desk.x} y={L.desk.y} width={L.desk.w} height={L.desk.h} fit="fill" /> : null}

          {/* телефон: огонёк линии и экранчик */}
          <Lcd quad={L.phone.lcd} font={lcd} back={SCENE.lcdPhone} ink={SCENE.lcdPhoneInk} text={T.pult.phoneLcd(line)} />
          {line > 0 ? (
            <Group>
              <Circle cx={lx} cy={ly} r={lr * 5}>
                <RadialGradient c={vec(lx, ly)} r={lr * 5} colors={['rgba(229,86,106,0.55)', 'rgba(229,86,106,0)']} />
              </Circle>
              <Circle cx={lx} cy={ly} r={lr * 1.1} color="#ff8a9a" />
            </Group>
          ) : null}

          {/* рация: экранчик и последняя строка бригады */}
          <Lcd quad={L.radio.lcd} font={lcd} back={SCENE.lcdRadio} ink={SCENE.lcdRadioInk} text={radio ? T.pult.radioLcd(radio.crew, radio.what) : T.pult.radioIdle} />
          {radioSays ? <RoundedRect x={bubbleX} y={radioTop - 34} width={bubbleW} height={26} r={13} color={UI.panel} opacity={0.94} /> : null}
          {radioSays && tile ? <SkText x={bubbleX + 10} y={radioTop - 16.5} text={radioSays} font={tile} color={UI.text} /> : null}
        </Canvas>
      </View>

      <Pressable style={[styles.abs, box(L.phone.tap)]} onPress={onPhone} accessibilityRole="button" accessibilityLabel={T.pult.phoneLabel(line)} testID="pult-phone" />
      <Pressable style={[styles.abs, box(L.radio.tap)]} onPress={onRadio} accessibilityRole="button" accessibilityLabel={T.pult.radioLabel} testID="pult-radio" />
      <Pressable style={[styles.abs, { left: 0, top: L.bar.y, width: speedX - 10, height: L.bar.h }]} onPress={onClock} accessibilityRole="button" accessibilityLabel={T.pult.clockLabel} testID="pult-clock" />
      <Pressable style={[styles.abs, { left: speedX - 10, top: L.bar.y, width: width(bar, speedText) + 20, height: L.bar.h }]} onPress={onSpeed} accessibilityRole="button" accessibilityLabel={T.pult.speedLabel} testID="pult-speed" />
    </View>
  );
}

function box(r: Box) {
  return { left: r.x, top: r.y, width: r.w, height: r.h };
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
});
