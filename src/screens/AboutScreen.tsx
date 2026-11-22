// «Об игре» (docs/08-game-design.md, §10): что за игра, «игра, а не обучение» (ADR 0007), вымышленные учреждения
// и строка OpenStreetMap (ADR 0004), источники медицины, студия и версия.
import React from 'react';
import { StyleSheet } from 'react-native';
import { T } from '../i18n';
import { UI } from '../scenes/palette';
import { Button, Card, Overline, Screen, Txt } from '../ui/kit';

export function AboutScreen({ onBack, onReport }: { onBack: () => void; onReport: () => void }) {
  return (
    <Screen
      title={T.about.title}
      lead={T.about.what}
      footer={<Button label={T.common.back} kind="ghost" onPress={onBack} testID="about-back" />}>
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
      <Button label={T.about.report} kind="quiet" small onPress={onReport} testID="about-report" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  source: { fontSize: 14, lineHeight: 20 },
});
