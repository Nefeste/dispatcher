// Загрузка смены (спецификация прототипа, §3, шаг 2): полоса с настоящим ходом — карта района, дороги, пути Skia,
// медицина; потом — пульт. Уже загружено (вторая смена) — пролетает за пару кадров.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { SCENE, UI } from '../scenes/palette';
import { LOAD_STEPS, type LoadStep, prepare } from '../state/session';
import { FONTS } from '../ui/fonts';
import { Txt } from '../ui/kit';
import { cachedMapPaths } from '../ui/map/paths';

export function LoadingScreen({ onReady }: { onReady: () => void }) {
  const [step, setStep] = useState<{ s: LoadStep; i: number }>({ s: 'map', i: 0 });
  useEffect(() => {
    let alive = true;
    void prepare((s, i) => { if (alive) setStep({ s, i }); }, map => { cachedMapPaths(map); }).then(() => { if (alive) onReady(); });
    return () => { alive = false; };
  }, [onReady]);
  const share = (step.i + 1) / LOAD_STEPS.length;
  return (
    <View style={styles.root} testID="loading">
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
