// Выбор смены (docs/08-game-design.md, §8, §10; срез, docs/specs/2026-11-vertical-slice.md, часть С1): по неделям
// (путь к 1.0, В2а) — семь смен по порядку; у пройденной — лучший итог; следующая открывается, когда пройдена
// предыдущая — с любым итогом; следующая неделя — когда у каждой смены предыдущей есть итог.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { type Best, readBest } from '../state/progress';
import { readStation } from '../state/station';
import { stationView } from '../state/stationView';
import { FREE, type FreeChoice, freeId, freeOpen } from '../state/free';
import { weekOpen, weekRows, weeksOf } from '../state/week';
import { DB } from '../content/generated/db';
import { GLASS, UI } from '../scenes/palette';
import { Button, Card, Row, Screen, Txt } from '../ui/kit';
import { G, R, S, TOUCH } from '../ui/theme';

export function WeekScreen({ onPick, onBack, onWeekEnd, onStation }: { onPick: (shiftId: string) => void; onBack: () => void; onWeekEnd: (week: string) => void; onStation: (week: string) => void }) {
  const [best, setBest] = useState<Record<string, Best> | null>(null);
  // неделя этой станции пройдена — итог недели над сменами (срез, С8); у каждой недели своя станция (путь к 1.0, В2а);
  // начата и не пройдена — «Станция» над сменами (игра владельца 22.11.2026: «как попасть в меню закупки?»)
  const [complete, setComplete] = useState<Record<string, boolean>>({});
  const [started, setStarted] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let alive = true;
    void readBest().then(b => { if (alive) setBest(b); });
    void Promise.all(weeksOf().map(async w => {
      const st = await readStation(w.id);
      return [w.id, stationView(st, DB, w.id).complete, st.done.length > 0] as const;
    })).then(xs => {
      if (!alive) return;
      setComplete(Object.fromEntries(xs.map(([w, c]) => [w, c])));
      setStarted(Object.fromEntries(xs.map(([w, , s]) => [w, s])));
    });
    return () => { alive = false; };
  }, []);
  const weeks = weeksOf();
  const first = weeks[0].id;
  return (
    <Screen
      title={weeks[0].title}
      lead={T.week.lead}
      testID="week"
      footer={<Button label={T.common.back} kind="ghost" onPress={onBack} testID="week-back" />}>
      {weeks.map((w, i) => {
        // у первой недели — прежние метки сценария в браузере, у следующих — с именем недели
        const tag = w.id === first ? '' : `${w.id.replace(/^week\./, '')}-`;
        const open = best ? weekOpen(best, w.id) : i === 0;
        const rows = best ? weekRows(best, DB, w.id) : [];
        // следующая смена — первая открытая без итога: она подсвечена
        const next = rows.find(r => r.open && !r.best)?.id;
        return (
          <View key={w.id} style={styles.week} testID={`week-section-${w.id}`}>
            {i > 0 ? <Txt title style={styles.title}>{w.title}</Txt> : null}
            {!open ? <Txt dim testID={`week-${tag}locked`}>{T.week.weekLocked(weeks[i - 1].title)}</Txt> : null}
            {complete[w.id] ? <Button label={T.week.end} onPress={() => onWeekEnd(w.id)} testID={`week-end-open${tag ? `-${tag.slice(0, -1)}` : ''}`} /> : null}
            {started[w.id] && !complete[w.id] ? <Button label={T.week.station} kind="ghost" onPress={() => onStation(w.id)} testID={`week-station${tag ? `-${tag.slice(0, -1)}` : ''}`} /> : null}
            {rows.map(r => (
              <Row
                key={r.id}
                disabled={!r.open}
                onPress={() => onPick(r.id)}
                label={T.week.label(r.n, r.day, r.open)}
                testID={`week-${tag}${r.n}`}
                style={[styles.row, r.id === next && styles.next]}>
                <View style={[styles.no, r.best ? styles.noDone : r.id === next ? styles.noNext : null]}>
                  <Txt style={[styles.noText, r.id === next && styles.noTextNext]}>{r.best ? '✓' : String(r.n)}</Txt>
                </View>
                <View style={styles.rowText}>
                  <Txt style={styles.head}>{T.week.name(r.day, T.pult.clock(r.from), T.pult.clock(r.to))}</Txt>
                  <Txt dim style={styles.what}>{r.what}</Txt>
                  {r.best ? <Txt style={styles.best}>{T.week.best(r.best.inNorm, r.best.emergency)}</Txt> : null}
                  {!r.open && open ? <Txt dim style={styles.lockedText}>{T.week.locked(r.n - 1)}</Txt> : null}
                </View>
              </Row>
            ))}
          </View>
        );
      })}
      {best ? <FreeCard open={freeOpen(best)} best={best} onPick={onPick} /> : null}
    </Screen>
  );
}

