// Настройки (docs/08-game-design.md, §10): автопауза на звонке, звук, отклик телефона, «Меньше движения» (ADR устава
// 0023, правило 6: не выбрано — как в системе телефона), «Мягкий исход» (срез, С3). Пишутся сразу; размер текста — с
// выпуском.
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { setFeedback } from '../audio/feedback';
import { T } from '../i18n';
import { setAutopause, setSoftOutcome } from '../state/session';
import { lessMotionOf, type Settings } from '../state/settings';
import { saveSettings } from '../state/storage';
import { Button, Txt } from '../ui/kit';
import { setLessMotion } from '../ui/motion';
import { C, R, S } from '../ui/theme';

type Key = 'autopause' | 'sound' | 'haptics' | 'lessMotion' | 'softOutcome';

export function SettingsScreen({ settings, system, onChange, onBack }: { settings: Settings; system: boolean; onChange: (s: Settings) => void; onBack: () => void }) {
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
  return (
    <ScrollView contentContainerStyle={styles.root} testID="settings">
      <Txt title>{T.settings.title}</Txt>
      {(['autopause', 'sound', 'haptics', 'lessMotion', 'softOutcome'] as const).map(k => (
        <Pressable
          key={k}
          onPress={() => toggle(k)}
          accessibilityRole="switch"
          accessibilityState={{ checked: value(k) }}
          accessibilityLabel={T.settings[k].name}
          testID={`settings-${k}`}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={styles.text}>
            <Txt style={styles.name}>{T.settings[k].name}</Txt>
            <Txt dim style={styles.hint}>{T.settings[k].hint}</Txt>
          </View>
          <Txt style={value(k) ? styles.on : styles.off}>{value(k) ? T.settings.on : T.settings.off}</Txt>
        </Pressable>
      ))}
      <Button label={T.common.back} kind="ghost" onPress={onBack} testID="settings-back" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 24, paddingTop: 48, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 56, borderRadius: R.card, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line },
  pressed: { opacity: 0.7 },
  text: { flex: 1, gap: 2 },
  name: { fontSize: S.body, fontWeight: '500' },
  hint: { fontSize: S.small },
  on: { fontSize: S.small, fontWeight: '600', color: C.spruce },
  off: { fontSize: S.small, color: C.inkSoft },
});
