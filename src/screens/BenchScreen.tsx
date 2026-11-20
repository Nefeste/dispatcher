// «Замер» (спецификация прототипа, §8 и критерий 8; docs/06-testing.md, «Замер»; по образцу «Замера» «Козыря»:
// durak src/screens/BenchScreen.tsx @ origin/main): игра сама двигает и приближает карту, ведёт смену на пульте с
// бригадами в пути и ищет пути по району — и меряет кадры двух потоков (интерфейс — Reanimated, на нём рисует Skia;
// JS — там идёт смена), время поиска, память JS, запуск и загрузку смены. Итог — текстом: его можно отправить.
// Вход — кнопка «Замер» на заглавном экране, только в прототипе.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, PixelRatio, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { Shift, ShiftCtx } from '../engine/shift';
import { T } from '../i18n';
import { SCENE, UI } from '../scenes/palette';
import { CrewLayer } from '../scenes/pult/CrewLayer';
import { pultLayout } from '../scenes/pult/layout';
import { PultScene } from '../scenes/pult/PultScene';
import { BENCH_SHIFT, BUDGET, benchShift, benchStep, type FrameSummary, frameSummary, framesOk, msSummary, searchNodes, timeSearches } from '../state/bench';
import { jsHeap, marks, processStart, startTimes } from '../state/marks';
import { pultView } from '../state/pultView';
import { shiftContext } from '../state/session';
import { FONTS } from '../ui/fonts';
import { Button, Txt } from '../ui/kit';
import { MapView } from '../ui/map/MapView';
import { duskOf } from '../ui/map/palette';
import { cachedMapImage } from '../ui/map/paths';
import { fitOf } from '../ui/map/scale';
import { APP_VERSION } from '../version';
import { positions } from './PultScreen';

type Scene = 'pan' | 'zoom' | 'pult' | 'search';
const SCENES: Scene[] = ['pan', 'zoom', 'pult', 'search'];

/** Длительность сцен с кадрами и число поисков: полный замер и быстрый (сценарий в браузере, `?bench=quick`). */
const PLAN = {
  full: { pan: 6000, zoom: 6000, pult: 10000, searches: 200 },
  quick: { pan: 1200, zoom: 1200, pult: 1500, searches: 10 },
} as const;
/** Пауза перед сценой, мс: экран перестроился; кадры этой паузы не пишутся. */
const SETTLE_MS = 400;
/** Скорость смены сцены «Пульт»: ×4 — 96 игровых мс на мс (×1 — игровая минута за 2,5 с). */
const PULT_RATE = 96;

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface Row {
  scene: Exclude<Scene, 'search'>;
  ui: FrameSummary;
  js: FrameSummary;
}

interface Result {
  rows: Row[];
  search: ReturnType<typeof msSummary>;
  heap: number | null;
  w: number;
  h: number;
}

const pct = (x: number) => (x * 100).toFixed(1);

/** Итог текстом: то, что владелец пришлёт в журнал. */
function report(r: Result): string {
  const lines = [T.bench.head(APP_VERSION), T.bench.screen(r.w, r.h, PixelRatio.get())];
  for (const row of r.rows) {
    const what = T.bench.scenes[row.scene];
    lines.push(T.bench.verdict(framesOk(row.ui), T.bench.frames(`${what}, ${T.bench.ui}`, row.ui.fps, pct(row.ui.long), row.ui.worst, row.ui.n)));
    lines.push(T.bench.frames(`${what}, ${T.bench.js}`, row.js.fps, pct(row.js.long), row.js.worst, row.js.n));
  }
  lines.push(T.bench.verdict(r.search.p95 <= BUDGET.searchMs, T.bench.search(r.search.p50, r.search.p95, r.search.max, r.search.n)));
  lines.push(r.heap === null ? T.bench.noHeap : T.bench.verdict(r.heap <= BUDGET.heapBytes, T.bench.heap(r.heap / 1024 / 1024)));
  const st = startTimes(marks(), processStart());
  lines.push(st.cold === null ? T.bench.noCold : T.bench.cold(st.cold));
  if (st.load === null) lines.push(T.bench.noLoad);
  else {
    lines.push(T.bench.load(st.load));
    if (st.pult !== null) lines.push(T.bench.pultFirst(st.pult));
    if (st.cold !== null) {
      const total = st.cold + st.load + (st.pult ?? 0);
      lines.push(T.bench.verdict(total <= BUDGET.startMs, T.bench.total(total)));
    }
  }
  return lines.join('\n');
}

