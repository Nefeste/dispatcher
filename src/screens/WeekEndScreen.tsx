// Итог недели (спецификация среза, §3, шаги 9–10; §5): семь смен этой станции и лучший итог каждой, что стало со
// станцией, снимок недели — карта района с путями бригад всех смен; «Неделя заново» — новая станция, лучшие итоги
// остаются. Только из итогов, которые знают станция и журнал недели (src/state/weekEnd.ts) — правды о больных нет.
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { useFont } from '@shopify/react-native-skia';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { DB } from '../content/generated/db';
import { T } from '../i18n';
import { loadMap } from '../map/load';
import { weekSnapshot } from '../scenes/snapshot';
import { readBest } from '../state/progress';
import { softOutcome } from '../state/session';
import { readStation, readWeekLog, resetWeek } from '../state/station';
import { firstWeek } from '../state/week';
import { type WeekEndView, weekEnd } from '../state/weekEnd';
import { edgesOf, type WeekLog } from '../state/weekLog';
import { Dialog, type DialogSpec } from '../ui/dialog';
import { GLASS, UI } from '../scenes/palette';
import { useCountUp } from '../ui/anim';
import { Button, Card, Meter, Overline, Screen, Txt } from '../ui/kit';
import { saveImage } from '../ui/saveImage';
import { G, R, S } from '../ui/theme';

export function WeekEndScreen({ week, onWeek }: { week: string; onWeek: () => void }) {
  const [data, setData] = useState<{ view: WeekEndView; log: WeekLog } | null>(null);
  const [snap, setSnap] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const title = useFont(Onest_500Medium, 44);
  const body = useFont(Onest_400Regular, 38);
  const small = useFont(Onest_400Regular, 26);
  useEffect(() => {
    let alive = true;
    void Promise.all([readStation(week), readWeekLog(week), readBest()]).then(([st, log, best]) => {
      if (alive) setData({ view: weekEnd(st, log, best, DB, week), log });
    });
    return () => { alive = false; };
  }, [week]);
  if (!data) return <View style={styles.wait} testID="week-end-loading" />;
  const { view, log } = data;
  const W = T.weekEnd;
  const soft = softOutcome();

  const onSnapshot = () => {
    if (!title || !body || !small) return;
    let png: Uint8Array | null = null;
    try {
      const city = DB.cities[DB.weeks[week].city];
      const map = loadMap(city.map);
      // пути — только если журнал записан по этой карте (другая карта — другие номера рёбер)
      const same = log.map === map.id && log.edges === map.edges.a.length;
      const shifts = view.rows.filter(r => r.played).map(r => ({ n: r.n, edges: same ? edgesOf(log.shifts.find(e => e.shift === r.id)!.paths, log.edges) : [] }));
      const lines = [
        ...view.rows.map(r => W.snapshotRow(r.n, r.day, r.played?.inNorm ?? 0, r.played?.emergency ?? 0)),
        W.snapshotStation(view.fund, view.crews.length),
      ];
      png = weekSnapshot(map, city, shifts, { title: W.snapshotTitle(DB.weeks[week].title), shifts: W.snapshotShifts, lines, osm: T.map.osm }, { title, body, small });
    } catch {
      // снимок — не главное: не вышел — так и скажем
    }
    if (!png) return setSnap(T.end.snapshotFailed);
    // у первой недели — прежнее имя файла, у следующих — с именем недели
    const file = week === firstWeek() ? 'dispetcher-03-nedelya.png' : `dispetcher-03-nedelya-${week.replace(/^week\./, '')}.png`;
    void saveImage(file, png, W.snapshot).then(ok => setSnap(ok ? T.end.snapshotSaved : T.end.snapshotFailed));
  };
  const askAgain = () => setDialog({
    title: W.againAsk,
    text: W.againText,
    actions: [{ label: W.againYes, onPress: () => void resetWeek(week).then(onWeek) }],
  });

  const station = [
    W.fund(view.fund),
    W.money(view.earned, view.spent, view.fined),
    W.crews(view.crews.map(c => W.crew(c.no, c.base)).join(', ')),
    W.trained(view.trained),
    W.letters(view.thanks, view.complaints, view.inquiries),
  ].filter(Boolean);
  return (
    <Screen
      overline={DB.weeks[week].title}
      title={W.title}
      lead={W.lead}
      testID="week-end"
      footer={
        <>
          <Button label={W.toWeek} onPress={onWeek} testID="week-end-back" />
          <View style={styles.actions}>
            <View style={styles.half}><Button label={W.again} kind="ghost" small onPress={askAgain} testID="week-end-again" /></View>
            <View style={styles.half}><Button label={W.snapshot} kind="ghost" small onPress={onSnapshot} disabled={!title || !body || !small} testID="week-end-snapshot" /></View>
          </View>
          {snap ? <Txt dim style={styles.center} testID="week-end-snapshot-done">{snap}</Txt> : null}
        </>
      }>
      <Total inNorm={view.total.inNorm} all={view.total.emergency} label={W.total(view.total.inNorm, view.total.emergency)} />
      {view.total.deaths ? (
        <Card accent={UI.red}>
          <Txt style={styles.dead}>{W.totalDeaths(view.total.deaths, soft)}</Txt>
        </Card>
      ) : null}
      <Card style={styles.list}>
        {view.rows.map((r, i) => (
          <View key={r.id} style={[styles.row, i > 0 && styles.rowLine]} testID={`week-end-${r.n}`}>
            <View style={styles.rowHead}>
              <Txt style={styles.head}>{W.row(r.n, r.day, T.pult.clock(r.from), T.pult.clock(r.to))}</Txt>
              {r.played ? <Txt style={styles.score}>{W.rowScore(r.played.inNorm, r.played.emergency)}</Txt> : null}
            </View>
            {r.played && r.played.emergency ? <Meter share={r.played.inNorm / r.played.emergency} color={r.played.inNorm === r.played.emergency ? UI.green : UI.amber} height={4} /> : null}
            {/* строкой — только то, чего нет в числе справа: смена не сыграна, исходы, лучший итог другого прохождения */}
            {(() => {
              const notes = [
                r.played ? (r.played.emergency ? '' : W.played(0, 0)) : T.week.locked(r.n - 1),
                r.played?.deaths ? W.deaths(r.played.deaths, soft) : '',
                r.best && (r.best.inNorm !== r.played?.inNorm || r.best.emergency !== r.played?.emergency) ? W.best(r.best.inNorm, r.best.emergency) : '',
              ].filter(Boolean);
              return notes.length ? <Txt dim style={styles.line}>{notes.join(' · ')}</Txt> : null;
            })()}
          </View>
        ))}
      </Card>
      <Card accent={UI.amber} testID="week-end-station">
        <Overline color={UI.amber}>{W.stationHead}</Overline>
        {station.map((line, i) => <Txt key={i} style={styles.line}>{line}</Txt>)}
      </Card>
      <Dialog spec={dialog} onClose={() => setDialog(null)} />
    </Screen>
  );
}

