// «Об игре» (docs/08-game-design.md, §10): что за игра, «игра, а не обучение» (ADR 0007), вымышленные учреждения
// и строка OpenStreetMap (ADR 0004), источники медицины, студия и версия.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { UI } from '../scenes/palette';
import { Button, Card, Overline, Screen, Txt } from '../ui/kit';
import { G } from '../ui/theme';

export function AboutScreen({ onBack, onReport }: { onBack: () => void; onReport: () => void }) {
  return (
    <Screen
      title={T.about.title}
      lead={T.about.what}
      footer={
        <View style={styles.footer}>
          <View style={styles.half}><Button label={T.common.back} kind="ghost" onPress={onBack} testID="about-back" /></View>
          <View style={styles.half}><Button label={T.about.report} kind="quiet" onPress={onReport} testID="about-report" /></View>
        </View>
      }>
      <Card accent={UI.red}>
        <Txt testID="about-not-training">{T.about.notTraining}</Txt>
      </Card>
      <Txt>{T.about.fictional}</Txt>
      <Txt dim>{T.about.clinic}</Txt>
      <Txt dim testID="about-osm">{T.about.map}</Txt>
      <Txt dim>{T.about.medicine}</Txt>
      <Card>
        <Overline>{T.about.sourcesHead}</Overline>
        {T.about.sources.map(x => <Txt dim key={x} style={styles.source}>{`· ${x}`}</Txt>)}
      </Card>
      <Txt dim>{T.about.studio}</Txt>
      <Txt dim testID="about-version">{T.about.version}</Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  source: { fontSize: 14, lineHeight: 20 },
  footer: { flexDirection: 'row', gap: G.m },
  half: { flex: 1 },
});
