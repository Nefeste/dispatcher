// Сцена «Разговор» как экран (ADR 0009): пока смены нет (П5), это эталонный кадр — дочь звонит из квартиры матери,
// вопросы заполняют карточку и двигают счётчик на линии по ценам геймдизайна (§9: принять звонок — 30 игровых
// секунд). Решение — видеовставка «бригада выезжает», потом пульт.
import React, { useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { CallScene } from '../scenes/call/CallScene';
import { SCENE } from '../scenes/palette';
import { FONTS } from '../ui/fonts';
import { Txt } from '../ui/kit';

/** Принять звонок, услышать адрес и повод — 30 игровых секунд (docs/08-game-design.md, §9). */
const ANSWER = 30;

export function CallScreen({ onBack, onDecide }: { onBack: () => void; onDecide: () => void }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [asked, setAsked] = useState<number[]>([]);
  const seconds = ANSWER + asked.reduce((a, i) => a + T.call.questions[i][1], 0);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || size.w !== width || size.h !== height) setSize({ w: width, h: height });
  };
  return (
    <View style={styles.root} onLayout={onLayout}>
      {size ? (
        <CallScene width={size.w} height={size.h} asked={asked} seconds={seconds} onAsk={i => setAsked(a => (a.includes(i) ? a : [...a, i]))} onForm={kind => (kind === 'none' ? onBack() : onDecide())} />
      ) : null}
      <Pressable style={styles.back} onPress={onBack} accessibilityRole="button" testID="call-back">
        <Txt style={styles.backText}>{T.common.back}</Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCENE.hallTop },
  back: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(20,26,31,0.7)' },
  backText: { color: '#e6e9e4', fontSize: 13, fontFamily: FONTS.medium },
});
