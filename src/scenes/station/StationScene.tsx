// Сцена «Станция» между сменами (срез, часть С2; ADR 0009; docs/08-game-design.md, §15): рабочее место из Blender
// (assets/scenes/station-desk.jpg, blender/station.py) — на столе письмо старшего врача, табель бригад, журнал фонда и
// укладка; за окном — двор подстанции с машинами. Skia пишет на листы то, что меняется: строки письма, табель следующей
// смены, фонд на наклейке журнала, бирку укладки. Касание предмета — прозрачная область над кадром с подписью для
// чтения с экрана; что по касанию открыть — решает экран (src/screens/StationScreen.tsx).
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_600SemiBold } from '@expo-google-fonts/onest/600SemiBold';
import { Canvas, Group, Image, LinearGradient, Rect, Skia, Text as SkText, type SkFont, useFont, useImage, vec } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { T } from '../../i18n';
import type { StationView } from '../../state/stationView';
import { C } from '../../ui/theme';
import { SCENE } from '../palette';
import { type Quad, quadMatrix } from '../pult/layout';
import { ITEMS, SHEET, type StationItem, stationLayout } from './layout';

const FRAME = require('../../../assets/scenes/station-desk.jpg');

/** Чернила на бумаге: синие строки, кумач — жалобы и пустые укладки. */
const INK = '#23324a';
const RED = C.kumach;

interface Line {
  text: string;
  font: SkFont | null;
  color?: string;
}

/** Строки на листе: пишутся в местных точках листа, матрица кладёт их в перспективу кадра. */
function Sheet({ item, quad, lines, pad = 14, gap = 6 }: { item: StationItem; quad: Quad; lines: Line[]; pad?: number; gap?: number }) {
  const { w, h } = SHEET[item];
  const m = useMemo(() => Skia.Matrix(quadMatrix(w, h, quad)), [w, h, quad]);
  // строки сверху вниз: низ строки — сумма высот предыдущих и промежутков
  const tops = lines.reduce<number[]>((acc, l, i) => [...acc, (i ? acc[i - 1] + gap : pad) + (l.font?.getSize() ?? 0)], []);
  return (
    <Group matrix={m}>
      {lines.map((l, i) => (l.font && tops[i] <= h - 4 ? <SkText key={i} x={pad} y={tops[i]} text={l.text} font={l.font} color={l.color ?? INK} /> : null))}
    </Group>
  );
}

export interface StationSceneProps {
  width: number;
  height: number;
  view: StationView;
  onItem: (it: StationItem) => void;
}

export function StationScene({ width: W, height: H, view, onItem }: StationSceneProps) {
  const L = useMemo(() => stationLayout(W, H), [W, H]);
  const frame = useImage(FRAME);
  const head = useFont(Onest_600SemiBold, 24);
  const body = useFont(Onest_400Regular, 22);
  const row = useFont(Onest_400Regular, 21);
  const big = useFont(Onest_600SemiBold, 30);
  const tag = useFont(Onest_600SemiBold, 16);
  const on = T.station.on;
  const letter = view.letter;
  const complaints = letter ? letter.longWaits + letter.refusals : 0;
  const letterLines: Line[] = letter
    ? [
        { text: on.letterHead, font: head },
        { text: on.letterScore(letter.n, letter.inNorm, letter.emergency), font: body },
        ...(letter.thanks ? [{ text: on.letterThanks, font: body }] : []),
        ...(complaints ? [{ text: on.letterComplaints(complaints), font: body, color: RED }] : []),
      ]
    : [{ text: on.letterHead, font: head }, { text: on.letterNone, font: body }];
  const rosterLines: Line[] = view.next
    ? [{ text: on.rosterHead(view.next.n), font: head }, ...view.next.roster.map(r => ({ text: on.rosterRow(r.no, r.base, r.kit, view.num.kit), font: row, color: r.kit ? INK : RED }))]
    : [{ text: on.rosterDone, font: head }];
  const ledgerLines: Line[] = [{ text: on.ledgerHead, font: tag }, { text: T.station.price(view.fund), font: big, color: view.fund < 0 ? RED : INK }];
  const bagLines: Line[] = [{ text: on.bagHead, font: tag }, { text: view.short.length ? on.bagShort(view.short.length) : on.bagFull, font: tag, color: view.short.length ? RED : INK }];
  const labels: Record<StationItem, string> = T.station.items;

  return (
    <View style={{ width: W, height: H }} testID="station-scene">
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Canvas style={StyleSheet.absoluteFill}>
          <Rect x={0} y={0} width={W} height={H}>
            <LinearGradient start={vec(0, 0)} end={vec(0, H)} colors={[SCENE.hallTop, SCENE.hallBottom]} />
          </Rect>
          {frame ? <Image image={frame} x={L.frame.x} y={L.frame.y} width={L.frame.w} height={L.frame.h} fit="fill" /> : null}
          <Sheet item="letter" quad={L.quad.letter} lines={letterLines} />
          <Sheet item="roster" quad={L.quad.roster} lines={rosterLines} gap={4} />
          <Sheet item="ledger" quad={L.quad.ledger} lines={ledgerLines} pad={10} gap={4} />
          <Sheet item="bag" quad={L.quad.bag} lines={bagLines} pad={6} gap={2} />
        </Canvas>
      </View>
      {ITEMS.map(it => (
        <Pressable
          key={it}
          onPress={() => onItem(it)}
          accessibilityRole="button"
          accessibilityLabel={labels[it]}
          testID={`station-${it}`}
          style={[styles.tap, { left: L.tap[it].x, top: L.tap[it].y, width: L.tap[it].w, height: L.tap[it].h }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ tap: { position: 'absolute' } });
