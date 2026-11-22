// «Сообщить об ошибке» (путь к 1.0, часть В1): игрок видит отчёт целиком и сам решает, отправлять ли — письмом на
// почту поддержки студии или через «Поделиться». По образцу «Вотчины» (src/ui/ReportSheet.tsx @ 83b344d): здесь —
// обычный экран, сети у игры нет, буфера обмена нет — текст можно выделить.
import React, { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { T } from '../i18n';
import { type CrashEntry, readCrashlog } from '../state/crashlog';
import { buildReport } from '../state/report';
import { session } from '../state/session';
import { Button, Txt } from '../ui/kit';
import { C, R, S } from '../ui/theme';
import { APP_BUILD, APP_VERSION } from '../version';

/** Почта поддержки студии (устав, `08-publishing.md`, «Постоянное»): переменная сборки `CONTACT_EMAIL` или она же. */
const EMAIL = process.env.EXPO_PUBLIC_CONTACT_EMAIL || 'support@gornitsa.games';
/** Предел адреса `mailto:`: кириллица в адресе — шесть знаков на букву; длиннее — сразу «Поделиться». */
const MAILTO_MAX = 16000;
const WEB = Platform.OS === 'web';

/** «Android 14 · Xiaomi 23053RN02Y»; в браузере — начало строки браузера. */
function deviceLine(): string {
  if (WEB) return typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 160) : 'web';
  const c = Platform.constants as { Release?: string; Manufacturer?: string; Model?: string };
  return `${Platform.OS === 'android' ? 'Android' : Platform.OS} ${c.Release ?? Platform.Version} · ${[c.Manufacturer, c.Model].filter(Boolean).join(' ')}`;
}

/** Идущая смена — запись и игровое время; правды о больных в отчёте нет. */
function shiftLine(): string | null {
  const x = session();
  if (!x) return null;
  return `${x.ctx.setup.id} · ${T.pult.clock(x.ctx.setup.start + Math.floor(x.s.t / 1000))}`;
}

export function ReportScreen({ from, onBack }: { from: string; onBack: () => void }) {
  const [what, setWhat] = useState('');
  const [log, setLog] = useState<CrashEntry[] | null>([]);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void readCrashlog().then(l => { if (alive) setLog(l); });
    return () => { alive = false; };
  }, []);
  const W = T.bugReport;
  const text = buildReport({ what, version: APP_VERSION, build: APP_BUILD, device: deviceLine(), screen: from, shift: shiftLine(), log, labels: W.labels });

  // `canOpenURL('mailto:')` на Android 11+ врёт из-за видимости пакетов — просто пробуем
  const send = async () => {
    const url = `mailto:${EMAIL}?subject=${encodeURIComponent(W.subject(APP_VERSION))}&body=${encodeURIComponent(text)}`;
    if (url.length <= MAILTO_MAX) {
      try { await Linking.openURL(url); setDone(W.opened); return; } catch { /* нет почты — «Поделиться» */ }
    }
    try { await Share.share({ message: text }); setDone(W.shared); } catch { setDone(W.failed(EMAIL)); }
  };

  return (
    <ScrollView contentContainerStyle={styles.root} testID="report">
      <Txt title>{W.title}</Txt>
      <Txt dim>{WEB ? W.noteWeb(EMAIL) : W.note}</Txt>
      <Txt style={styles.label}>{W.what}</Txt>
      <TextInput
        value={what}
        onChangeText={t => setWhat(t.slice(0, 600))}
        placeholder={W.whatPlaceholder}
        placeholderTextColor={C.inkSoft}
        multiline
        accessibilityLabel={W.what}
        testID="report-what"
        style={styles.input}
      />
      <Txt style={styles.label}>{W.preview}</Txt>
      <View style={styles.preview}>
        <Txt dim testID="report-text">{text}</Txt>
      </View>
      {WEB ? null : <Button label={W.send} onPress={() => void send()} testID="report-send" />}
      {done ? <Txt dim testID="report-done">{done}</Txt> : null}
      <Button label={T.common.back} kind="ghost" onPress={onBack} testID="report-back" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 24, paddingTop: 48, gap: 12 },
  label: { fontSize: S.small, fontWeight: '600' },
  input: { minHeight: 88, borderWidth: 1, borderColor: C.line, borderRadius: R.card, backgroundColor: C.paper, padding: 12, fontSize: S.body, color: C.ink, textAlignVertical: 'top' },
  preview: { borderWidth: 1, borderColor: C.line, borderRadius: R.card, backgroundColor: C.paper, padding: 12 },
});
