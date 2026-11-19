// Сцена «Разговор» (ADR 0009; docs/08-game-design.md, §10): сверху — звонящий там, откуда звонит (картинка из Blender
// с человеком Rocketbox, blender/caller.py), его ответы — строкой поверх; ниже — монитор с опросником программы:
// карточка вызова, вопросы с ценой в игровых секундах и решение — форма вызова. На месте диспетчера Московской
// станции «на одном мониторе опросник пациента» (docs/09-content.md, `mosmed-2024`).
// Пока смены нет (П5), сцена играет пример из src/i18n: вопрос заполняет поле карточки и двигает счётчик на линии.
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { Onest_600SemiBold } from '@expo-google-fonts/onest/600SemiBold';
import { Canvas, Group, Image, LinearGradient, Rect, RoundedRect, Text as SkText, type SkFont, useFont, useImage, vec } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { T } from '../../i18n';
import { FORM, SCENE, UI } from '../palette';
import { callLayout } from './layout';

const PICTURE = require('../../../assets/scenes/caller-daughter.jpg');

export interface CallProps {
  width: number;
  height: number;
  /** какие вопросы заданы (номера в T.call.questions) */
  asked: readonly number[];
  /** секунды на линии */
  seconds: number;
  onAsk: (i: number) => void;
  onForm: (kind: 'emergency' | 'urgent' | 'none') => void;
}

const tw = (f: SkFont | null, s: string) => (f ? f.getTextWidth(s) : 0);

