// Разбор одного вызова (часть П6; docs/08-game-design.md, §7, «Каждый вызов»): разговор, решение и две строки
// оценки — по известному и по правде, не смешанные (ADR 0005).
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { reviewView } from '../state/reviewView';
import { useSession } from '../state/session';
import { Button, Card, Txt } from '../ui/kit';
import { C, S } from '../ui/theme';
import { mistakeText, mistakeWhy } from './reviewWords';

export function CallReviewScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const x = useSession();
  const d = useMemo(() => (x ? reviewView(x.ctx, x.s).detail(id) : null), [x, id]);
  if (!d) return null;
  const clock = (sec: number) => T.pult.clock(sec);
  return (
    <ScrollView contentContainerStyle={styles.root} testID="call-review">
      <Txt title style={styles.title}>{T.review.head(d.row.no, clock(d.row.clock))}</Txt>
      <Txt dim>{T.review.who(d.who, d.self)}</Txt>

      <Txt style={styles.head}>{T.review.talk}</Txt>
      <Card style={styles.talk}>
        {d.lines.map((l, i) => (
          <View key={i} style={styles.line}>
            <Txt dim style={styles.q}>{`${clock(l.clock)} · ${l.q ?? T.review.first}`}</Txt>
            <Txt>{T.call.quote(l.words)}</Txt>
          </View>
        ))}
      </Card>

      {d.decided ? <Txt>{T.review.decision(T.review.formWord[d.decided], d.known ? T.review.formWord[d.known] : '—')}</Txt> : null}
      {d.decided ? <Txt dim testID="call-review-known-why">{T.review.knownWhy(d.threats, d.cleared)}</Txt> : null}
      {d.changed ? <Txt>{T.review.changed(T.review.formWord[d.changed])}</Txt> : null}
      {d.crew !== null ? <Txt dim>{T.review.crew(d.crew)}</Txt> : null}
      {d.hospital ? <Txt dim>{T.review.hospital(d.hospital)}</Txt> : null}

      <Card style={styles.verdict} testID="call-review-known">
        <Txt style={styles.vHead}>{T.review.byKnown}</Txt>
        {d.mistakes.length ? (
          d.mistakes.map((m, i) => (
            <View key={i}>
              <Txt style={styles.bad}>{mistakeText(m)}</Txt>
              <Txt dim>{mistakeWhy(m)}</Txt>
              {m.cost ? <Txt dim>{T.review.cost(m.cost)}</Txt> : null}
            </View>
          ))
        ) : (
          <Txt>{d.unlucky ? T.review.unlucky : T.review.right}</Txt>
        )}
      </Card>
      <Card style={styles.verdict} testID="call-review-truth">
        <Txt style={styles.vHead}>{T.review.byTruth}</Txt>
        <Txt>{T.review.reality(d.condition, d.sex, d.age)}</Txt>
        <Txt>{T.review.arrived(d.wait, d.normMin)}</Txt>
        {d.window ? <Txt>{T.review.window(d.window.minutes, d.window.met, Math.ceil(d.window.over / 60_000))}</Txt> : null}
      </Card>
      <Button label={T.common.back} kind="ghost" onPress={onBack} testID="call-review-back" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 20, paddingTop: 40, gap: 10 },
  title: { fontSize: S.title, lineHeight: 36 },
  head: { fontSize: S.small, fontWeight: '600', marginTop: 6 },
  talk: { gap: 10 },
  line: { gap: 2 },
  q: { fontSize: 13 },
  verdict: { gap: 6 },
  vHead: { fontSize: S.small, fontWeight: '600', color: C.spruce },
  bad: { color: C.kumach },
});
