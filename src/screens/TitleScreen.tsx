// Первый экран (спецификация прототипа, §3, шаг 1): название, строка «Это игра…» (ADR 0007), «Начать смену»,
// «Об игре». Смена появится с частью П5; до неё кнопка видна, но не нажимается, а карту района (П2) можно открыть.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { Button, Txt } from '../ui/kit';
import { S } from '../ui/theme';

export function TitleScreen({ onMap, onDesk, onAbout }: { onMap: () => void; onDesk: () => void; onAbout: () => void }) {
  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Txt title style={styles.name} testID="title-name">{T.title.name}</Txt>
        <Txt style={styles.lead}>{T.title.lead}</Txt>
      </View>
      <View style={styles.actions}>
        <Button label={T.title.start} onPress={() => {}} disabled testID="title-start" />
        <Txt dim style={styles.center}>{T.title.soon}</Txt>
        <Button label={T.title.desk} kind="ghost" onPress={onDesk} testID="title-desk" />
        <Button label={T.title.map} kind="ghost" onPress={onMap} testID="title-map" />
        <Button label={T.title.about} kind="ghost" onPress={onAbout} testID="title-about" />
      </View>
      <Txt dim style={styles.center} testID="title-not-training">{T.title.notTraining}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, justifyContent: 'space-between' },
  head: { marginTop: 72, gap: 12 },
  name: { fontSize: S.hero, lineHeight: 44 },
  lead: { fontSize: S.lead, lineHeight: 28 },
  actions: { gap: 12 },
  center: { textAlign: 'center' },
});
