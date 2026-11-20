// Первый экран (спецификация прототипа, §3, шаг 1): название, строка «Это игра…» (ADR 0007), «Начать смену», а если
// смена не закончена — «Продолжить смену»; рабочее место и «Об игре».
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { hasSaved } from '../state/session';
import { Button, Txt } from '../ui/kit';
import { S } from '../ui/theme';

export function TitleScreen({ onStart, onResume, onDesk, onSettings, onAbout }: { onStart: () => void; onResume: () => void; onDesk: () => void; onSettings: () => void; onAbout: () => void }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    void hasSaved().then(x => { if (alive) setSaved(x); });
    return () => { alive = false; };
  }, []);
  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Txt title style={styles.name} testID="title-name">{T.title.name}</Txt>
        <Txt style={styles.lead}>{T.title.lead}</Txt>
      </View>
      <View style={styles.actions}>
        {saved ? <Button label={T.title.resume} onPress={onResume} testID="title-resume" /> : null}
        <Button label={T.title.start} kind={saved ? 'ghost' : 'primary'} onPress={onStart} testID="title-start" />
        <Txt dim style={styles.center}>{T.title.shift}</Txt>
        <Button label={T.title.desk} kind="ghost" onPress={onDesk} testID="title-desk" />
        <Button label={T.title.settings} kind="ghost" onPress={onSettings} testID="title-settings" />
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
