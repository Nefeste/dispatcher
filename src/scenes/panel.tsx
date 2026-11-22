// Окно программы диспетчерской поверх монитора сцены (ADR 0009): выбор бригады, доклад и выбор больницы. Списки —
// обычные представления React Native в цветах программы (src/scenes/palette.ts): их читает экранный диктор, и строки
// переносятся сами. Касание строки — одно действие (docs/08-game-design.md, §5: «Отправить — одно касание»).
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { tick } from '../audio/feedback';
import { Appear, Press } from '../ui/anim';
import { FONTS } from '../ui/fonts';
import { Txt } from '../ui/kit';
import { R } from '../ui/theme';
import { GLASS, UI } from './palette';

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
    <Appear rise={12} duration={200} style={styles.root}>
     <View style={styles.in} testID={testID}>
      <Txt style={styles.title}>{title}</Txt>
      {lead ? <Txt style={styles.lead}>{lead}</Txt> : null}
      <ScrollView style={styles.list} contentContainerStyle={styles.listIn}>
        {!rows.length && empty ? <Txt style={styles.empty}>{empty}</Txt> : null}
        {rows.map(r => (
          <Press key={r.key} onPress={() => { tick(); r.onPress(); }} disabled={r.disabled} accessibilityRole="button" accessibilityState={{ disabled: Boolean(r.disabled) }} accessibilityLabel={r.label} testID={r.testID} style={[styles.row, r.disabled && styles.disabled]} pressedStyle={styles.pressed}>
            <View style={styles.rowText}>
              <Txt style={styles.text}>{r.text}</Txt>
              {r.sub ? <Txt style={styles.sub}>{r.sub}</Txt> : null}
            </View>
            {r.mark ? <Txt style={styles.mark}>{r.mark}</Txt> : null}
          </Press>
        ))}
      </ScrollView>
      {note ? <Txt style={styles.note}>{note}</Txt> : null}
      {actions?.length ? (
        <View style={styles.actions}>
          {actions.map(a => (
            <View key={a.label} style={styles.actionBox}>
              <Press onPress={() => { tick(); a.onPress(); }} accessibilityRole="button" testID={a.testID} style={styles.action} pressedStyle={styles.pressed}>
                <Txt style={styles.actionText}>{a.label}</Txt>
              </Press>
            </View>
          ))}
        </View>
      ) : null}
     </View>
    </Appear>
  );
}

const styles = StyleSheet.create({
  // стекло программы (docs/13-art.md, §7): то же, что у окна меню и итога
  root: { flexShrink: 1, margin: 8 },
  in: { flexShrink: 1, padding: 14, borderRadius: R.card + 4, backgroundColor: GLASS.window, borderWidth: 1, borderColor: UI.line, borderTopColor: GLASS.edge, gap: 10 },
  title: { color: UI.text, fontSize: 16, lineHeight: 22, fontFamily: FONTS.bold },
  lead: { color: UI.text, fontSize: 14, lineHeight: 20 },
  list: { flexGrow: 0, flexShrink: 1 },
  listIn: { gap: 8 },
  empty: { color: UI.dim, fontSize: 13 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: R.card, backgroundColor: GLASS.panel, borderWidth: 1, borderColor: UI.line },
  pressed: { backgroundColor: GLASS.pressed },
  disabled: { opacity: 0.5 },
  rowText: { flex: 1, gap: 2 },
  text: { color: UI.text, fontSize: 14, lineHeight: 19, fontFamily: FONTS.medium },
  sub: { color: UI.dim, fontSize: 12, lineHeight: 17 },
  mark: { color: UI.amber, fontSize: 12 },
  note: { color: UI.amber, fontSize: 12, lineHeight: 17 },
  // кнопки переносятся в следующую строку и растягиваются; длинная подпись переносится внутри кнопки — текст не выходит
  // за край (игра владельца 22.11.2026: «Передать в поликлинику» не помещалась)
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  actionBox: { flexGrow: 1, flexShrink: 1 },
  action: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: R.button, borderWidth: 1, borderColor: UI.line, backgroundColor: GLASS.panel },
  actionText: { color: UI.text, fontSize: 14, lineHeight: 19, fontFamily: FONTS.medium, textAlign: 'center' },
});
