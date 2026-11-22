// Итог и разбор смены (часть П6; спецификация прототипа, §3, шаги 8–10; docs/08-game-design.md, §7; вид —
// docs/13-art.md, §7): главное число крупно, три плитки,
// главная ошибка с переходом к её вызову, все вызовы смены; «Ещё раз» — та же смена с новым зерном. Правда о больных
// открывается здесь — смена закрыта (ADR 0005).
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { useFont } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { cue } from '../audio/feedback';
import { T } from '../i18n';
import type { ReviewRow } from '../state/reviewView';
import { mistakeText, mistakeWhy, tierWord } from './reviewWords';
import { reviewView } from '../state/reviewView';
import { shiftSnapshot } from '../scenes/snapshot';
import { type Best, recordBestOnce } from '../state/progress';
import { recordShiftOnce } from '../state/station';
import { softOutcome, useSession } from '../state/session';
import { saveImage } from '../ui/saveImage';
import { FORM, GLASS, UI } from '../scenes/palette';
import { useCountUp } from '../ui/anim';
import { Button, Card, Meter, Overline, Row, Screen, Stat, Txt } from '../ui/kit';
import { G, R, S } from '../ui/theme';

/** Какой смене уже сыграли «смена окончена». */
let chimed: string | null = null;

/** Буква формы в кружке: цвет и буква — цвет не единственный знак. */
function FormMark({ form }: { form: ReviewRow['decided'] }) {
  const color = form === 'emergency' ? FORM.emergency : form === 'urgent' ? FORM.urgent : UI.dim;
  return (
    <View style={[styles.form, { borderColor: color }]}>
      <Txt style={[styles.formText, { color }]}>{form ? T.review.form[form] : '·'}</Txt>
    </View>
  );
}

function CallRow({ r, onPress }: { r: ReviewRow; onPress: () => void }) {
  const late = T.review.late(r.late);
  const bad = r.tier === 'died';
  return (
    <Row
      onPress={onPress}
      label={T.review.rowLabel(r.no, r.decided ? T.review.formWord[r.decided] : '—', T.review.formWord[r.real], late)}
      testID={`review-row-${r.no}`}
      style={[styles.row, r.mistakes ? styles.rowBad : null]}>
      <View style={styles.rowHead}>
        <Txt style={styles.rowNo}>{T.review.row(r.no, T.pult.clock(r.clock))}</Txt>
        <View style={styles.forms}>
          <FormMark form={r.decided} />
          <Txt dim style={styles.arrow}>→</Txt>
          <FormMark form={r.real} />
        </View>
        <Txt style={r.late !== null && r.late > 0 ? styles.lateBad : styles.late}>{r.transfer ? `${late} · ${T.review.transfer}` : late}</Txt>
      </View>
      <Txt dim style={styles.first} numberOfLines={2}>{r.first}</Txt>
      <View style={styles.marks}>
        <Txt style={bad ? styles.mark : styles.markDim} testID={`review-tier-${r.no}`}>{tierWord(r.tier, softOutcome())}</Txt>
        {r.mistakes ? <Txt style={styles.mark}>{`· ${T.review.hasMistake}`}</Txt> : r.unlucky ? <Txt style={styles.markDim}>{`· ${T.review.unluckyMark}`}</Txt> : null}
      </View>
    </Row>
  );
}

