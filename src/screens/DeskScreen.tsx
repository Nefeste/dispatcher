// Рабочее место диспетчера (docs/13-art.md, «Эталонные кадры»): сцена из Blender на Three.js, экраны — картинки Skia.
// Эталонный кадр для сравнения стеков (uprava#121); со сменой (П5) экраны оживут.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { DeskView } from '../scenes/desk/DeskView';
import { Button, Txt } from '../ui/kit';

export function DeskScreen({ onBack }: { onBack: () => void }) {
  const [fps, setFps] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.root}>
      <DeskView onFps={setFps} onReady={() => setReady(true)} onError={setError} />
      <View style={styles.bar} pointerEvents="box-none">
        <Txt style={styles.title}>{T.desk.title}</Txt>
        <Txt style={styles.fps} testID="desk-fps">{T.desk.fps(fps)}</Txt>
        <Button label={T.common.back} kind="onDark" onPress={onBack} testID="desk-back" />
      </View>
      <Txt dim style={styles.hint} testID={ready ? 'desk-ready' : 'desk-loading'}>{error ?? (ready ? T.desk.hint : T.desk.loading)}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1f272c' },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  title: { flex: 1, color: '#e6e9e4', fontWeight: '600' },
  fps: { color: '#d2bd84' },
  hint: { position: 'absolute', bottom: 18, left: 0, right: 0, textAlign: 'center', color: '#c9d0cc' },
});
