// Загрузка смены (спецификация прототипа, §3, шаг 2): полоса с настоящим ходом — карта района, дороги, пути Skia и
// картинка района для карты в движении (по размеру окна карты пульта), медицина; потом — пульт. Уже загружено (вторая
// смена) — пролетает за пару кадров.
import React, { useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { SCENE, UI } from '../scenes/palette';
import { pultLayout } from '../scenes/pult/layout';
import { LOAD_STEPS, type LoadStep, prepare } from '../state/session';
import { FONTS } from '../ui/fonts';
import { Txt } from '../ui/kit';
import { cachedMapImage, cachedMapPaths } from '../ui/map/paths';
import { fitOf } from '../ui/map/scale';

export function LoadingScreen({ shiftId, onReady }: { shiftId: string; onReady: () => void }) {
  const [step, setStep] = useState<{ s: LoadStep; i: number }>({ s: 'map', i: 0 });
  // экран загрузки — во весь экран, как пульт: по его размеру — окно карты пульта
  const size = useRef<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
  };
  useEffect(() => {
    let alive = true;
    const build = (map: Parameters<typeof cachedMapPaths>[0]) => {
      cachedMapPaths(map);
      const z = size.current;
      if (!z) return;
      const box = pultLayout(z.w, z.h).map;
      cachedMapImage(map, fitOf(map, box.w, box.h));
    };
    void prepare(shiftId, (s, i) => { if (alive) setStep({ s, i }); }, build).then(() => { if (alive) onReady(); });
    return () => { alive = false; };
  }, [shiftId, onReady]);
  const share = (step.i + 1) / LOAD_STEPS.length;
  return (
    <View style={styles.root} testID="loading" onLayout={onLayout}>
      <Txt style={styles.title}>{T.loading.title}</Txt>
      <View style={styles.bar}>
        <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
      </View>
      <Txt style={styles.step} testID="loading-step">{T.loading.steps[step.s]}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCENE.hallTop, justifyContent: 'center', padding: 32, gap: 16 },
  title: { color: UI.text, fontSize: 18, fontFamily: FONTS.medium },
  bar: { height: 6, borderRadius: 3, backgroundColor: UI.panel, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: UI.amber },
  step: { color: UI.dim, fontSize: 14 },
});
