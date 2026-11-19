// Сцена «Разговор» (ADR 0009; docs/08-game-design.md, §3–§4, §10): сверху — звонящий там, откуда звонит (картинка из
// Blender с человеком Rocketbox, blender/caller.py), его последние слова — поверх; ниже — монитор с опросником
// программы: карточка вызова, вкладки групп вопросов, вопросы с ценой в игровых секундах и решение — форма вызова.
// После решения на месте вопросов — кого послать. Сцена получает вид вызова (src/state/callView.ts): правды о больном
// в ней нет (ADR 0005).
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { Onest_600SemiBold } from '@expo-google-fonts/onest/600SemiBold';
import { Canvas, Group, Image, LinearGradient, Rect, RoundedRect, Text as SkText, type SkFont, useFont, useImage, vec } from '@shopify/react-native-skia';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { QuestionGroup } from '../../content/types';
import { T } from '../../i18n';
import type { CallView } from '../../state/callView';
import { ProgramPanel } from '../panel';
import { FORM, SCENE, UI } from '../palette';
import { callLayout, fit, wrap } from './layout';

/** Картинки звонящих (assets/scenes/callers.json) — по имени из записи звонящего. */
const PICTURES: Record<string, number> = { daughter: require('../../../assets/scenes/caller-daughter.jpg') };

export interface CallProps {
  width: number;
  height: number;
  view: CallView;
  onAsk: (q: string) => void;
  onForm: (kind: 'emergency' | 'urgent' | 'none') => void;
  onSend: (crew: string) => void;
  onHold: () => void;
}

const tw = (f: SkFont | null, s: string) => (f ? f.getTextWidth(s) : s.length * 7);

