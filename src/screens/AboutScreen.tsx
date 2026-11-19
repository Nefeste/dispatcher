// «Об игре» (docs/08-game-design.md, §10): что за игра, «игра, а не обучение» (ADR 0007), вымышленные учреждения
// и строка OpenStreetMap (ADR 0004), источники медицины, студия и версия.
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { T } from '../i18n';
import { Button, Txt } from '../ui/kit';

export function AboutScreen({ onBack }: { onBack: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Txt title>{T.about.title}</Txt>
      <Txt>{T.about.what}</Txt>
      <Txt testID="about-not-training">{T.about.notTraining}</Txt>
      <Txt>{T.about.fictional}</Txt>
      <Txt dim testID="about-osm">{T.about.map}</Txt>
      <Txt dim>{T.about.medicine}</Txt>
      <Txt dim>{T.about.studio}</Txt>
      <Txt dim testID="about-version">{T.about.version}</Txt>
      <Button label={T.common.back} kind="ghost" onPress={onBack} testID="about-back" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 24, paddingTop: 48, gap: 14 },
});
