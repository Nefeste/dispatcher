// Окно программы диспетчерской поверх монитора сцены (ADR 0009): выбор бригады, доклад и выбор больницы. Списки —
// обычные представления React Native в цветах программы (src/scenes/palette.ts): их читает экранный диктор, и строки
// переносятся сами. Касание строки — одно действие (docs/08-game-design.md, §5: «Отправить — одно касание»).
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { FONTS } from '../ui/fonts';
import { Txt } from '../ui/kit';
import { UI } from './palette';

export interface PanelRow {
  key: string;
  text: string;
  /** строка под главной: вид бригады, профили больницы */
  sub?: string;
  /** пометка справа: «предлагает бригада», «снять с неотложного» */
  mark?: string;
  label: string;
  onPress: () => void;
  /** нельзя сейчас: строка приглушена, касание ничего не делает */
  disabled?: boolean;
  testID?: string;
}

export interface PanelProps {
  title: string;
  lead?: string;
  rows: PanelRow[];
  empty?: string;
  /** строка внизу мелко: «повезут в предложенную через 1:30» */
  note?: string;
  actions?: { label: string; onPress: () => void; testID?: string }[];
  testID?: string;
}

export function ProgramPanel({ title, lead, rows, empty, note, actions, testID }: PanelProps) {
  return (
    <View style={styles.root} testID={testID}>
      <Txt style={styles.title}>{title}</Txt>
      {lead ? <Txt style={styles.lead}>{lead}</Txt> : null}
      <ScrollView style={styles.list} contentContainerStyle={styles.listIn}>
        {!rows.length && empty ? <Txt style={styles.empty}>{empty}</Txt> : null}
        {rows.map(r => (
          <Pressable key={r.key} onPress={r.onPress} disabled={r.disabled} accessibilityRole="button" accessibilityState={{ disabled: Boolean(r.disabled) }} accessibilityLabel={r.label} testID={r.testID} style={({ pressed }) => [styles.row, r.disabled && styles.disabled, pressed && styles.pressed]}>
            <View style={styles.rowText}>
              <Txt style={styles.text}>{r.text}</Txt>
              {r.sub ? <Txt style={styles.sub}>{r.sub}</Txt> : null}
            </View>
            {r.mark ? <Txt style={styles.mark}>{r.mark}</Txt> : null}
          </Pressable>
        ))}
      </ScrollView>
      {note ? <Txt style={styles.note}>{note}</Txt> : null}
      {actions?.length ? (
        <View style={styles.actions}>
          {actions.map(a => (
            <Pressable key={a.label} onPress={a.onPress} accessibilityRole="button" testID={a.testID} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
              <Txt style={styles.actionText}>{a.label}</Txt>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexShrink: 1, margin: 8, padding: 12, borderRadius: 12, backgroundColor: UI.bg, borderWidth: 1, borderColor: UI.line, gap: 8 },
  title: { color: UI.text, fontSize: 15, fontFamily: FONTS.medium },
  lead: { color: UI.text, fontSize: 14, lineHeight: 20 },
  list: { flexGrow: 0, flexShrink: 1 },
  listIn: { gap: 8 },
  empty: { color: UI.dim, fontSize: 13 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: UI.panel, borderWidth: 1, borderColor: UI.line },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
  rowText: { flex: 1, gap: 2 },
  text: { color: UI.text, fontSize: 14, fontFamily: FONTS.medium },
  sub: { color: UI.dim, fontSize: 12 },
  mark: { color: UI.amber, fontSize: 12 },
  note: { color: UI.amber, fontSize: 12 },
  // кнопки переносятся в следующую строку и растягиваются; длинная подпись переносится внутри кнопки — текст не выходит
  // за край (игра владельца 22.11.2026: «Передать в поликлинику» не помещалась)
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  action: { minHeight: 44, flexGrow: 1, flexShrink: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: UI.line },
  actionText: { color: UI.text, fontSize: 14, fontFamily: FONTS.medium, textAlign: 'center' },
});