export function CallScene({ width: W, height: H, view, onAsk, onForm, onSend, onHold }: CallProps) {
  const L = useMemo(() => callLayout(W, H), [W, H]);
  const [group, setGroup] = useState<QuestionGroup>('vital');
  const picture = useImage(view.picture ? (PICTURES[view.picture] ?? null) : null);
  const big = useFont(Onest_500Medium, 16);
  const mid = useFont(Onest_500Medium, 13);
  const small = useFont(Onest_400Regular, 12);
  const bold = useFont(Onest_600SemiBold, 14);
  const title = useFont(Onest_500Medium, 30);
  const hasPicture = Boolean(view.picture && PICTURES[view.picture]);
  const bubbleMax = W - 24 - 28;
  const lines = wrap(T.call.quote(view.said), bubbleMax, s => tw(big, s), 3);
  const bubbleW = Math.min(W - 24, Math.max(...lines.map(l => tw(big, l))) + 28);
  const bubbleH = lines.length * 20 + 16;
  const bubbleY = L.picture.h - bubbleH - 14;
  const whoWord = `${view.who.charAt(0).toUpperCase()}${view.who.slice(1)}`;
  const who = `${whoWord}${view.repeat ? ` · ${T.call.repeat}` : ''}`;
  const timer = T.call.timer(view.seconds);
  // карточка: повод — всегда, дальше — последние ответы, сколько помещается
  const rows = view.rows.length <= L.rows ? view.rows : [view.rows[0], ...view.rows.slice(view.rows.length - (L.rows - 1))];
  const decided = view.form === 'emergency' || view.form === 'urgent';
  const qs = view.groups.find(g => g.id === group)?.questions ?? [];
  // вкладки: ширина — по длине слова
  const tabNames = view.groups.map(g => T.call.tabs[g.id]);
  const tabText = tabNames.map(n => tw(small, n) + 14);
  const k = (L.tabs.w - 4 * (tabNames.length - 1)) / tabText.reduce((a, b) => a + b, 0);
  const tabRects = tabText.reduce<{ x: number; w: number }[]>((acc, w) => {
    const x = acc.length ? acc[acc.length - 1].x + acc[acc.length - 1].w + 4 : L.tabs.x;
    return [...acc, { x, w: w * k }];
  }, []);

  return (
    <View style={{ width: W, height: H }} testID="call">
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Canvas style={StyleSheet.absoluteFill}>
          <Rect x={0} y={0} width={W} height={H} color={SCENE.hallTop} />
          {/* звонящий: картинка по ширине, лицо — в верхней трети; кого ещё не нарисовали — тёмная сцена */}
          {hasPicture && picture ? <Image image={picture} x={L.picture.x} y={L.picture.y} width={L.picture.w} height={L.picture.h} fit="cover" /> : null}
          {!hasPicture ? (
            <Group>
              <Rect x={0} y={0} width={W} height={L.picture.h}>
                <LinearGradient start={vec(0, 0)} end={vec(0, L.picture.h)} colors={[SCENE.hallBottom, SCENE.hallTop]} />
              </Rect>
              {title ? <SkText x={W / 2 - tw(title, whoWord) / 2} y={L.picture.h * 0.42} text={whoWord} font={title} color={UI.dim} /> : null}
            </Group>
          ) : null}
          <Rect x={0} y={L.picture.y + L.picture.h * 0.45} width={W} height={L.picture.h * 0.55 + 2}>
            <LinearGradient start={vec(0, L.picture.y + L.picture.h * 0.45)} end={vec(0, L.picture.y + L.picture.h)} colors={['rgba(14,18,21,0)', 'rgba(14,18,21,0.92)']} />
          </Rect>
          {/* что сказал звонящий */}
          {small ? <SkText x={16} y={bubbleY - 8} text={who} font={small} color={view.repeat ? UI.amber : UI.dim} /> : null}
          <RoundedRect x={12} y={bubbleY} width={bubbleW} height={bubbleH} r={16} color={UI.text} opacity={0.96} />
          {big ? lines.map((l, i) => <SkText key={i} x={26} y={bubbleY + 22 + i * 20} text={l} font={big} color={UI.bg} />) : null}

          {/* монитор с опросником */}
          <RoundedRect x={L.monitor.x} y={L.monitor.y} width={L.monitor.w} height={L.monitor.h} r={12} color={SCENE.bezel} />
          <Rect x={L.screen.x} y={L.screen.y} width={L.screen.w} height={L.screen.h} color={UI.bg} />
          <Rect x={L.screen.x} y={L.screen.y} width={L.screen.w} height={30} color={UI.panel} />
          {mid ? <SkText x={L.screen.x + 12} y={L.screen.y + 20} text={T.call.headNo(view.no)} font={mid} color={UI.text} /> : null}
          {mid ? <SkText x={L.screen.x + L.screen.w - 12 - tw(mid, timer)} y={L.screen.y + 20} text={timer} font={mid} color={UI.amber} /> : null}
          {rows.map((r, i) => {
            const y = L.fields.y + 15 + i * L.fieldStep;
            const label = r.label || T.call.reason;
            return (
              <Group key={`${label}${i}`}>
                {small ? <SkText x={L.screen.x + 12} y={y} text={fit(label, 82, s => tw(small, s))} font={small} color={UI.dim} /> : null}
                {mid ? <SkText x={L.screen.x + 100} y={y} text={fit(r.value, L.screen.w - 112, s => tw(mid, s))} font={mid} color={r.heard === 'unsure' ? UI.dim : UI.text} /> : null}
                <Rect x={L.screen.x + 12} y={y + 6} width={L.screen.w - 24} height={1} color={UI.line} />
              </Group>
            );
          })}
          {!decided ? (
            <Group>
              {/* вкладки групп вопросов */}
              {view.groups.map((g, i) => {
                const on = g.id === group;
                const r = tabRects[i];
                return (
                  <Group key={g.id}>
                    <RoundedRect x={r.x} y={L.tabs.y + 8} width={r.w} height={L.tabs.h - 16} r={14} color={on ? UI.line : UI.panel} />
                    {small ? <SkText x={r.x + r.w / 2 - tw(small, tabNames[i]) / 2} y={L.tabs.y + L.tabs.h / 2 + 4} text={tabNames[i]} font={small} color={on ? UI.text : UI.dim} /> : null}
                  </Group>
                );
              })}
              {/* вопросы группы: текст и цена; заданный — приглушён, его можно переспросить дешевле */}
              {qs.map((q, i) => {
                const r = L.questions[i];
                if (!r) return null;
                const cost = T.call.cost(q.cost);
                const textLines = wrap(q.text, r.w - 20 - tw(small, cost), s => tw(small, s), 2);
                return (
                  <Group key={q.id} opacity={q.asked ? 0.55 : 1}>
                    <RoundedRect x={r.x} y={r.y} width={r.w} height={r.h} r={10} color={UI.panel} />
                    <RoundedRect x={r.x} y={r.y} width={r.w} height={r.h} r={10} color={UI.line} style="stroke" strokeWidth={1} />
                    {small ? textLines.map((l, j) => <SkText key={j} x={r.x + 10} y={r.y + r.h / 2 + (j - (textLines.length - 1) / 2) * 15 + 4} text={l} font={small} color={UI.text} />) : null}
                    {small ? <SkText x={r.x + r.w - 8 - tw(small, cost)} y={r.y + r.h - 8} text={cost} font={small} color={UI.amber} /> : null}
                  </Group>
                );
              })}
            </Group>
          ) : null}
          {/* решение: форма вызова — цвет и буква; выбранная — с обводкой */}
          {T.call.forms.map(([letter, name, kind], i) => {
            const r = L.forms[i];
            const color = kind === 'none' ? UI.dim : FORM[kind];
            const chosen = view.form === kind;
            return (
              <Group key={kind}>
                <RoundedRect x={r.x} y={r.y} width={r.w} height={r.h} r={10} color={color} opacity={kind === 'none' ? 0.35 : decided && !chosen ? 0.5 : 1} />
                {chosen ? <RoundedRect x={r.x - 2} y={r.y - 2} width={r.w + 4} height={r.h + 4} r={12} color={UI.text} style="stroke" strokeWidth={2} /> : null}
                {bold ? <SkText x={r.x + r.w / 2 - tw(bold, `${letter}  ${name}`) / 2} y={r.y + r.h / 2 + 5} text={`${letter}  ${name}`} font={bold} color={kind === 'none' ? UI.text : UI.bg} /> : null}
              </Group>
            );
          })}
        </Canvas>
      </View>

      {!decided
        ? view.groups.map((g, i) => (
            <Pressable
              key={g.id}
              style={[styles.abs, { left: tabRects[i].x, top: L.tabs.y, width: tabRects[i].w, height: L.tabs.h }]}
              onPress={() => setGroup(g.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: g.id === group }}
              accessibilityLabel={T.call.tabLabel(T.call.tabs[g.id])}
              testID={`call-tab-${g.id}`}
            />
          ))
        : null}
      {!decided
        ? qs.map((q, i) =>
            L.questions[i] ? (
              <Pressable
                key={q.id}
                style={[styles.abs, { left: L.questions[i].x, top: L.questions[i].y, width: L.questions[i].w, height: L.questions[i].h }]}
                onPress={() => onAsk(q.id)}
                accessibilityRole="button"
                accessibilityLabel={T.call.questionLabel(q.text, q.cost)}
                testID={`call-q-${q.id}`}
              />
            ) : null,
          )
        : null}
      {decided ? (
        <View style={[styles.abs, { left: L.choice.x, top: L.choice.y, width: L.choice.w, height: L.choice.h }]}>
          <ProgramPanel
            testID="call-crews"
            title={T.crews.head(view.no)}
            empty={T.crews.none}
            rows={view.options.map((o, i) => ({
              key: o.crew,
              text: T.crews.row(o.no, o.kind, o.minutes),
              mark: o.redirect ? T.crews.redirect : undefined,
              label: T.crews.label(o.no, o.kind, o.minutes, o.redirect),
              onPress: () => onSend(o.crew),
              testID: `call-crew-${i}`,
            }))}
            actions={[{ label: T.crews.hold, onPress: onHold, testID: 'call-hold' }]}
          />
        </View>
      ) : null}
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