export function CallScene({ width: W, height: H, asked, seconds, onAsk, onForm }: CallProps) {
  const L = useMemo(() => callLayout(W, H), [W, H]);
  const picture = useImage(PICTURE);
  const big = useFont(Onest_500Medium, 17);
  const mid = useFont(Onest_500Medium, 14);
  const small = useFont(Onest_400Regular, 12);
  const bold = useFont(Onest_600SemiBold, 14);
  const last = asked.length ? T.call.questions[asked[asked.length - 1]][4] : T.call.first;
  // поля карточки: адрес и кто звонит — всегда, остальные — последние, сколько помещается над вопросами
  const all = [...T.call.fields, ...asked.map(i => [T.call.questions[i][2], T.call.questions[i][3]] as const)];
  const rows = Math.max(3, Math.floor((L.tabs.y - L.fields.y - 4) / L.fieldStep));
  const fields = all.length <= rows ? all : [...all.slice(0, 2), ...all.slice(all.length - (rows - 2))];
  const bubbleW = Math.min(W - 24, tw(big, last) + 28);

  return (
    <View style={{ width: W, height: H }} testID="call">
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Canvas style={StyleSheet.absoluteFill}>
          <Rect x={0} y={0} width={W} height={H} color={SCENE.hallTop} />
          {/* звонящий: картинка по ширине, лицо — в верхней трети */}
          {picture ? <Image image={picture} x={L.picture.x} y={L.picture.y} width={L.picture.w} height={L.picture.h} fit="cover" /> : null}
          <Rect x={0} y={L.picture.y + L.picture.h * 0.55} width={W} height={L.picture.h * 0.45 + 2}>
            <LinearGradient start={vec(0, L.picture.y + L.picture.h * 0.55)} end={vec(0, L.picture.y + L.picture.h)} colors={['rgba(14,18,21,0)', 'rgba(14,18,21,0.92)']} />
          </Rect>
          {/* что сказал звонящий */}
          {small ? <SkText x={16} y={L.bubble.y - 8} text={T.call.who} font={small} color={UI.dim} /> : null}
          <RoundedRect x={12} y={L.bubble.y} width={bubbleW} height={L.bubble.h} r={16} color={UI.text} opacity={0.96} />
          {big ? <SkText x={26} y={L.bubble.y + L.bubble.h / 2 + 6} text={last} font={big} color={UI.bg} /> : null}

          {/* монитор с опросником */}
          <RoundedRect x={L.monitor.x} y={L.monitor.y} width={L.monitor.w} height={L.monitor.h} r={12} color={SCENE.bezel} />
          <Rect x={L.screen.x} y={L.screen.y} width={L.screen.w} height={L.screen.h} color={UI.bg} />
          <Rect x={L.screen.x} y={L.screen.y} width={L.screen.w} height={34} color={UI.panel} />
          {mid ? <SkText x={L.screen.x + 12} y={L.screen.y + 22} text={T.call.head} font={mid} color={UI.text} /> : null}
          {mid ? <SkText x={L.screen.x + L.screen.w - 12 - tw(mid, T.call.timer(seconds))} y={L.screen.y + 22} text={T.call.timer(seconds)} font={mid} color={UI.amber} /> : null}
          {fields.map(([k, v], i) => {
            const y = L.fields.y + 18 + i * L.fieldStep;
            return (
              <Group key={k}>
                {small ? <SkText x={L.screen.x + 12} y={y} text={k} font={small} color={UI.dim} /> : null}
                {mid ? <SkText x={L.screen.x + 100} y={y} text={v} font={mid} color={UI.text} /> : null}
                <Rect x={L.screen.x + 12} y={y + 6} width={L.screen.w - 24} height={1} color={UI.line} />
              </Group>
            );
          })}
          {/* группы вопросов — вкладки опросника */}
          {T.call.groups.slice(0, 3).map((g, i) => {
            const x = L.tabs.x + L.tabs.step.reduce((a, s, j) => (j < i ? a + s : a), 0);
            const wTab = L.tabs.step[i] - 6;
            return (
              <Group key={g}>
                <RoundedRect x={x} y={L.tabs.y} width={wTab} height={26} r={13} color={i === 1 ? UI.line : UI.panel} />
                {small ? <SkText x={x + 10} y={L.tabs.y + 17} text={g} font={small} color={i === 1 ? UI.text : UI.dim} /> : null}
              </Group>
            );
          })}
          {/* вопросы: текст и цена; заданный — приглушён */}
          {T.call.questions.map(([q, cost], i) => {
            const r = L.questions[i];
            const done = asked.includes(i);
            return (
              <Group key={q} opacity={done ? 0.45 : 1}>
                <RoundedRect x={r.x} y={r.y} width={r.w} height={r.h} r={10} color={UI.panel} />
                <RoundedRect x={r.x} y={r.y} width={r.w} height={r.h} r={10} color={UI.line} style="stroke" strokeWidth={1} />
                {mid ? <SkText x={r.x + 12} y={r.y + r.h / 2 + 5} text={q} font={mid} color={UI.text} /> : null}
                {small ? <SkText x={r.x + r.w - 10 - tw(small, T.call.cost(cost))} y={r.y + r.h / 2 + 4} text={T.call.cost(cost)} font={small} color={UI.amber} /> : null}
              </Group>
            );
          })}
          {/* решение: форма вызова — цвет и буква */}
          {T.call.forms.map(([letter, name, kind], i) => {
            const r = L.forms[i];
            const color = kind === 'none' ? UI.dim : FORM[kind];
            return (
              <Group key={kind}>
                <RoundedRect x={r.x} y={r.y} width={r.w} height={r.h} r={10} color={color} opacity={kind === 'none' ? 0.35 : 1} />
                {bold ? <SkText x={r.x + r.w / 2 - tw(bold, `${letter}  ${name}`) / 2} y={r.y + r.h / 2 + 5} text={`${letter}  ${name}`} font={bold} color={kind === 'none' ? UI.text : UI.bg} /> : null}
              </Group>
            );
          })}
        </Canvas>
      </View>

      {T.call.questions.map(([q, cost], i) => (
        <Pressable
          key={q}
          style={[styles.abs, { left: L.questions[i].x, top: L.questions[i].y, width: L.questions[i].w, height: L.questions[i].h }]}
          onPress={() => onAsk(i)}
          disabled={asked.includes(i)}
          accessibilityRole="button"
          accessibilityLabel={T.call.questionLabel(q, cost)}
          testID={`call-q-${i}`}
        />
      ))}
      {T.call.forms.map(([, name, kind], i) => (
        <Pressable
          key={kind}
          style={[styles.abs, { left: L.forms[i].x, top: L.forms[i].y, width: L.forms[i].w, height: L.forms[i].h }]}
          onPress={() => onForm(kind)}
          accessibilityRole="button"
          accessibilityLabel={T.call.formLabel(name)}
          testID={`call-form-${kind}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
});