export function ReviewScreen({ onCall, onAgain, onHome }: { onCall: (id: string) => void; onAgain: () => void; onHome: () => void }) {
  // смена недели: итог — на станцию (срез, С2), дальше — «К станции»
  const x = useSession();
  const view = useMemo(() => (x ? reviewView(x.ctx, x.s) : null), [x]);
  // лучший итог этой смены — до этой; записывается один раз, когда открыт итог
  const [best, setBest] = useState<{ before: Best | null; isBest: boolean } | null>(null);
  const [snap, setSnap] = useState<string | null>(null);
  const title = useFont(Onest_500Medium, 44);
  const body = useFont(Onest_400Regular, 38);
  const small = useFont(Onest_400Regular, 26);
  const shift = x?.ctx.setup.id;
  const seed = x?.s.seed;
  const totals = view?.totals;
  useEffect(() => {
    if (!shift || seed === undefined || !totals) return;
    let alive = true;
    void recordBestOnce(`${shift}:${seed}`, shift, totals).then(r => { if (alive) setBest(r); });
    return () => { alive = false; };
  }, [shift, seed, totals]);
  // конец смены — три тихие ноты, один раз на смену (возврат из разбора вызова их не повторяет)
  useEffect(() => {
    if (!shift || seed === undefined) return;
    const key = `${shift}:${seed}`;
    if (chimed === key) return;
    chimed = key;
    cue('done');
  }, [shift, seed]);
  useEffect(() => {
    // итог смены недели — на станцию один раз (повтор пройденной смены станцию не меняет)
    if (!x || !x.s.over || !x.ctx.setup.week) return;
    void recordShiftOnce(x.ctx, x.s);
  }, [x]);
  if (!view || !x) return null;
  const t = view.totals;
  const minutes = Math.max(1, Math.round(x.played / 60_000));
  const lines = [
    T.end.emergency(t.inNorm, t.emergency),
    T.end.urgent(t.urgentMedian === null ? null : Math.round(t.urgentMedian / 60_000)),
    T.end.accepted(t.accepted),
  ];
  const onSnapshot = () => {
    if (!title || !body || !small) return;
    let png: Uint8Array | null = null;
    try {
      const w = x.ctx.setup;
      png = shiftSnapshot(x.ctx, x.s, { title: T.end.snapshotTitle(w.week?.day ?? T.free.day, T.pult.clock(w.start), T.pult.clock(w.start + w.length)), crews: T.end.snapshotCrews, lines, osm: T.map.osm }, { title, body, small });
    } catch {
      // снимок — не главное: не вышел — так и скажем
    }
    if (!png) return setSnap(T.end.snapshotFailed);
    void saveImage(`dispetcher-03-smena-${x.s.seed}.png`, png, T.end.snapshot).then(ok => setSnap(ok ? T.end.snapshotSaved : T.end.snapshotFailed));
  };
  const w = x.ctx.setup;
  return (
    <Screen
      overline={T.end.shift(w.week?.day ?? T.free.day, T.pult.clock(w.start), T.pult.clock(w.start + w.length))}
      title={T.end.title}
      testID="end"
      footer={
        <>
          <Button label={w.week ? T.week.toStation : T.week.toWeek} onPress={onHome} testID="end-home" />
          <View style={styles.actions}>
            <View style={styles.half}><Button label={T.review.again} kind="ghost" small onPress={onAgain} testID="review-again" /></View>
            <View style={styles.half}><Button label={T.end.snapshot} kind="ghost" small onPress={onSnapshot} disabled={!title || !body || !small} testID="end-snapshot" /></View>
          </View>
          {snap ? <Txt dim style={styles.center} testID="end-snapshot-done">{snap}</Txt> : null}
        </>
      }>
      <Hero inNorm={t.inNorm} all={t.emergency} label={lines[0]} />
      <View style={styles.tiles}>
        <Tile value={t.urgentMedian === null ? null : Math.round(t.urgentMedian / 60_000)} label={t.urgentMedian === null ? T.end.tile.noUrgent : T.end.tile.urgent} delay={150} />
        <Tile value={t.accepted} label={T.end.tile.accepted(t.accepted)} delay={300} />
        <Tile value={minutes} label={T.end.tile.played(minutes)} delay={450} />
      </View>
      {view.deaths ? (
        <Card accent={UI.red} testID="end-deaths">
          <Txt style={styles.dead}>{T.review.deaths(view.deaths, softOutcome())}</Txt>
        </Card>
      ) : null}
      {best && best.before ? (
        <Txt dim style={best.isBest ? styles.newBest : undefined} testID="end-best">{best.isBest ? T.end.newBest : T.end.best(best.before.inNorm, best.before.emergency)}</Txt>
      ) : best ? <Txt dim testID="end-best">{''}</Txt> : null}
      <Card accent={view.main ? UI.red : UI.green} style={styles.main} testID="review-main">
        <Overline color={view.main ? UI.red : UI.green}>{T.review.mainHead}</Overline>
        {view.main ? (
          <>
            <Txt style={styles.mainText}>{T.review.mainLine(view.main.row.no, mistakeText(view.main.mistake))}</Txt>
            <Txt dim testID="review-main-why">{mistakeWhy(view.main.mistake)}</Txt>
            {view.main.mistake.cost ? <Txt dim>{T.review.cost(view.main.mistake.cost)}</Txt> : null}
            <Button label={T.review.toCall} kind="ghost" small onPress={() => onCall(view.main!.row.id)} testID="review-main-call" />
          </>
        ) : (
          <Txt>{T.review.noMistakes}</Txt>
        )}
      </Card>
      <View style={styles.listHead}>
        <Overline>{T.review.callsHead}</Overline>
        <Txt dim style={styles.first}>{T.review.legend}</Txt>
      </View>
      {view.rows.map(r => <CallRow key={r.id} r={r} onPress={() => onCall(r.id)} />)}
    </Screen>
  );
}

