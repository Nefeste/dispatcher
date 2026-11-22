// Первый экран (спецификация прототипа, §3, шаг 1; docs/13-art.md, §7): зал диспетчерской ночью, логотип игры и меню —
// окно программы на стекле внизу, под большим пальцем. «Первая неделя» — к выбору смены, а если смена не закончена —
// «Продолжить смену»; настройки и «Об игре». Две пробы прототипа — рабочее место и «Замер» — мелко под меню. Строка
// «Это игра…» (ADR 0007) всегда на виду. Части появляются по очереди; с «Меньше движения» — сразу.
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { mark } from '../state/marks';
import { hasSaved } from '../state/session';
import { DB } from '../content/generated/db';
import { readStation } from '../state/station';
import { weeksOf } from '../state/week';
import { stationView } from '../state/stationView';
import { Appear } from '../ui/anim';
import { Button, Txt } from '../ui/kit';
import { C, G, R } from '../ui/theme';
import { GLASS, UI } from '../scenes/palette';
import { TitleScene } from '../scenes/title/TitleScene';

/** Логотип: «Диспетчер» шрифтом Kurale и «03» в метке кумачом — как метка вызова на значке игры. */
export function Logo({ size = 46 }: { size?: number }) {
  const badge = Math.round(size * 1.02);
  return (
    <View style={styles.logo} accessible accessibilityRole="header" accessibilityLabel={T.title.name} testID="title-name">
      <Txt title style={{ fontSize: size, lineHeight: Math.round(size * 1.2), color: UI.text }}>{T.title.logo.word}</Txt>
      <View style={[styles.badge, { height: badge, minWidth: badge * 1.28, borderRadius: badge / 2, paddingHorizontal: badge * 0.24 }]}>
        <Txt title style={{ fontSize: Math.round(size * 0.74), lineHeight: badge, color: C.kumachInk }}>{T.title.logo.no}</Txt>
      </View>
    </View>
  );
}

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
  return (
    <View style={styles.root} onLayout={e => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {/* за стеклом — живая сцена: зал, видеостена с вызовом, огонёк телефона (§10 геймдизайна; срез, С8б) */}
      {size ? <TitleScene width={size.w} height={size.h} /> : null}
      <Appear delay={120} rise={8} duration={520} style={styles.head}>
        <Txt style={styles.over}>{T.title.over}</Txt>
        <Logo size={size && size.w < 380 ? 40 : 46} />
        <View style={styles.thread} />
        <Txt style={styles.lead}>{T.title.lead}</Txt>
      </Appear>
      <View style={styles.gap} />
      {/* окно программы: стекло в цветах пульта (src/scenes/palette.ts), чтобы меню было частью сцены */}
      <Appear delay={320} rise={16} duration={420} style={styles.window}>
        <ScrollView contentContainerStyle={styles.scroll} testID="title-window">
          {saved ? <Button label={T.title.resume} onPress={onResume} testID="title-resume" /> : null}
          {going ? <Button label={T.title.continueWeek} kind={saved ? 'ghost' : 'primary'} onPress={() => onStation(going)} testID="title-week" /> : null}
          <Button label={T.title.start} kind={saved || going ? 'ghost' : 'primary'} onPress={onStart} testID="title-start" />
          <Txt dim style={styles.shift}>{T.title.shift}</Txt>
          <View style={styles.row}>
            <View style={styles.half}><Button label={T.title.settings} kind="ghost" small onPress={onSettings} testID="title-settings" /></View>
            <View style={styles.half}><Button label={T.title.about} kind="ghost" small onPress={onAbout} testID="title-about" /></View>
          </View>
          <View style={styles.probes}>
            <Txt dim style={styles.probesHead}>{T.title.probes}</Txt>
            <View style={styles.row}>
              <View style={styles.half}><Button label={T.title.desk} kind="quiet" small onPress={onDesk} testID="title-desk" /></View>
              <View style={styles.half}><Button label={T.title.bench} kind="quiet" small onPress={onBench} testID="title-bench" /></View>
            </View>
          </View>
        </ScrollView>
      </Appear>
      {/* ADR 0007: строка всегда на виду — под окном меню, не в прокрутке */}
      <Txt style={styles.foot} testID="title-not-training">{T.title.notTraining}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { paddingHorizontal: G.xl, paddingTop: 44, gap: G.s, flexShrink: 0 },
  over: { color: UI.amber, fontSize: 13, lineHeight: 18, letterSpacing: 0.8, fontWeight: '600' },
  logo: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  badge: { backgroundColor: C.kumach, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  thread: { width: 56, height: 2, borderRadius: 1, backgroundColor: C.kumach, marginTop: 2 },
  lead: { fontSize: 16, lineHeight: 23, color: UI.text, maxWidth: 300 },
  gap: { flexGrow: 1, flexShrink: 1, minHeight: G.m },
  row: { flexDirection: 'row', gap: G.m },
  half: { flex: 1 },
  window: { flexShrink: 1, marginHorizontal: G.m, borderRadius: R.card + 4, backgroundColor: GLASS.window, borderWidth: 1, borderColor: UI.line, borderTopColor: GLASS.edge, overflow: 'hidden' },
  scroll: { padding: G.l, gap: G.m },
  shift: { textAlign: 'center', fontSize: 13, lineHeight: 18 },
  probes: { borderTopWidth: 1, borderTopColor: UI.line, paddingTop: G.s, gap: 2 },
  probesHead: { textAlign: 'center', fontSize: 12, lineHeight: 16 },
  foot: { textAlign: 'center', color: UI.dim, fontSize: 13, lineHeight: 18, paddingHorizontal: G.l, paddingTop: G.m, paddingBottom: G.m },
});
