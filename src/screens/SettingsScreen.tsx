// Настройки (docs/08-game-design.md, §10): автопауза на звонке, звук, отклик телефона, «Меньше движения» (ADR устава
// 0023, правило 6: не выбрано — как в системе телефона), «Мягкий исход» (срез, С3), размер текста в трёх ступенях
// (§12; срез, С8б). Пишутся сразу.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { setFeedback } from '../audio/feedback';
import { T } from '../i18n';
import { setAutopause, setSoftOutcome } from '../state/session';
import { lessMotionOf, type Settings } from '../state/settings';
import { saveSettings } from '../state/storage';
import { UI } from '../scenes/palette';
import { Button, Row, Screen, Toggle, Txt } from '../ui/kit';
import { setLessMotion } from '../ui/motion';
import { setTextSize } from '../ui/textScale';
import { G, S } from '../ui/theme';

type Key = 'autopause' | 'sound' | 'haptics' | 'lessMotion' | 'softOutcome';

export function SettingsScreen({ settings, system, onChange, onBack, onReport }: { settings: Settings; system: boolean; onChange: (s: Settings) => void; onBack: () => void; onReport: () => void }) {
  const [s, setS] = useState(settings);
  const value = (k: Key) => (k === 'lessMotion' ? lessMotionOf(s, system) : s[k]);
  const toggle = (k: Key) => {
    const next: Settings = { ...s, [k]: !value(k) };
    setS(next);
    onChange(next);
    void saveSettings(next);
    setFeedback(next);
    setLessMotion(lessMotionOf(next, system));
    setAutopause(next.autopause);
    setSoftOutcome(next.softOutcome);
  };
  const nextSize = () => {
    const next: Settings = { ...s, textSize: ((s.textSize + 1) % 3) as Settings['textSize'] };
    setS(next);
    onChange(next);
    void saveSettings(next);
    setTextSize(next.textSize);
  };
  return (
    <Screen
      title={T.settings.title}
      scrollID="settings"
      footer={
        <View style={styles.footer}>
          <View style={styles.half}><Button label={T.common.back} kind="ghost" onPress={onBack} testID="settings-back" /></View>
          <View style={styles.half}><Button label={T.about.report} kind="quiet" onPress={onReport} testID="settings-report" /></View>
        </View>
      }>
      {(['autopause', 'sound', 'haptics', 'lessMotion', 'softOutcome'] as const).map(k => (
        <Row key={k} onPress={() => toggle(k)} role="switch" checked={value(k)} label={T.settings[k].name} testID={`settings-${k}`} style={styles.row}>
          <View style={styles.text}>
            <Txt style={styles.name}>{T.settings[k].name}</Txt>
            <Txt dim style={styles.hint}>{T.settings[k].hint}</Txt>
          </View>
          <Toggle on={value(k)} word={value(k) ? T.settings.on : T.settings.off} />
        </Row>
      ))}
      {/* размер текста — три ступени, касание — следующая (§12 геймдизайна; срез, С8б) */}
      <Row onPress={nextSize} label={`${T.settings.textSize.name}: ${T.settings.textSize.steps[s.textSize]}`} testID="settings-textSize" style={styles.row}>
        <View style={styles.text}>
          <Txt style={styles.name}>{T.settings.textSize.name}</Txt>
          <Txt dim style={styles.hint}>{T.settings.textSize.hint}</Txt>
        </View>
        <View style={styles.size}>
          <Txt style={styles.sizeWord}>{T.settings.textSize.steps[s.textSize]}</Txt>
          <View style={styles.steps}>
            {[0, 1, 2].map(i => <View key={i} style={[styles.stepDot, { height: 8 + i * 4 }, i <= s.textSize && styles.stepOn]} />)}
          </View>
        </View>
      </Row>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: G.m },
  text: { flex: 1, gap: 2 },
  name: { fontSize: S.body, fontWeight: '500' },
  hint: { fontSize: S.small },
  size: { alignItems: 'flex-end', gap: 4 },
  sizeWord: { fontSize: S.small, fontWeight: '600', color: UI.text },
  steps: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  stepDot: { width: 6, borderRadius: 2, backgroundColor: UI.line },
  stepOn: { backgroundColor: UI.amber },
  footer: { flexDirection: 'row', gap: G.m },
  half: { flex: 1 },
});
