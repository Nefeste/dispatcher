// Сцена «Разговор» (ADR 0009; docs/08-game-design.md, §3–§4, §10): сверху — звонящий там, откуда звонит (картинка из
// Blender с человеком Rocketbox, blender/caller.py), его последние слова — поверх; ниже — монитор с опросником
// программы: карточка вызова, вкладки групп вопросов, вопросы с ценой в игровых секундах и решение — форма вызова.
// После решения на месте вопросов — кого послать. Сцена получает вид вызова (src/state/callView.ts): правды о больном
// в ней нет (ADR 0005).
import { tick } from '../../audio/feedback';
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { Onest_600SemiBold } from '@expo-google-fonts/onest/600SemiBold';
import { Canvas, Circle, Group, Image, LinearGradient, Rect, rect, RoundedRect, Text as SkText, type SkFont, useFont, useImage, vec } from '@shopify/react-native-skia';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { QuestionGroup } from '../../content/types';
import { T } from '../../i18n';
import { useTextScale } from '../../ui/textScale';
import type { CallView, CardRow } from '../../state/callView';
import { ProgramPanel } from '../panel';
import { FORM, SCENE, UI } from '../palette';
import { pictureRect, callLayout, fit, fitLabel, wrap } from './layout';

/** Картинки звонящих (assets/scenes/callers.json) — по имени из записи звонящего. */
const PICTURES: Record<string, number> = {
  daughter: require('../../../assets/scenes/caller-daughter.jpg'),
  man: require('../../../assets/scenes/caller-man.jpg'),
  'daughter-street': require('../../../assets/scenes/caller-daughter-street.jpg'),
  'man-street': require('../../../assets/scenes/caller-man-street.jpg'),
  // срез, С7: пожилые, молодая женщина, подросток — дома и на улице
  grandma: require('../../../assets/scenes/caller-grandma.jpg'),
  grandpa: require('../../../assets/scenes/caller-grandpa.jpg'),
  young: require('../../../assets/scenes/caller-young.jpg'),
  teen: require('../../../assets/scenes/caller-teen.jpg'),
  'grandma-street': require('../../../assets/scenes/caller-grandma-street.jpg'),
  'grandpa-street': require('../../../assets/scenes/caller-grandpa-street.jpg'),
  'young-street': require('../../../assets/scenes/caller-young-street.jpg'),
  'teen-street': require('../../../assets/scenes/caller-teen-street.jpg'),
};

export interface CallProps {
  width: number;
  height: number;
  view: CallView;
  onAsk: (q: string) => void;
  onForm: (kind: 'emergency' | 'urgent' | 'none') => void;
  onSend: (crew: string) => void;
  onHold: () => void;
  onPass: () => void;
}

const tw = (f: SkFont | null, s: string) => (f ? f.getTextWidth(s) : s.length * 7);

