// Выбор смены «Первой недели» (docs/08-game-design.md, §8, §10; срез, docs/specs/2026-11-vertical-slice.md, часть С1):
// семь смен по порядку; у пройденной — лучший итог; следующая открывается, когда пройдена предыдущая — с любым итогом.
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { type Best, readBest } from '../state/progress';
import { weekRows } from '../state/week';
import { Button, Txt } from '../ui/kit';
import { C, R, S } from '../ui/theme';

export function WeekScreen({ onPick, onBack }: { onPick: (shiftId: string) => void; onBack: () => void }) {
  const [best, setBest] = useState<Record<string, Best> | null>(null);
  useEffect(() => {
    let alive = true;
    void readBest().then(b => { if (alive) setBest(b); });
    return () => { alive = false; };
  }, []);
  const rows = best ? weekRows(best) : [];
  return (
    <ScrollView contentContainerStyle={styles.root} testID="week">
      <Txt title style={styles.title}>{T.week.title}</Txt>
      <Txt dim>{T.week.lead}</Txt>
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
      <Button label={T.common.back} kind="ghost" onPress={onBack} testID="week-back" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 20, paddingTop: 40, gap: 12 },
  title: { fontSize: S.hero, lineHeight: 44 },
  row: { padding: 14, borderRadius: R.card, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, gap: 4 },
  locked: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
  head: { fontSize: S.body, fontWeight: '600' },
  what: { fontSize: S.small, lineHeight: 20 },
  best: { fontSize: S.small },
});