/** Главное число итога: «7 из 9», подпись и полоса доли. Число считает от нуля; с «Меньше движения» стоит сразу. */
function Hero({ inNorm, all, label }: { inNorm: number; all: number; label: string }) {
  const n = useCountUp(inNorm);
  return (
    <View style={styles.hero} accessible accessibilityLabel={label} testID="end-emergency">
      {all ? (
        <View style={styles.heroLine}>
          <Txt style={styles.heroNumber}>{String(n)}</Txt>
          <Txt style={styles.heroOf}>{T.end.of(all)}</Txt>
        </View>
      ) : null}
      <Txt style={styles.heroLabel}>{all ? T.end.heroLabel : `${T.end.heroLabel}: ${T.end.noEmergency.toLowerCase()}`}</Txt>
      {all ? <Meter share={inNorm / all} color={inNorm === all ? UI.green : UI.amber} height={8} /> : null}
    </View>
  );
}

function Tile({ value, label, delay }: { value: number | null; label: string; delay: number }) {
  const n = useCountUp(value ?? 0, delay);
  return <Stat value={value === null ? '—' : String(n)} label={label} />;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: GLASS.window, borderRadius: R.card + 4, borderWidth: 1, borderColor: UI.line, borderTopColor: GLASS.edge, padding: G.l + 2, gap: G.s },
  heroLine: { flexDirection: 'row', alignItems: 'baseline', gap: G.s + 2 },
  heroNumber: { fontSize: 64, lineHeight: 68, fontWeight: '600', fontVariant: ['tabular-nums'] },
  heroOf: { fontSize: S.title, lineHeight: 34, color: UI.dim, fontWeight: '500' },
  heroLabel: { fontSize: S.body, lineHeight: 24 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: G.s },
  main: { gap: G.s },
  mainText: { fontSize: S.body, lineHeight: 24, fontWeight: '500' },
  listHead: { gap: 2, marginTop: G.s },
  row: { gap: 6 },
  rowBad: { borderLeftWidth: 3, borderLeftColor: UI.red },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: G.s + 2 },
  rowNo: { fontSize: S.small, fontWeight: '500', flex: 1, fontVariant: ['tabular-nums'] },
  forms: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  form: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  formText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  arrow: { fontSize: 13, lineHeight: 16 },
  late: { fontSize: S.small, color: UI.green, minWidth: 64, textAlign: 'right' },
  lateBad: { fontSize: S.small, color: UI.red, fontWeight: '600', minWidth: 64, textAlign: 'right' },
  dead: { fontSize: S.body, lineHeight: 24, color: UI.red, fontWeight: '600' },
  first: { fontSize: S.small },
  marks: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  mark: { fontSize: 13, lineHeight: 18, color: UI.red },
  markDim: { fontSize: 13, lineHeight: 18, color: UI.dim },
  newBest: { color: UI.green, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: G.s },
  half: { flex: 1 },
  center: { textAlign: 'center' },
});
