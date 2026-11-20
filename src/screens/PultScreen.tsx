// Сцена «Пульт» как экран (ADR 0009; части П3, П5): живая карта района, бригады едут по улицам, часы смены идут
// (src/state/session.ts) — касание часов — пауза, касание скорости — ×1, ×2, ×4. Телефон принимает звонок, который
// ждёт дольше всех; касание вызова, ждущего бригаду, — выбор бригады; доклад бригады — выбор больницы.
import React, { useEffect, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { pointAt } from '../engine/road/pos';
import { crewOptions, type Shift, type ShiftCtx } from '../engine/shift';
import { T } from '../i18n';
import { CrewLayer } from '../scenes/pult/CrewLayer';
import { PultScene } from '../scenes/pult/PultScene';
import { ProgramPanel } from '../scenes/panel';
import { crewNo } from '../state/callView';
import { pultView } from '../state/pultView';
import { command, dismissIntro, nextSpeed, session, tick, togglePause, useSession } from '../state/session';
import { pultHint } from '../state/tutorial';
import { HintBar } from '../scenes/hint';
import { pultLayout } from '../scenes/pult/layout';
import { FONTS } from '../ui/fonts';
import { duskOf } from '../ui/map/palette';
import { Txt } from '../ui/kit';

/** Где бригады сейчас — точки карты по очереди x, y: едущая — на пути, стоящая — в узле. */
function positions(ctx: ShiftCtx, s: Shift): number[] {
  const out: number[] = [];
  for (const c of s.crews) {
    if (c.route) {
      const [x, y] = pointAt(ctx.map, c.route, s.t);
      out.push(x, y);
    } else {
      out.push(ctx.map.nodes.x[c.at], ctx.map.nodes.y[c.at]);
    }
  }
  return out;
}

export function PultScreen({ onBack, onCall, onEnd }: { onBack: () => void; onCall: () => void; onEnd: () => void }) {
  const x = useSession();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const pos = useSharedValue<number[]>(x ? positions(x.ctx, x.s) : []);
  // часы смены: каждый кадр — настоящее время со скоростью смены; место бригад — в общее значение для карты
  useEffect(() => {
    let raf = 0;
    let last = Date.now();
    const frame = () => {
      const now = Date.now();
      tick(Math.min(250, now - last));
      last = now;
      const y = session();
      if (y) pos.set(positions(y.ctx, y.s));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [pos]);
  // разговор открыт (продолжили смену посреди звонка) — на экран разговора; смена кончилась — к итогу
  useEffect(() => {
    if (x?.s.open) onCall();
    else if (x?.s.over) onEnd();
  }, [x, x?.v, onCall, onEnd]);
  if (!x) return null;
  const { ctx, s } = x;
  const view = pultView(ctx, s);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || size.w !== width || size.h !== height) setSize({ w: width, h: height });
  };
  const picked = pick ? view.waiting.find(w => w.id === pick) : undefined;
  const hint = pultHint(ctx, s);
  let panel: React.ReactNode = null;
  if (x.intro) {
    // ввод новой смены (§3, шаг 3): три строки поверх карты; часы стоят, пока его не закрыли
    panel = (
      <ProgramPanel
        testID="intro"
        title={T.intro.lines[0]}
        lead={`${T.intro.lines[1]}\n\n${T.intro.lines[2]}`}
        rows={[]}
        actions={[{ label: T.intro.go, onPress: dismissIntro, testID: 'intro-go' }]}
      />
    );
  } else if (view.report) {
    const r = view.report;
    panel = (
      <ProgramPanel
        testID="report"
        title={T.report.head(r.crew, r.no)}
        lead={T.report.says(r.diagnosis)}
        note={T.report.auto(r.left)}
        rows={r.hospitals.map((h, i) => ({
          key: h.id,
          text: T.report.row(h.name),
          sub: T.report.sub(h.minutes, h.profiles.map(p => T.profiles[p]).join(' · ')),
          mark: h.suggested ? T.report.offered : undefined,
          label: T.report.label(h.name, h.minutes),
          onPress: () => { command({ c: 'hospital', call: r.call, hospital: h.id }); },
          testID: `report-h-${i}`,
        }))}
      />
    );
  } else if (picked) {
    const opts = crewOptions(ctx, s, picked.id);
    panel = (
      <ProgramPanel
        testID="crews"
        title={T.crews.head(picked.no)}
        empty={T.crews.none}
        rows={opts.map((o, i) => {
          const kind = ctx.db.crews[s.crews.find(c => c.id === o.crew)!.kind].name;
          const min = Math.ceil(o.eta / 60_000);
          return {
            key: o.crew,
            text: T.crews.row(crewNo(o.crew), kind, min),
            mark: o.redirect ? T.crews.redirect : undefined,
            label: T.crews.label(crewNo(o.crew), kind, min, o.redirect),
            onPress: () => { if (!command({ c: 'send', call: picked.id, crew: o.crew })) setPick(null); },
            testID: `crews-${i}`,
          };
        })}
        actions={[{ label: T.crews.close, onPress: () => setPick(null), testID: 'crews-close' }]}
      />
    );
  }
  return (
    <View style={styles.root} onLayout={onLayout}>
      {size ? (
        <PultScene
          width={size.w}
          height={size.h}
          map={ctx.map}
          clock={view.clock}
          speed={x.speed}
          line={view.line}
          waiting={view.waiting.map(w => ({ id: w.id, kind: w.form, minutes: w.minutes, repeats: w.repeats }))}
          radio={view.radio}
          closing={view.closing}
          dusk={duskOf(view.clock)}
          overlay={zoom => <CrewLayer ctx={ctx} shift={s} pos={pos} zoom={zoom} />}
          panel={panel}
          onPhone={() => { if (!command({ c: 'answer' })) onCall(); }}
          onWaiting={id => setPick(id)}
          onRadio={() => {}}
          onClock={togglePause}
          onSpeed={nextSpeed}
        />
      ) : null}
      {size && !x.intro && hint ? <HintBar text={T.tutorial[hint]} top={pultLayout(size.w, size.h).map.y + 8} /> : null}
      <Pressable style={styles.back} onPress={onBack} accessibilityRole="button" testID="map-back">
        <Txt style={styles.backText}>{T.common.back}</Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101315' },
  back: { position: 'absolute', left: 8, bottom: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(20,26,31,0.7)' },
  backText: { color: '#e6e9e4', fontSize: 13, fontFamily: FONTS.medium },
});
