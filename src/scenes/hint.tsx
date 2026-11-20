// Подсказка учебного звонка (спецификация прототипа, §3, шаги 4–6): одна строка «что сделать сейчас» поверх сцены, в
// цвете программы диспетчерской. Касаний не перехватывает: управление — сама сцена.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { FONTS } from '../ui/fonts';
import { Txt } from '../ui/kit';
import { UI } from './palette';

export function HintBar({ text, top, testID = 'hint' }: { text: string; top: number; testID?: string }) {
  return (
    <View style={[styles.root, { top }]} pointerEvents="none" testID={testID}>
      <Txt style={styles.text}>{text}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 10, right: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: UI.amber },
  text: { color: UI.bg, fontSize: 14, lineHeight: 19, fontFamily: FONTS.medium },
});