/** Сцена «Пульт»: смена идёт сама со скоростью ×4, бригады едут — всё как у игрока, без касаний. */
function BenchPult({ ctx, s, width, height }: { ctx: ShiftCtx; s: Shift; width: number; height: number }) {
  const [, setV] = useState(0);
  const pos = useSharedValue<number[]>(positions(ctx, s));
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let rev = s.rev;
    let minute = Math.floor(s.t / 60_000);
    const frame = () => {
      const now = performance.now();
      benchStep(ctx, s, Math.min(250, now - last) * PULT_RATE);
      last = now;
      pos.set(positions(ctx, s));
      // экран пересобирается, как у пульта: что-то случилось или сменилась игровая минута
      if (s.rev !== rev || Math.floor(s.t / 60_000) !== minute) {
        rev = s.rev;
        minute = Math.floor(s.t / 60_000);
        setV(v => v + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ctx, s, pos]);
  const view = pultView(ctx, s);
  const noop = () => {};
  return (
    <PultScene
      width={width}
      height={height}
      map={ctx.map}
      clock={view.clock}
      speed={4}
      line={view.line}
      waiting={view.waiting.map(w => ({ id: w.id, kind: w.form, minutes: w.minutes, repeats: w.repeats }))}
      radio={view.radio}
      closing={view.closing}
      dusk={duskOf(view.clock)}
      overlay={zoom => <CrewLayer ctx={ctx} shift={s} pos={pos} zoom={zoom} />}
      onPhone={noop}
      onRadio={noop}
      onClock={noop}
      onSpeed={noop}
    />
  );
}

export function BenchScreen({ onBack, quick = false }: { onBack: () => void; quick?: boolean }) {
  const plan = quick ? PLAN.quick : PLAN.full;
  const ctx = useMemo(() => shiftContext(), []);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  // кадры интерфейса: длительность каждого кадра, пока идёт запись; сброс — по просьбе JS
  const rec = useSharedValue(0); // 0 — нет, 1 — пишем, 2 — отдать и обнулить
  const ui = useSharedValue<number[]>([]);
  const uiDone = useRef<((a: number[]) => void) | null>(null);
  const deliver = (a: number[]) => {
    uiDone.current?.(a);
    uiDone.current = null;
  };
  useFrameCallback(info => {
    'worklet';
    const r = rec.get();
    const dt = info.timeSincePreviousFrame;
    if (r === 1 && dt !== null) {
      ui.modify(a => {
        'worklet';
        a.push(dt);
        return a;
      }, false);
    }
    if (r === 2) {
      const a = ui.get().slice();
      ui.set([]);
      rec.set(0);
      scheduleOnRN(deliver, a);
    }
  }, true);
  // кадры JS: промежуток между вызовами requestAnimationFrame
  const js = useRef<{ on: boolean; last: number; a: number[] }>({ on: false, last: 0, a: [] });
  useEffect(() => {
    let id = 0;
    const tick = (t: number) => {
      const j = js.current;
      if (j.on && j.last > 0) j.a.push(t - j.last);
      j.last = t;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  const record = async (ms: number) => {
    await wait(SETTLE_MS);
    js.current = { on: true, last: 0, a: [] };
    ui.set([]);
    rec.set(1);
    await wait(ms);
    const jsFrames = js.current.a;
    js.current = { on: false, last: 0, a: [] };
    const uiFrames = await new Promise<number[]>(resolve => {
      uiDone.current = resolve;
      rec.set(2);
    });
    return { ui: frameSummary(uiFrames), js: frameSummary(jsFrames) };
  };

  const run = async () => {
    if (scene || !size) return;
    setResult(null);
    const rows: Row[] = [];
    setShift(benchShift(ctx, BENCH_SHIFT.seed, BENCH_SHIFT.minute));
    // картинки района для карты в движении — заранее, как их строит загрузка смены: замер меряет кадры, а не постройку
    const box = pultLayout(size.w, size.h).map;
    cachedMapImage(ctx.map, fitOf(ctx.map, size.w, size.h));
    cachedMapImage(ctx.map, fitOf(ctx.map, box.w, box.h));
    for (let i = 0; i < SCENES.length && live.current; i++) {
      const sc = SCENES[i];
      setScene(sc);
      setStep(i + 1);
      if (sc === 'search') continue;
      const r = await record(plan[sc]);
      rows.push({ scene: sc, ...r });
    }
    if (!live.current) return;
    // поиск пути — после сцен, на свободном экране: как выбор бригады после решения
    await wait(SETTLE_MS);
    const ms = timeSearches(ctx, searchNodes(ctx.map.nodes.x.length, plan.searches), () => performance.now());
    if (!live.current) return;
    setScene(null);
    setShift(null);
    setResult({ rows, search: msSummary(ms), heap: jsHeap(), w: size.w, h: size.h });
  };
  const text = result ? report(result) : null;
  const share = () => {
    if (text) Share.share({ message: text }).catch(() => {});
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || size.w !== width || size.h !== height) setSize({ w: width, h: height });
  };
  const measuring = scene !== null && scene !== 'search';
  return (
    <View style={styles.root} onLayout={onLayout} testID="bench">
      {size && (scene === 'pan' || scene === 'zoom') ? (
        <MapView key={scene} map={ctx.map} width={size.w} height={size.h} autopilot={scene} />
      ) : null}
      {size && scene === 'pult' && shift ? <BenchPult ctx={ctx} s={shift} width={size.w} height={size.h} /> : null}
      {scene ? (
        <View style={styles.badge} pointerEvents="none">
          <Txt style={styles.badgeText} testID="bench-running">{T.bench.running(T.bench.scenes[scene], step, SCENES.length)}</Txt>
        </View>
      ) : null}
      {!measuring && scene !== 'search' ? (
        <ScrollView contentContainerStyle={styles.page}>
          <Txt title style={styles.title}>{T.bench.title}</Txt>
          {text ? (
            <Text selectable style={styles.result} testID="bench-result">{text}</Text>
          ) : (
            <Txt style={styles.lead}>{T.bench.lead}</Txt>
          )}
          <Button label={text ? T.bench.again : T.bench.run} onPress={() => void run()} disabled={!size} testID="bench-run" />
          {text ? <Button label={T.bench.share} kind="onDark" onPress={share} testID="bench-share" /> : null}
          <Button label={T.common.back} kind="onDark" onPress={onBack} testID="bench-back" />
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCENE.hallTop },
  page: { padding: 24, paddingTop: 48, gap: 14 },
  title: { color: UI.text },
  lead: { color: UI.text },
  result: { color: UI.text, fontFamily: FONTS.body, fontSize: 13, lineHeight: 19 },
  badge: { position: 'absolute', top: 64, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(20,26,31,0.82)' },
  badgeText: { color: '#e6e9e4', fontSize: 13, fontFamily: FONTS.medium },
});
