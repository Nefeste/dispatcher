// Первый экран (спецификация прототипа, §3, шаг 1): название, строка «Это игра…» (ADR 0007), «Первая неделя» — к выбору смены, а если
// смена не закончена — «Продолжить смену»; настройки и «Об игре». Две пробы прототипа — рабочее место и «Замер» —
// одной строкой.
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { mark } from '../state/marks';
import { hasSaved } from '../state/session';
import { DB } from '../content/generated/db';
import { readStation } from '../state/station';
import { weeksOf } from '../state/week';
import { stationView } from '../state/stationView';
import { Button, Txt } from '../ui/kit';
import { R, S } from '../ui/theme';
import { UI } from '../scenes/palette';
import { pultLayout } from '../scenes/pult/layout';
import { TitleScene } from '../scenes/title/TitleScene';

export function TitleScreen({ onStart, onResume, onStation, onDesk, onBench, onSettings, onAbout }: { onStart: () => void; onResume: () => void; onStation: (week: string) => void; onDesk: () => void; onBench: () => void; onSettings: () => void; onAbout: () => void }) {
  const [saved, setSaved] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // неделя начата и не пройдена — «Продолжить неделю» ведёт на станцию, к следующей смене (спецификация среза, §3, шаг 1);
  // недель несколько (путь к 1.0, В2а) — последняя такая
  const [going, setGoing] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void hasSaved().then(x => { if (alive) setSaved(x); });
    void Promise.all(weeksOf().map(async w => {
      const st = await readStation(w.id);
      return st.done.length > 0 && !stationView(st, DB, w.id).complete ? w.id : null;
    })).then(xs => { if (alive) setGoing(xs.filter(Boolean).pop() ?? null); });
    return () => { alive = false; };
  }, []);
  // «Замер»: первый кадр заглавного экрана после запуска — конец холодного старта
  useEffect(() => {
    const id = requestAnimationFrame(() => mark('title', true));
    return () => cancelAnimationFrame(id);
  }, []);
  // окно программы на мониторе диспетчера (игра владельца 22.11.2026: меню закрывало сцену, а низ фона был светлым):
  // тёмное, как программы пульта, — по экрану монитора; стол под ним виден и приглушён (TitleScene)
  const L = size ? pultLayout(size.w, size.h) : null;
  const win = L ? { top: L.screen.y + 10, bottom: size!.h - (L.screen.y + L.screen.h) + 6 } : null;
  return (
    <View style={styles.root} onLayout={e => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {/* за стеклом — живая сцена: зал, монитор, стол, огонёк телефона (§10 геймдизайна; срез, С8б) */}
      {size ? <TitleScene width={size.w} height={size.h} /> : null}
      {win ? (
        <View style={[styles.window, win]} testID="title-window">
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.head}>
              <Txt title style={styles.name} testID="title-name">{T.title.name}</Txt>
              <Txt style={styles.lead}>{T.title.lead}</Txt>
            </View>
            <View style={styles.actions}>
              {saved ? <Button label={T.title.resume} onPress={onResume} testID="title-resume" /> : null}
              {going ? <Button label={T.title.continueWeek} kind={saved ? 'onDark' : 'primary'} onPress={() => onStation(going)} testID="title-week" /> : null}
              <Button label={T.title.start} kind={saved || going ? 'onDark' : 'primary'} onPress={onStart} testID="title-start" />
              <Txt style={styles.shift}>{T.title.shift}</Txt>
              <View style={styles.row}>
                <View style={styles.half}><Button label={T.title.desk} kind="onDark" onPress={onDesk} testID="title-desk" /></View>
                <View style={styles.half}><Button label={T.title.bench} kind="onDark" onPress={onBench} testID="title-bench" /></View>
              </View>
              <Button label={T.title.settings} kind="onDark" onPress={onSettings} testID="title-settings" />
              <Button label={T.title.about} kind="onDark" onPress={onAbout} testID="title-about" />
            </View>
          </ScrollView>
          {/* ADR 0007: строка всегда на виду — под прокруткой, не в ней */}
          <Txt style={styles.foot} testID="title-not-training">{T.title.notTraining}</Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  root: { flex: 1 },
  // окно программы: цвета пульта (src/scenes/palette.ts), чтобы меню было частью сцены
  window: { position: 'absolute', left: 12, right: 12, borderRadius: R.card, backgroundColor: 'rgba(20,26,31,0.94)', borderWidth: 1, borderColor: UI.line, overflow: 'hidden' },
  scroll: { padding: 20, gap: 20 },
  head: { marginTop: 8, gap: 10 },
  name: { fontSize: S.hero, lineHeight: 44, color: UI.text },
  lead: { fontSize: S.lead, lineHeight: 28, color: UI.text },
  actions: { gap: 12 },
  shift: { textAlign: 'center', color: UI.dim },
  foot: { textAlign: 'center', color: UI.dim, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: UI.line },
});
