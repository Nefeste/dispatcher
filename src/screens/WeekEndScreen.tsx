// Итог недели (спецификация среза, §3, шаги 9–10; §5): семь смен этой станции и лучший итог каждой, что стало со
// станцией, снимок недели — карта района с путями бригад всех смен; «Неделя заново» — новая станция, лучшие итоги
// остаются. Только из итогов, которые знают станция и журнал недели (src/state/weekEnd.ts) — правды о больных нет.
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { useFont } from '@shopify/react-native-skia';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
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
import { Button, Card, Txt } from '../ui/kit';
import { saveImage } from '../ui/saveImage';
import { C, R, S } from '../ui/theme';

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
  if (!data) return <View style={styles.root} testID="week-end-loading" />;
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
    <ScrollView contentContainerStyle={styles.root} testID="week-end">
      <Txt title style={styles.title}>{W.title}</Txt>
      <Txt dim>{W.lead}</Txt>
      {view.rows.map(r => (
        <View key={r.id} style={styles.row} testID={`week-end-${r.n}`}>
          <Txt style={styles.head}>{W.row(r.n, r.day, T.pult.clock(r.from), T.pult.clock(r.to))}</Txt>
          <Txt style={styles.line}>
            {r.played ? W.played(r.played.inNorm, r.played.emergency) : T.week.locked(r.n - 1)}
            {r.played?.deaths ? ` · ${W.deaths(r.played.deaths, soft)}` : ''}
          </Txt>
          {/* лучший итог — когда он не тот, что сыгран на этой станции */}
          {r.best && (r.best.inNorm !== r.played?.inNorm || r.best.emergency !== r.played?.emergency) ? <Txt dim style={styles.line}>{W.best(r.best.inNorm, r.best.emergency)}</Txt> : null}
        </View>
      ))}
      <Txt style={styles.total} testID="week-end-total">{W.total(view.total.inNorm, view.total.emergency)}</Txt>
      {view.total.deaths ? <Txt style={styles.dead}>{W.totalDeaths(view.total.deaths, soft)}</Txt> : null}
      <Card testID="week-end-station">
        <Txt style={styles.cardHead}>{W.stationHead}</Txt>
        {station.map((line, i) => <Txt key={i} style={styles.line}>{line}</Txt>)}
      </Card>
      <Button label={W.snapshot} kind="ghost" onPress={onSnapshot} disabled={!title || !body || !small} testID="week-end-snapshot" />
      {snap ? <Txt dim testID="week-end-snapshot-done">{snap}</Txt> : null}
      <View style={styles.actions}>
        <Button label={W.again} onPress={askAgain} testID="week-end-again" />
        <Button label={W.toWeek} kind="ghost" onPress={onWeek} testID="week-end-back" />
      </View>
      <Dialog spec={dialog} onClose={() => setDialog(null)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 20, paddingTop: 40, gap: 12 },
  title: { fontSize: S.hero, lineHeight: 44 },
  row: { padding: 12, borderRadius: R.card, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, gap: 2 },
  head: { fontSize: S.body, fontWeight: '600' },
  line: { fontSize: S.small, lineHeight: 20 },
  total: { fontSize: S.body, lineHeight: 24, fontWeight: '600', marginTop: 4 },
  dead: { fontSize: S.body, lineHeight: 24, color: C.kumach, fontWeight: '600' },
  cardHead: { fontSize: S.small, color: C.kumach, fontWeight: '600' },
  actions: { gap: 10, marginTop: 8 },
});
