// Выбор смены «Первой недели» (docs/08-game-design.md, §8, §10; срез, docs/specs/2026-11-vertical-slice.md, часть С1):
// семь смен по порядку; у пройденной — лучший итог; следующая открывается, когда пройдена предыдущая — с любым итогом.
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { type Best, readBest } from '../state/progress';
import { readStation } from '../state/station';
import { stationView } from '../state/stationView';
import { FREE, type FreeChoice, freeId, freeOpen } from '../state/free';
import { weekRows } from '../state/week';
import { Button, Txt } from '../ui/kit';
import { C, R, S } from '../ui/theme';

export function WeekScreen({ onPick, onBack, onWeekEnd }: { onPick: (shiftId: string) => void; onBack: () => void; onWeekEnd: () => void }) {
  const [best, setBest] = useState<Record<string, Best> | null>(null);
  // неделя этой станции пройдена — итог недели над сменами (срез, С8)
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    let alive = true;
    void readBest().then(b => { if (alive) setBest(b); });
    void readStation().then(st => { if (alive) setComplete(stationView(st).complete); });
    return () => { alive = false; };
  }, []);
  const rows = best ? weekRows(best) : [];
  return (
    <ScrollView contentContainerStyle={styles.root} testID="week">
      <Txt title style={styles.title}>{T.week.title}</Txt>
      <Txt dim>{T.week.lead}</Txt>
      {complete ? <Button label={T.week.end} onPress={onWeekEnd} testID="week-end-open" /> : null}
      {rows.map(r => (
        <Pressable
          key={r.id}
          disabled={!r.open}
          onPress={() => onPick(r.id)}
          accessibilityRole="button"
          accessibilityState={{ disabled: !r.open }}
          accessibilityLabel={T.week.label(r.n, r.day, r.open)}
          testID={`week-${r.n}`}
          style={({ pressed }) => [styles.row, !r.open && styles.locked, pressed && styles.pressed]}>
          <Txt style={styles.head}>{T.week.head(r.n, r.day, T.pult.clock(r.from), T.pult.clock(r.to))}</Txt>
          <Txt dim style={styles.what}>{r.what}</Txt>
          <View>
            {r.best ? <Txt style={styles.best}>{T.week.best(r.best.inNorm, r.best.emergency)}</Txt> : null}
            {!r.open ? <Txt dim style={styles.best}>{T.week.locked(r.n - 1)}</Txt> : null}
          </View>
        </Pressable>
      ))}
      {best ? <FreeCard open={freeOpen(best)} best={best} onPick={onPick} /> : null}
      <Button label={T.common.back} kind="ghost" onPress={onBack} testID="week-back" />
    </ScrollView>
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
    <View style={[styles.row, !open && styles.locked]} testID="week-free">
      <Txt style={styles.head}>{T.free.title}</Txt>
      <Txt dim style={styles.what}>{T.free.lead}</Txt>
      {!open ? <Txt dim style={styles.best}>{T.free.locked}</Txt> : (
        <>
          <Step text={T.free.start(T.pult.clock(c.hour * 3600))} onLess={() => set({ hour: (c.hour + 23) % 24 })} onMore={() => set({ hour: (c.hour + 1) % 24 })} testID="free-hour" />
          <Step text={T.free.hours(c.hours)} onLess={() => set({ hours: FREE.hours[clamp(hoursAt - 1, 0, FREE.hours.length - 1)] })} onMore={() => set({ hours: FREE.hours[clamp(hoursAt + 1, 0, FREE.hours.length - 1)] })} testID="free-hours" />
          <Step text={T.free.general(c.general)} onLess={() => set({ general: clamp(c.general - 1, FREE.general.min, FREE.general.max) })} onMore={() => set({ general: clamp(c.general + 1, FREE.general.min, FREE.general.max) })} testID="free-general" />
          <Step text={T.free.resus(c.resus)} onLess={() => set({ resus: clamp(c.resus - 1, FREE.resus.min, FREE.resus.max) })} onMore={() => set({ resus: clamp(c.resus + 1, FREE.resus.min, FREE.resus.max) })} testID="free-resus" />
          {mine ? <Txt dim style={styles.best}>{T.free.best(mine.inNorm, mine.emergency)}</Txt> : null}
          <Button label={T.free.go} onPress={() => onPick(freeId(c))} testID="free-go" />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepText: { flex: 1, fontSize: S.small },
  stepButton: { width: 44, height: 44, borderRadius: R.button, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  stepSign: { fontSize: S.lead, lineHeight: 26 },
  root: { padding: 20, paddingTop: 40, gap: 12 },
  title: { fontSize: S.hero, lineHeight: 44 },
  row: { padding: 14, borderRadius: R.card, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, gap: 4 },
  locked: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
  head: { fontSize: S.body, fontWeight: '600' },
  what: { fontSize: S.small, lineHeight: 20 },
  best: { fontSize: S.small },
});
