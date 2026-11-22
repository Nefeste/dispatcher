// Загрузка смены (спецификация прототипа, §3, шаг 2; docs/13-art.md, §7): зал за стеклом, логотип, какая смена
// начинается, и полоса с настоящим ходом — картинки сцен, карта района, дороги, пути Skia и картинка района для карты в
// движении (по размеру окна карты пульта), медицина; потом — пульт. Шаги — те, что идут на самом деле: сделанный
// отмечен, идущий подсвечен; полоса плавно догоняет шаг (с «Меньше движения» — встаёт сразу). Уже загружено (вторая
// смена) — пролетает за пару кадров.
import { Asset } from 'expo-asset';
import React, { useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { DB } from '../content/generated/db';
import { T } from '../i18n';
import { textScale } from '../ui/textScale';
import { GLASS, UI } from '../scenes/palette';
import { pultLayout } from '../scenes/pult/layout';
import { LOAD_STEPS, type LoadStep, prepare } from '../state/session';
import { weekRows, weeksOf } from '../state/week';
import { useEased } from '../ui/anim';
import { Backdrop } from '../ui/Backdrop';
import { Txt } from '../ui/kit';
import { G, R } from '../ui/theme';
import { cachedLampPaths, cachedMapImage, cachedMapPaths } from '../ui/map/paths';
import { fitOf } from '../ui/map/scale';
import { Logo } from './TitleScreen';

/** Картинки сцен смены: стол пульта и звонящие — чтобы первый звонок не ждал файла. */
const PICTURES: number[] = [
  require('../../assets/scenes/pult-desk.png'),
  require('../../assets/scenes/caller-daughter.jpg'), require('../../assets/scenes/caller-daughter-street.jpg'),
  require('../../assets/scenes/caller-man.jpg'), require('../../assets/scenes/caller-man-street.jpg'),
  require('../../assets/scenes/caller-grandma.jpg'), require('../../assets/scenes/caller-grandma-street.jpg'),
  require('../../assets/scenes/caller-grandpa.jpg'), require('../../assets/scenes/caller-grandpa-street.jpg'),
  require('../../assets/scenes/caller-young.jpg'), require('../../assets/scenes/caller-young-street.jpg'),
  require('../../assets/scenes/caller-teen.jpg'), require('../../assets/scenes/caller-teen-street.jpg'),
];
// картинки не загрузились — игра идёт: сцена сама возьмёт файл, когда он понадобится
const loadPictures = () => Asset.loadAsync(PICTURES).then(() => {}, () => {});

/** «Понедельник, утро» и «Смена 1 · 08:00–10:00» — у смены недели; у свободной смены строк нет. */
function shiftLine(shiftId: string): { day: string; time: string } | null {
  for (const w of weeksOf()) {
    const r = weekRows({}, DB, w.id).find(x => x.id === shiftId);
    if (r) return { day: r.day, time: T.loading.shift(r.n, T.pult.clock(r.from), T.pult.clock(r.to)) };
  }
  return null;
}

/** `hold` — для сценария в браузере: загружено — экран ждёт касания, а не уходит сам. */
export function LoadingScreen({ shiftId, onReady, hold }: { shiftId: string; onReady: () => void; hold?: boolean }) {
  const [step, setStep] = useState<{ s: LoadStep; i: number }>({ s: LOAD_STEPS[0], i: 0 });
  const [done, setDone] = useState(false);
  // экран загрузки — во весь экран, как пульт: по его размеру — окно карты пульта
  const size = useRef<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
  };
  useEffect(() => {
    let alive = true;
    const build = (map: Parameters<typeof cachedMapPaths>[0]) => {
      cachedMapPaths(map);
      // фонари — заранее, чтобы первый ночной кадр пульта их не строил (срез, С6)
      cachedLampPaths(map);
      const z = size.current;
      if (!z) return;
      const box = pultLayout(z.w, z.h, textScale()).map;
      cachedMapImage(map, fitOf(map, box.w, box.h));
    };
    void prepare(shiftId, (s, i) => { if (alive) setStep({ s, i }); }, build, loadPictures).then(() => {
      if (!alive) return;
      setDone(true);
      if (!hold) onReady();
    });
    return () => { alive = false; };
  }, [shiftId, onReady, hold]);
  // доля — сколько шагов сделано; идущий шаг считается наполовину: полоса не стоит на нуле
  const share = done ? 1 : (step.i + 0.5) / LOAD_STEPS.length;
  const percent = Math.round(share * 100);
  const t = useEased(share, 260);
  const fill = useAnimatedStyle(() => ({ width: `${t.value * 100}%` }));
  const line = shiftLine(shiftId);
  return (
    <Pressable style={styles.root} testID="loading" onLayout={onLayout} disabled={!hold || !done} onPress={onReady}>
      <Backdrop blur={10} dim={0.55} />
      <View style={styles.top}>
        <Logo size={34} />
      </View>
      <View style={styles.box} accessible accessibilityRole="progressbar" accessibilityLabel={T.loading.label(percent, T.loading.steps[step.s])} accessibilityValue={{ min: 0, max: 100, now: percent }}>
        <Txt style={styles.over}>{T.loading.title}</Txt>
        {line ? (
          <View testID="loading-shift">
            <Txt title style={styles.shift}>{line.day}</Txt>
            <Txt dim>{line.time}</Txt>
          </View>
        ) : null}
        <View style={styles.steps}>
          {LOAD_STEPS.map((s, i) => {
            const state = done || i < step.i ? 'done' : i === step.i ? 'now' : 'next';
            return (
              <View key={s} style={styles.stepRow}>
                <View style={[styles.dot, state === 'done' && styles.dotDone, state === 'now' && styles.dotNow]} />
                <Txt style={[styles.step, state === 'next' && styles.stepNext, state === 'now' && styles.stepNow]} testID={state === 'now' ? 'loading-step' : undefined}>{T.loading.steps[s]}</Txt>
                {state === 'done' ? <Txt style={styles.tick}>✓</Txt> : null}
              </View>
            );
          })}
        </View>
        <View style={styles.barRow}>
          <View style={styles.bar}>
            <Animated.View style={[styles.fill, fill]} />
          </View>
          <Txt style={styles.percent} testID="loading-percent">{T.loading.percent(percent)}</Txt>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', padding: G.xl - 4, gap: G.xl },
  top: { position: 'absolute', top: 44, left: G.xl, right: G.xl },
  box: { borderRadius: R.card + 4, backgroundColor: GLASS.window, borderWidth: 1, borderColor: UI.line, borderTopColor: GLASS.edge, padding: G.l + 2, gap: G.m, marginBottom: G.xl },
  over: { color: UI.amber, fontSize: 13, lineHeight: 18, letterSpacing: 0.8, fontWeight: '600' },
  shift: { fontSize: 26, lineHeight: 33 },
  steps: { gap: 6, marginTop: 2 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: G.s + 2 },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1, borderColor: UI.dim },
  dotDone: { backgroundColor: UI.green, borderColor: UI.green },
  dotNow: { backgroundColor: UI.amber, borderColor: UI.amber },
  step: { flex: 1, color: UI.text, fontSize: 14, lineHeight: 20 },
  stepNext: { color: UI.dim },
  stepNow: { fontWeight: '500' },
  tick: { color: UI.green, fontSize: 14, lineHeight: 20 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: G.m, marginTop: 4 },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: UI.bg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: UI.line },
  fill: { height: 6, borderRadius: 3, backgroundColor: UI.amber },
  percent: { color: UI.text, fontSize: 14, lineHeight: 20, fontWeight: '500', minWidth: 44, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
