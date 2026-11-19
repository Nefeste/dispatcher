// Конец смены (docs/08-game-design.md, §7, «Итог смены»): три числа. Главная ошибка и разбор вызовов — с частью П6.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { totals } from '../engine/totals';
import { useSession } from '../state/session';
import { Button, Txt } from '../ui/kit';
import { S } from '../ui/theme';

export function EndScreen({ onHome }: { onHome: () => void }) {
  const x = useSession();
  const t = x ? totals(x.ctx, x.s) : null;
  return (
    <View style={styles.root} testID="end">
      <Txt title style={styles.title}>{T.end.title}</Txt>
      {t ? (
        <View style={styles.numbers}>
          <Txt style={styles.line} testID="end-emergency">{T.end.emergency(t.inNorm, t.emergency)}</Txt>
          <Txt style={styles.line}>{T.end.urgent(t.urgentMedian === null ? null : Math.round(t.urgentMedian / 60_000))}</Txt>
          <Txt style={styles.line}>{T.end.accepted(t.accepted)}</Txt>
        </View>
      ) : null}
      <Txt dim>{T.end.review}</Txt>
      <Button label={T.end.home} onPress={onHome} testID="end-home" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, gap: 20, justifyContent: 'center' },
  title: { fontSize: S.hero, lineHeight: 44 },
  numbers: { gap: 12 },
  line: { fontSize: S.lead, lineHeight: 26 },
});
