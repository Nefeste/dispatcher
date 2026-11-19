// Итог и разбор смены (часть П6; спецификация прототипа, §3, шаги 8–10; docs/08-game-design.md, §7): три числа,
// главная ошибка с переходом к её вызову, все вызовы смены; «Ещё раз» — та же смена с новым зерном. Правда о больных
// открывается здесь — смена закрыта (ADR 0005).
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import type { MistakeView, ReviewRow } from '../state/reviewView';
import { reviewView } from '../state/reviewView';
import { useSession } from '../state/session';
import { Button, Card, Txt } from '../ui/kit';
import { C, R, S } from '../ui/theme';

/** Строка ошибки словами. */
export function mistakeText(v: MistakeView): string {
  const m = v.m;
  switch (m.kind) {
    case 'noDispatch': return T.review.mistake.noDispatch();
    case 'underTriage': return T.review.mistake.underTriage(v.heard);
    case 'missedQuestion': return T.review.mistake.missedQuestion(v.question!.text, v.question!.answer);
    case 'order': return T.review.mistake.order(v.bypassed ?? []);
    case 'hospital': return T.review.mistake.hospital(v.hospital!.chosen, v.hospital!.right);
    case 'crew': return T.review.mistake.crew();
    case 'overTriage': return T.review.mistake.overTriage();
  }
}

function Row({ r, onPress }: { r: ReviewRow; onPress: () => void }) {
  const decided = r.decided ? T.review.form[r.decided] : '·';
  const late = T.review.late(r.late);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={T.review.rowLabel(r.no, r.decided ? T.review.formWord[r.decided] : '—', T.review.formWord[r.real], late)}
      testID={`review-row-${r.no}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowHead}>
        <Txt style={styles.rowNo}>{T.review.row(r.no, T.pult.clock(r.clock))}</Txt>
        <Txt style={styles.forms}>{`${decided} → ${T.review.form[r.real]}`}</Txt>
        <Txt style={r.late !== null && r.late > 0 ? styles.lateBad : styles.late}>{r.transfer ? `${late} · ${T.review.transfer}` : late}</Txt>
      </View>
      <Txt dim style={styles.first}>{r.first}</Txt>
      {r.mistakes ? <Txt style={styles.mark}>{T.review.hasMistake}</Txt> : r.unlucky ? <Txt dim style={styles.markDim}>{T.review.unluckyMark}</Txt> : null}
    </Pressable>
  );
}

export function ReviewScreen({ onCall, onAgain, onHome }: { onCall: (id: string) => void; onAgain: () => void; onHome: () => void }) {
  const x = useSession();
  const view = useMemo(() => (x ? reviewView(x.ctx, x.s) : null), [x]);
  if (!view) return null;
  const t = view.totals;
  return (
    <ScrollView contentContainerStyle={styles.root} testID="end">
      <Txt title style={styles.title}>{T.end.title}</Txt>
      <View style={styles.numbers}>
        <Txt style={styles.line} testID="end-emergency">{T.end.emergency(t.inNorm, t.emergency)}</Txt>
        <Txt style={styles.line}>{T.end.urgent(t.urgentMedian === null ? null : Math.round(t.urgentMedian / 60_000))}</Txt>
        <Txt style={styles.line}>{T.end.accepted(t.accepted)}</Txt>
      </View>
      <Card style={styles.main} testID="review-main">
        <Txt style={styles.mainHead}>{T.review.mainHead}</Txt>
        {view.main ? (
          <>
            <Txt style={styles.mainText}>{T.review.mainLine(view.main.row.no, mistakeText(view.main.mistake))}</Txt>
            {view.main.mistake.cost ? <Txt dim>{T.review.cost(view.main.mistake.cost)}</Txt> : null}
            <Button label={T.review.toCall} kind="ghost" onPress={() => onCall(view.main!.row.id)} testID="review-main-call" />
          </>
        ) : (
          <Txt>{T.review.noMistakes}</Txt>
        )}
      </Card>
      <Txt style={styles.head}>{T.review.callsHead}</Txt>
      <Txt dim style={styles.first}>{T.review.legend}</Txt>
      {view.rows.map(r => <Row key={r.id} r={r} onPress={() => onCall(r.id)} />)}
      <View style={styles.actions}>
        <Button label={T.review.again} onPress={onAgain} testID="review-again" />
        <Button label={T.review.home} kind="ghost" onPress={onHome} testID="end-home" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 20, paddingTop: 40, gap: 12 },
  title: { fontSize: S.hero, lineHeight: 44 },
  numbers: { gap: 6 },
  line: { fontSize: S.body, lineHeight: 24 },
  main: { gap: 8 },
  mainHead: { fontSize: S.small, color: C.kumach, fontWeight: '600' },
  mainText: { fontSize: S.body, lineHeight: 24 },
  head: { fontSize: S.small, fontWeight: '600', marginTop: 8 },
  row: { padding: 12, borderRadius: R.card, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, gap: 4 },
  pressed: { opacity: 0.7 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowNo: { fontSize: S.small, fontWeight: '500', flex: 1 },
  forms: { fontSize: S.small, fontWeight: '600' },
  late: { fontSize: S.small },
  lateBad: { fontSize: S.small, color: C.kumach, fontWeight: '600' },
  first: { fontSize: S.small },
  mark: { fontSize: 12, color: C.kumach },
  markDim: { fontSize: 12 },
  actions: { gap: 10, marginTop: 12 },
});