/** Строка выбора со «−» и «+». */
function Step({ text, onLess, onMore, testID }: { text: string; onLess: () => void; onMore: () => void; testID: string }) {
  return (
    <View style={styles.step}>
      <Txt style={styles.stepText} testID={testID}>{text}</Txt>
      <Pressable onPress={onLess} accessibilityRole="button" accessibilityLabel={T.free.less(text)} testID={`${testID}-less`} style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}>
        <Txt style={styles.stepSign}>−</Txt>
      </Pressable>
      <Pressable onPress={onMore} accessibilityRole="button" accessibilityLabel={T.free.more(text)} testID={`${testID}-more`} style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}>
        <Txt style={styles.stepSign}>+</Txt>
      </Pressable>
    </View>
  );
}

/** «Свободная смена» (§8 геймдизайна; срез, С8в): после недели — час, длина, бригады; лучший итог такой смены. */
function FreeCard({ open, best, onPick }: { open: boolean; best: Readonly<Record<string, Best>>; onPick: (shiftId: string) => void }) {
  const [c, setC] = useState<FreeChoice>(FREE.first);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const set = (x: Partial<FreeChoice>) => setC({ ...c, ...x });
  const hoursAt = FREE.hours.indexOf(c.hours);
  const mine = best[freeId(c)];
  return (
    <Card style={[styles.free, !open && styles.locked]} testID="week-free">
      <Txt style={styles.head}>{T.free.title}</Txt>
      <Txt dim style={styles.what}>{T.free.lead}</Txt>
      {!open ? <Txt dim style={styles.lockedText}>{T.free.locked}</Txt> : (
        <>
          <Step text={T.free.start(T.pult.clock(c.hour * 3600))} onLess={() => set({ hour: (c.hour + 23) % 24 })} onMore={() => set({ hour: (c.hour + 1) % 24 })} testID="free-hour" />
          <Step text={T.free.hours(c.hours)} onLess={() => set({ hours: FREE.hours[clamp(hoursAt - 1, 0, FREE.hours.length - 1)] })} onMore={() => set({ hours: FREE.hours[clamp(hoursAt + 1, 0, FREE.hours.length - 1)] })} testID="free-hours" />
          <Step text={T.free.general(c.general)} onLess={() => set({ general: clamp(c.general - 1, FREE.general.min, FREE.general.max) })} onMore={() => set({ general: clamp(c.general + 1, FREE.general.min, FREE.general.max) })} testID="free-general" />
          <Step text={T.free.resus(c.resus)} onLess={() => set({ resus: clamp(c.resus - 1, FREE.resus.min, FREE.resus.max) })} onMore={() => set({ resus: clamp(c.resus + 1, FREE.resus.min, FREE.resus.max) })} testID="free-resus" />
          {mine ? <Txt style={styles.best}>{T.free.best(mine.inNorm, mine.emergency)}</Txt> : null}
          <Button label={T.free.go} onPress={() => onPick(freeId(c))} testID="free-go" />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'center', gap: G.s },
  stepText: { flex: 1, fontSize: S.small },
  stepButton: { width: TOUCH, height: TOUCH, borderRadius: R.button, borderWidth: 1, borderColor: UI.line, backgroundColor: UI.bg, alignItems: 'center', justifyContent: 'center' },
  stepSign: { fontSize: S.lead, lineHeight: 26 },
  title: { fontSize: S.title, lineHeight: 36, marginTop: G.m },
  week: { gap: G.m },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: G.m },
  next: { borderColor: UI.amber },
  no: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: UI.line, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  noDone: { borderColor: UI.green, backgroundColor: 'rgba(127,179,163,0.16)' },
  noNext: { borderColor: UI.amber, backgroundColor: UI.amber },
  noText: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: UI.text },
  noTextNext: { color: UI.bg },
  rowText: { flex: 1, gap: 3 },
  free: { gap: G.s },
  locked: { opacity: 0.5 },
  pressed: { backgroundColor: GLASS.pressed },
  head: { fontSize: S.body, lineHeight: 23, fontWeight: '600' },
  what: { fontSize: S.small, lineHeight: 20 },
  best: { fontSize: S.small, lineHeight: 20, color: UI.green },
  lockedText: { fontSize: 13, lineHeight: 18 },
});
