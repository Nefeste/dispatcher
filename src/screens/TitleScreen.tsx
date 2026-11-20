// Первый экран (спецификация прототипа, §3, шаг 1): название, строка «Это игра…» (ADR 0007), «Начать смену», а если
// смена не закончена — «Продолжить смену»; настройки и «Об игре». Две пробы прототипа — рабочее место и «Замер» —
// одной строкой.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { mark } from '../state/marks';
import { hasSaved } from '../state/session';
import { Button, Txt } from '../ui/kit';
import { S } from '../ui/theme';

export function TitleScreen({ onStart, onResume, onDesk, onBench, onSettings, onAbout }: { onStart: () => void; onResume: () => void; onDesk: () => void; onBench: () => void; onSettings: () => void; onAbout: () => void }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    void hasSaved().then(x => { if (alive) setSaved(x); });
    return () => { alive = false; };
  }, []);
  // «Замер»: первый кадр заглавного экрана после запуска — конец холодного старта
  useEffect(() => {
    const id = requestAnimationFrame(() => mark('title', true));
    return () => cancelAnimationFrame(id);
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
        <View style={styles.row}>
          <View style={styles.half}><Button label={T.title.desk} kind="ghost" onPress={onDesk} testID="title-desk" /></View>
          <View style={styles.half}><Button label={T.title.bench} kind="ghost" onPress={onBench} testID="title-bench" /></View>
        </View>
        <Button label={T.title.settings} kind="ghost" onPress={onSettings} testID="title-settings" />
        <Button label={T.title.about} kind="ghost" onPress={onAbout} testID="title-about" />
      </View>
      <Txt dim style={styles.center} testID="title-not-training">{T.title.notTraining}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  root: { flex: 1, padding: 24, justifyContent: 'space-between' },
  head: { marginTop: 72, gap: 12 },
  name: { fontSize: S.hero, lineHeight: 44 },
  lead: { fontSize: S.lead, lineHeight: 28 },
  actions: { gap: 12 },
  center: { textAlign: 'center' },
});
