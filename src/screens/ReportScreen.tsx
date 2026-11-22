// «Сообщить об ошибке» (путь к 1.0, часть В1): игрок видит отчёт целиком и сам решает, отправлять ли — письмом на
// почту поддержки студии или через «Поделиться». По образцу «Вотчины» (src/ui/ReportSheet.tsx @ 83b344d): здесь —
// обычный экран, сети у игры нет, буфера обмена нет — текст можно выделить.
import React, { useEffect, useState } from 'react';
import { Linking, Platform, Share, StyleSheet, TextInput, View } from 'react-native';
import { T } from '../i18n';
import { type CrashEntry, readCrashlog } from '../state/crashlog';
import { buildReport } from '../state/report';
import { session } from '../state/session';
import { GLASS, UI } from '../scenes/palette';
import { FONTS } from '../ui/fonts';
import { Button, Overline, Screen, Txt } from '../ui/kit';
import { G, R, S } from '../ui/theme';
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
    <Screen
      title={W.title}
      lead={WEB ? W.noteWeb(EMAIL) : W.note}
      scrollID="report"
      footer={
        <View style={styles.footer}>
          <View style={styles.half}><Button label={T.common.back} kind="ghost" onPress={onBack} testID="report-back" /></View>
          {WEB ? null : <View style={styles.half}><Button label={W.send} onPress={() => void send()} testID="report-send" /></View>}
        </View>
      }>
      <Overline>{W.what}</Overline>
      <TextInput
        value={what}
        onChangeText={t => setWhat(t.slice(0, 600))}
        placeholder={W.whatPlaceholder}
        placeholderTextColor={UI.dim}
        multiline
        accessibilityLabel={W.what}
        testID="report-what"
        style={styles.input}
      />
      <Overline>{W.preview}</Overline>
      <View style={styles.preview}>
        <Txt dim testID="report-text">{text}</Txt>
      </View>
      {done ? <Txt dim testID="report-done">{done}</Txt> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 88, borderWidth: 1, borderColor: UI.line, borderRadius: R.card, backgroundColor: UI.bg, padding: 12, fontSize: S.body, color: UI.text, textAlignVertical: 'top', fontFamily: FONTS.body },
  preview: { borderWidth: 1, borderColor: UI.line, borderRadius: R.card, backgroundColor: GLASS.panel, padding: 12 },
  footer: { flexDirection: 'row', gap: G.m },
  half: { flex: 1 },
});