/** Главное число недели: «41 из 46», подпись и полоса доли. Число считает от нуля; с «Меньше движения» стоит сразу. */
function Total({ inNorm, all, label }: { inNorm: number; all: number; label: string }) {
  const n = useCountUp(inNorm);
  return (
    <View style={styles.hero} accessible accessibilityLabel={label}>
      <View style={styles.heroLine}>
        <Txt style={styles.heroNumber}>{String(n)}</Txt>
        <Txt style={styles.heroOf}>{T.end.of(all)}</Txt>
      </View>
      <Txt style={styles.heroLabel} testID="week-end-total">{label}</Txt>
      {all ? <Meter share={inNorm / all} color={inNorm === all ? UI.green : UI.amber} height={8} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wait: { flex: 1 },
  hero: { backgroundColor: GLASS.window, borderRadius: R.card + 4, borderWidth: 1, borderColor: UI.line, borderTopColor: GLASS.edge, padding: G.l + 2, gap: G.s },
  heroLine: { flexDirection: 'row', alignItems: 'baseline', gap: G.s + 2 },
  heroNumber: { fontSize: 64, lineHeight: 68, fontWeight: '600' },
  heroOf: { fontSize: S.title, lineHeight: 34, color: UI.dim, fontWeight: '500' },
  heroLabel: { fontSize: S.body, lineHeight: 24 },
  list: { gap: 0, paddingVertical: 4 },
  row: { paddingVertical: 10, gap: 6 },
  rowLine: { borderTopWidth: 1, borderTopColor: UI.line },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', gap: G.s },
  head: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '500' },
  score: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  line: { fontSize: S.small, lineHeight: 20 },
  dead: { fontSize: S.body, lineHeight: 24, color: UI.red, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: G.s },
  half: { flex: 1 },
  center: { textAlign: 'center' },
});
