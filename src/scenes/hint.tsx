// Подсказка учебного звонка (спецификация прототипа, §3, шаги 4–6): одна строка «что сделать сейчас» поверх сцены, в
// цвете программы диспетчерской. Касаний не перехватывает: управление — сама сцена.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { FONTS } from '../ui/fonts';
import { Txt } from '../ui/kit';
import { R } from '../ui/theme';
import { UI } from './palette';

export function HintBar({ text, top, testID = 'hint' }: { text: string; top: number; testID?: string }) {
  return (
    <View style={[styles.root, { top }]} pointerEvents="none" testID={testID}>
      <View style={styles.sign}><Txt style={styles.signText}>i</Txt></View>
      <Txt style={styles.text}>{text}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  // стекло программы с янтарной кромкой и знаком «i» (docs/13-art.md, §7): подсказка видна, но не кричит
  root: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: R.card, backgroundColor: 'rgba(20,26,31,0.94)', borderWidth: 1, borderColor: UI.amber },
  sign: { width: 20, height: 20, borderRadius: 10, backgroundColor: UI.amber, alignItems: 'center', justifyContent: 'center' },
  signText: { color: UI.bg, fontSize: 13, lineHeight: 17, fontFamily: FONTS.bold },
  text: { flex: 1, color: UI.text, fontSize: 14, lineHeight: 19, fontFamily: FONTS.medium },
});