export function CallScene({ width: W, height: H, view, onAsk, onForm, onSend, onHold, onPass }: CallProps) {
  // размер текста (§12 геймдизайна; срез, С8б): шрифты — по ступени, касания и строки карточки — выше
  const s = useTextScale();
  const L = useMemo(() => callLayout(W, H, s), [W, H, s]);
  const pic = pictureRect(L.picture);
  const [group, setGroup] = useState<QuestionGroup>('vital');
  const picture = useImage(view.picture ? (PICTURES[view.picture] ?? null) : null);
  const big = useFont(Onest_500Medium, 16 * s);
  const mid = useFont(Onest_500Medium, 13 * s);
  const small = useFont(Onest_400Regular, 12 * s);
  const bold = useFont(Onest_600SemiBold, 14 * s);
  const title = useFont(Onest_500Medium, 30 * s);
  const hasPicture = Boolean(view.picture && PICTURES[view.picture]);
  const bubbleMax = W - 24 - 28;
  // вызов вернулся из поликлиники: говорит её врач (срез, С5)
  const said = view.clinic ? T.call.clinic[view.clinic] : view.dialed ? T.call.dialAnswer : view.said;
  // строка диспетчера над словами звонящего — как по телефону: «Скорая, слушаю», перезвон, заданный вопрос
  const meText = view.me.kind === 'asked' ? view.me.text : view.me.kind === 'dial' ? T.call.me.dial : T.call.me.answer;
  const lines = wrap(T.call.quote(said), bubbleMax, x => tw(big, x), 3);
  const bubbleW = Math.min(W - 24, Math.max(...lines.map(l => tw(big, l))) + 28);
  const bubbleH = lines.length * 20 * s + 16;
  const bubbleY = L.picture.h - bubbleH - 14;
  const whoWord = view.clinic ? T.call.clinicWho : `${view.who.charAt(0).toUpperCase()}${view.who.slice(1)}`;
  const who = `${whoWord}${view.repeat && !view.clinic ? ` · ${T.call.repeat}` : ''}`;
  const timer = T.call.timer(view.seconds);
  // карточка: повод — всегда, дальше — последние ответы, сколько помещается
  // адрес — сразу под поводом, всегда (игра владельца 22.11.2026: «улица и дом нигде не показываются»)
  const addr: CardRow[] = view.address ? [{ label: T.call.addressLabel, value: T.call.address(view.address) }] : [];
  const rest = L.rows - 1 - addr.length;
  const rows = [view.rows[0], ...addr, ...(view.rows.length - 1 <= rest ? view.rows.slice(1) : view.rows.slice(view.rows.length - rest))];
  const decided = view.form === 'emergency' || view.form === 'urgent';
  // «Ещё спросить» (игра владельца 22.11.2026): форма названа, бригаду не послали — можно вернуться к вопросам и
  // назвать форму снова; разговор новый — снова окно бригад; перезвонили ждущему — сначала вопросы
  const [asking, setAsking] = useState(view.dialed);
  const crewsOpen = decided && !asking;
  // что сейчас под пальцем — вопрос, вкладка или форма: рисуется нажатым (премиум-отделка); касание — с откликом
  const [down, setDown] = useState<string | null>(null);
  const hold = (id: string) => ({ onPressIn: () => setDown(id), onPressOut: () => setDown(x => (x === id ? null : x)) });
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
      {/* слова разговора нарисованы Skia — для чтения с экрана они же подписью над картинкой */}
      <View
        style={{ position: 'absolute', left: 0, top: L.picture.y, width: W, height: L.picture.h }}
        pointerEvents="none"
        accessible
        accessibilityLabel={`${meText}. ${who}: ${said}`}
        testID="call-said"
      />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Canvas style={StyleSheet.absoluteFill}>
          <Rect x={0} y={0} width={W} height={H} color={SCENE.hallTop} />
          {/* звонящий: картинка по ширине, лицо — в верхней трети; кого ещё не нарисовали — тёмная сцена */}
          {/* картинка — от верха кадра, лишнее срезается снизу: голова звонящего видна и в низком окне */}
          {hasPicture && picture ? (
            <Group clip={rect(L.picture.x, L.picture.y, L.picture.w, L.picture.h)}>
              <Image image={picture} x={pic.x} y={pic.y} width={pic.w} height={pic.h} fit="fill" />
            </Group>
          ) : null}
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
          {/* что сказал диспетчер — справа, тёмной строкой; что сказал звонящий — ниже, светлой */}
          {small ? (() => {
            // длинный вопрос — в две строки, не обрезая (игра владельца 22.11.2026: текст не помещается)
            const meLines = wrap(meText, W * 0.72 - 24, x => tw(small, x), 2);
            const w = Math.min(W * 0.72, Math.max(...meLines.map(l => tw(small, l))) + 24);
            const h = meLines.length * 17 * s + 8;
            const y = bubbleY - 8 - 14 * s - h - 6;
            return (
              <Group>
                <RoundedRect x={W - 12 - w} y={y} width={w} height={h} r={12} color={UI.panel} opacity={0.94} />
                {meLines.map((l, i) => (
                  <SkText key={i} x={W - 12 - w + 12} y={y + 4 + (i + 1) * 17 * s - 4 * s} text={l} font={small} color={UI.text} />
                ))}
              </Group>
            );
          })() : null}
          {/* что сказал звонящий */}
          {small ? <SkText x={16} y={bubbleY - 8} text={who} font={small} color={view.repeat ? UI.amber : UI.dim} /> : null}
          <RoundedRect x={12} y={bubbleY} width={bubbleW} height={bubbleH} r={16} color={UI.text} opacity={0.96} />
          {big ? lines.map((l, i) => <SkText key={i} x={26} y={bubbleY + 8 + 14 * s + i * 20 * s} text={l} font={big} color={UI.bg} />) : null}

          {/* монитор с опросником */}
          <RoundedRect x={L.monitor.x} y={L.monitor.y} width={L.monitor.w} height={L.monitor.h} r={12} color={SCENE.bezel} />
          <Rect x={L.screen.x} y={L.screen.y} width={L.screen.w} height={L.screen.h} color={UI.bg} />
          <Rect x={L.screen.x} y={L.screen.y} width={L.screen.w} height={30 * s} color={UI.panel} />
          {mid ? <SkText x={L.screen.x + 12} y={L.screen.y + 20 * s} text={T.call.headNo(view.no)} font={mid} color={UI.text} /> : null}
          {mid ? <SkText x={L.screen.x + L.screen.w - 12 - tw(mid, timer)} y={L.screen.y + 20 * s} text={timer} font={mid} color={UI.amber} /> : null}
          {rows.map((r, i) => {
            const y = L.fields.y + 15 * s + i * L.fieldStep;
            const label = r.label || T.call.reason;
            return (
              <Group key={`${label}${i}`}>
                {small ? <SkText x={L.screen.x + 12} y={y} text={fit(label, 82 * s, x => tw(small, x))} font={small} color={UI.dim} /> : null}
                {mid ? <SkText x={L.screen.x + 12 + 88 * s} y={y} text={fit(r.value, L.screen.w - 24 - 88 * s, x => tw(mid, x))} font={mid} color={r.heard === 'unsure' ? UI.dim : UI.text} /> : null}
                <Rect x={L.screen.x + 12} y={y + 6} width={L.screen.w - 24} height={1} color={UI.line} />
              </Group>
            );
          })}
          {!crewsOpen ? (
            <Group>
              {/* вкладки групп вопросов */}
              {view.groups.map((g, i) => {
                const on = g.id === group;
                const r = tabRects[i];
                return (
                  <Group key={g.id}>
                    <RoundedRect x={r.x} y={L.tabs.y + 8} width={r.w} height={L.tabs.h - 16} r={14} color={on ? UI.line : UI.panel} />
                    {small ? <Label font={small} variants={[tabNames[i]]} cx={r.x + r.w / 2} y={L.tabs.y + L.tabs.h / 2 + 4 * s} max={r.w - 8} color={on ? UI.text : UI.dim} /> : null}
                    {/* в группе есть вопрос, который может решить форму (docs/specs/2026-11-call-flow.md, §5) */}
                    {g.questions.some(q => q.hint) ? <Circle cx={r.x + r.w - 7} cy={L.tabs.y + 13} r={3.5 * s} color={UI.amber} /> : null}
                  </Group>
                );
              })}
              {/* вопросы группы: текст и цена; заданный — приглушён, его можно переспросить дешевле */}
              {qs.map((q, i) => {
                const r = L.questions[i];
                if (!r) return null;
                const cost = T.call.cost(q.cost);
                const textLines = wrap(q.text, r.w - 20 - tw(small, cost), x => tw(small, x), 2);
                return (
                  <Group key={q.id} opacity={q.asked ? 0.55 : 1}>
                    <RoundedRect x={r.x} y={r.y} width={r.w} height={r.h} r={10} color={down === q.id ? UI.line : UI.panel} />
                    <RoundedRect x={r.x} y={r.y} width={r.w} height={r.h} r={10} color={down === q.id ? UI.dim : UI.line} style="stroke" strokeWidth={1} />
                    {small ? textLines.map((l, j) => <SkText key={j} x={r.x + 10} y={r.y + r.h / 2 + (j - (textLines.length - 1) / 2) * 15 * s + 4 * s} text={l} font={small} color={UI.text} />) : null}
                    {small ? <SkText x={r.x + r.w - 8 - tw(small, cost)} y={r.y + r.h - 8} text={cost} font={small} color={UI.amber} /> : null}
                    {q.hint ? <Circle cx={r.x + r.w - 10} cy={r.y + 10} r={4 * s} color={UI.amber} /> : null}
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
                {down === `form-${kind}` ? <RoundedRect x={r.x} y={r.y} width={r.w} height={r.h} r={10} color="rgba(14,18,21,0.28)" /> : null}
                {chosen ? <RoundedRect x={r.x - 2} y={r.y - 2} width={r.w + 4} height={r.h + 4} r={12} color={UI.text} style="stroke" strokeWidth={2} /> : null}
                {bold ? <Label font={bold} variants={[`${letter}  ${name}`, name]} cx={r.x + r.w / 2} y={r.y + r.h / 2 + 5 * s} max={r.w - 8} color={kind === 'none' ? UI.text : UI.bg} /> : null}
              </Group>
            );
          })}
        </Canvas>
      </View>

      {!crewsOpen
        ? view.groups.map((g, i) => (
            <Pressable
              key={g.id}
              style={[styles.abs, { left: tabRects[i].x, top: L.tabs.y, width: tabRects[i].w, height: L.tabs.h }]}
              onPress={() => { tick(); setGroup(g.id); }}
              accessibilityRole="tab"
              accessibilityState={{ selected: g.id === group }}
              accessibilityLabel={T.call.tabLabel(T.call.tabs[g.id])}
              testID={`call-tab-${g.id}`}
            />
          ))
        : null}
      {!crewsOpen
        ? qs.map((q, i) =>
            L.questions[i] ? (
              <Pressable
                key={q.id}
                style={[styles.abs, { left: L.questions[i].x, top: L.questions[i].y, width: L.questions[i].w, height: L.questions[i].h }]}
                onPress={() => { tick(); onAsk(q.id); }}
                {...hold(q.id)}
                accessibilityRole="button"
                accessibilityLabel={`${T.call.questionLabel(q.text, q.cost)}${q.hint ? `. ${T.call.hint}` : ''}`}
                testID={`call-q-${q.id}`}
              />
            ) : null,
          )
        : null}
      {crewsOpen ? (
        <View style={[styles.abs, { left: L.choice.x, top: L.choice.y, width: L.choice.w, height: L.choice.h }]}>
          <ProgramPanel
            testID="call-crews"
            title={T.crews.head(view.no)}
            empty={T.crews.none}
            rows={[
              // врач поликлиники на дом — первой строкой и с объяснением: что это и чем кончится (игра владельца 22.11.2026)
              ...(view.pass ? [{
                key: 'pass',
                text: T.crews.pass,
                sub: T.crews.passSub(view.clinicMin[0], view.clinicMin[1]),
                mark: T.crews.passMark,
                label: `${T.crews.pass}. ${T.crews.passSub(view.clinicMin[0], view.clinicMin[1])}`,
                onPress: onPass,
                testID: 'call-pass',
              }] : []),
              ...view.options.map((o, i) => ({
                key: o.crew,
                text: T.crews.row(o.no, o.kind, o.minutes),
                mark: o.redirect ? T.crews.redirect : undefined,
                label: T.crews.label(o.no, o.kind, o.minutes, o.redirect),
                onPress: () => onSend(o.crew),
                testID: `call-crew-${i}`,
              })),
            ]}
            note={view.passClosed ? T.crews.passClosed(view.clinicHours[0], view.clinicHours[1]) : undefined}
            actions={[
              { label: T.crews.more, onPress: () => setAsking(true), testID: 'call-more' },
              { label: T.crews.hold, onPress: onHold, testID: 'call-hold' },
            ]}
          />
        </View>
      ) : null}
      {T.call.forms.map(([, name, kind], i) => (
        <Pressable
          key={kind}
          style={[styles.abs, { left: L.forms[i].x, top: L.forms[i].y, width: L.forms[i].w, height: L.forms[i].h }]}
          onPress={() => { tick(); setAsking(false); onForm(kind); }}
          {...hold(`form-${kind}`)}
          accessibilityRole="button"
          accessibilityLabel={T.call.formLabel(name)}
          testID={`call-form-${kind}`}
        />
      ))}
    </View>
  );
}

/** Подпись кнопки Skia по середине `cx`: длинный вариант, если помещается, иначе короткий, иначе уменьшенный
 *  (`fitLabel`) — текст никогда не выходит за кнопку (игра владельца 22.11.2026). */
function Label({ font, variants, cx, y, max, color }: { font: SkFont; variants: readonly string[]; cx: number; y: number; max: number; color: string }) {
  const { text, scale } = fitLabel(variants, max, x => tw(font, x));
  return (
    <Group origin={vec(cx, y)} transform={[{ scale }]}>
      <SkText x={cx - tw(font, text) / 2} y={y} text={text} font={font} color={color} />
    </Group>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
});
