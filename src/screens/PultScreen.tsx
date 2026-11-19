// Сцена «Пульт» как экран (ADR 0009): пока смены нет (П5), это эталонный кадр — живая карта района на мониторе,
// телефон и рация на столе, пример линии и вызовов. Часы смены ставят паузу; телефон откроет разговор, когда он будет.
// Заменил экран «Карта района» части П2: карта теперь — в окне монитора.
import React, { useMemo, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { loadMap } from '../map/load';
import { PultScene } from '../scenes/pult/PultScene';
import { FONTS } from '../ui/fonts';
import { Txt } from '../ui/kit';

export function PultScreen({ onBack, onCall }: { onBack: () => void; onCall: () => void }) {
  const map = useMemo(() => loadMap('nn-center'), []);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || size.w !== width || size.h !== height) setSize({ w: width, h: height });
  };
  return (
    <View style={styles.root} onLayout={onLayout}>
      {size ? (
        <PultScene width={size.w} height={size.h} map={map} line={2} paused={paused} onPhone={onCall} onRadio={() => {}} onClock={() => setPaused(p => !p)} />
      ) : null}
      <Pressable style={styles.back} onPress={onBack} accessibilityRole="button" testID="map-back">
        <Txt style={styles.backText}>{T.common.back}</Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101315' },
  back: { position: 'absolute', left: 8, bottom: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(20,26,31,0.7)' },
  backText: { color: '#e6e9e4', fontSize: 13, fontFamily: FONTS.medium },
});
