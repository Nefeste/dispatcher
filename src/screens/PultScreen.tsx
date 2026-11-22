// Сцена «Пульт» как экран (ADR 0009; части П3, П5): живая карта района, бригады едут по улицам, часы смены идут
// (src/state/session.ts) — касание часов — пауза, касание скорости — ×1, ×2, ×4. Телефон принимает звонок, который
// ждёт дольше всех; касание вызова, ждущего бригаду, — выбор бригады; доклад бригады — выбор больницы.
import React, { useEffect, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { crewOptions, type Shift, type ShiftCtx } from '../engine/shift';
import { T } from '../i18n';
import { textScale } from '../ui/textScale';
import { CrewLayer } from '../scenes/pult/CrewLayer';
import { PultScene } from '../scenes/pult/PultScene';
import { ProgramPanel } from '../scenes/panel';
import { addressOf, crewNo } from '../state/callView';
import { crewAt, crewCard, crewPoint } from '../state/crewView';
import { mark } from '../state/marks';
import { pultView } from '../state/pultView';
import { command, dismissIntro, nextSpeed, session, softOutcome, tick, togglePause, useSession } from '../state/session';
import { pultHint } from '../state/tutorial';
import { HintBar } from '../scenes/hint';
import { pultLayout } from '../scenes/pult/layout';
import { FONTS } from '../ui/fonts';
import { duskOf, nightOf } from '../ui/map/palette';
import { Txt } from '../ui/kit';
import { InsertView } from '../scenes/insert/InsertView';
import { cue } from '../audio/feedback';
import { INSERTS } from './InsertScreen';
import type { OnScene } from '../state/crewView';

/** Где бригады сейчас — точки карты по очереди x, y: едущая — на пути, стоящая — в узле. */
export function positions(ctx: ShiftCtx, s: Shift): number[] {
  return s.crews.flatMap((_, i) => crewPoint(ctx, s, i));
}

/** Палец попадает в знак бригады, если ближе этого к его середине, точек экрана. */
const TAP_DP = 26;

export function PultScreen({ onBack, onCall, onEnd }: { onBack: () => void; onCall: () => void; onEnd: () => void }) {
  const x = useSession();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [crewPick, setCrewPick] = useState<string | null>(null);
  // вставка на месте вызова (срез, С4): касание бригады на месте — короткий ролик, потом её карточка
  // сколько звонков было на линии, когда вставку открыли: новый звонок её закрывает, прежние ждут 3 секунды
  const [scene, setScene] = useState<{ place: OnScene; line: number } | null>(null);
  const pos = useSharedValue<number[]>(x ? positions(x.ctx, x.s) : []);
  // «Замер»: первый кадр пульта — конец загрузки смены (после вставки «начало смены»)
  useEffect(() => {
    const id = requestAnimationFrame(() => mark('pult'));
    return () => cancelAnimationFrame(id);
  }, []);
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
  // новый звонок, просьба бригады или доклад — вставка уступает им сразу и не возвращается
  if (scene && (view.ask || view.report || view.line > scene.line)) setScene(null);
  const picked = pick ? view.waiting.find(w => w.id === pick) : undefined;
  // касание бригады на карте или рации, где она говорила последней, — её карточка; на месте вызова — сперва вставка
  // (срез, С4), но не во время выбора: просьба бригады, доклад, ввод смены
  const openCrew = (id: string | null) => {
    setCrewPick(id);
    const place = id && !view.ask && !view.report && !x.intro ? crewCard(ctx, s, id)?.place : null;
    if (place) setScene({ place, line: view.line });
  };
  const hint = pultHint(ctx, s);
  let panel: React.ReactNode = null;
  if (x.intro) {
    // ввод новой смены (§3, шаг 3): три строки поверх карты; часы стоят, пока его не закрыли
    panel = (
      <ProgramPanel
        testID="intro"
        title={T.intro.lines[0]}
        lead={[T.intro.lines[1], T.intro.lines[2], ...(x.note ? [T.intro.consequence(x.note.n, x.note.inquiries, x.note.refusals)] : [])].join('\n\n')}
        rows={[]}
        actions={[{ label: T.intro.go, onPress: dismissIntro, testID: 'intro-go' }]}
      />
    );
  } else if (view.ask && view.ask.kind === 'resus') {
    // бригада на месте просит реанимационную (срез, С4): послать — одно касание; не ответили — везут сами
    const a = view.ask;
    panel = (
      <ProgramPanel
        testID="ask"
        title={T.ask.head(a.crew, a.no)}
        lead={T.ask.says}
        note={T.ask.auto(a.left)}
        empty={T.ask.none}
        rows={a.crews.map((c, i) => ({
          key: c.id,
          text: T.ask.row(c.no, c.minutes),
          label: T.ask.label(c.no, c.minutes),
          onPress: () => { command({ c: 'second', call: a.call, crew: c.id }); },
          testID: `ask-crew-${i}`,
        }))}
        actions={[{ label: T.ask.own, onPress: () => { command({ c: 'second', call: a.call }); }, testID: 'ask-own' }]}
      />
    );
  } else if (view.ask) {
    // просьба не про медицину (срез, С4, вторая половина): перезвонить звонящему, послать ещё бригаду или «сами»
    const a = view.ask;
    const kind = a.kind as Exclude<typeof a.kind, 'resus'>;
    panel = (
      <ProgramPanel
        testID={`snag-${kind}`}
        title={T.snag.title(a.crew, a.no, T.snag.head[kind])}
        lead={T.snag.says[kind]}
        note={T.snag.auto[kind](a.left)}
        empty={kind === 'victim' ? T.snag.none : undefined}
        rows={a.crews.map((c, i) => ({
          key: c.id,
          text: T.snag.row(c.no, c.kind, c.minutes),
          label: T.snag.label(c.no, c.kind, c.minutes),
          onPress: () => { command({ c: 'snag', call: a.call, act: 'send', crew: c.id }); },
          testID: `snag-crew-${i}`,
        }))}
        actions={[
          ...(kind === 'victim' ? [] : [{ label: T.snag.phone[kind], onPress: () => { command({ c: 'snag', call: a.call, act: 'phone' }); }, testID: 'snag-phone' }]),
          { label: T.snag.wait[kind], onPress: () => { command({ c: 'snag', call: a.call, act: 'wait' }); }, testID: 'snag-wait' },
        ]}
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
    const lineBusy = s.rings.length > 0 || s.open !== null;
    const pickedCall = s.calls.find(c => c.id === picked.id);
    const pickedAddress = pickedCall ? addressOf(ctx, s, pickedCall) : null;
    panel = (
      <ProgramPanel
        testID="crews"
        title={T.crews.head(picked.no)}
        lead={pickedAddress ? T.call.address(pickedAddress) : undefined}
        empty={T.crews.none}
        // линия одна: пока звонит телефон или идёт разговор, перезвонить нельзя — так и сказано
        note={lineBusy ? T.refusal.ringing : undefined}
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
        actions={[
          // перезвонить ждущему — уточнить, пока линия свободна (игра владельца 22.11.2026)
          ...(lineBusy ? [] : [{ label: T.crews.dial, onPress: () => { if (!command({ c: 'dial', call: picked.id })) { setPick(null); onCall(); } }, testID: 'crews-dial' }]),
          { label: T.crews.close, onPress: () => setPick(null), testID: 'crews-close' },
        ]}
      />
    );
  } else if (crewPick) {
    const c = crewCard(ctx, s, crewPick);
    if (c) {
      const left = c.minutes !== null && c.state !== 'base' ? T.crewCard.left[c.state](c.minutes) : null;
      // возвращается с пустой укладкой — не свободна: едет пополнять (срез, С2)
      const state = c.state === 'back' && !c.kit ? 'toRestock' : c.state;
      panel = (
        <ProgramPanel
          testID="crew-card"
          title={T.crewCard.head(c.no, c.kind)}
          lead={[
            T.crewCard.state[state],
            T.crewCard.kit(c.kit),
            ...(c.call ? [T.crewCard.call(c.call.no, c.call.form && c.call.form !== 'none' ? T.review.formWord[c.call.form] : null)] : []),
            ...(c.call?.address ? [T.call.address(c.call.address)] : []),
            ...(c.hospital ? [T.crewCard.hospital(c.hospital)] : []),
          ].join('\n')}
          note={left ?? undefined}
          rows={[]}
          actions={[{ label: T.crewCard.close, onPress: () => setCrewPick(null), testID: 'crew-card-close' }]}
        />
      );
    }
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
          radio={view.radio && view.radio.what === 'died' && softOutcome() ? { ...view.radio, what: 'grave' } : view.radio}
          closing={view.closing}
          dusk={duskOf(view.clock)}
          night={nightOf(view.clock)}
          overlay={zoom => <CrewLayer ctx={ctx} shift={s} pos={pos} zoom={zoom} />}
          panel={panel}
          onPhone={() => { if (!command({ c: 'answer' })) { cue('pickup'); onCall(); } }}
          onWaiting={id => setPick(id)}
          onMapTap={(mx, my, zoom) => openCrew(crewAt(ctx, s, mx, my, TAP_DP / zoom))}
          onRadio={() => openCrew(view.radio?.id ?? null)}
          onClock={togglePause}
          onSpeed={nextSpeed}
        />
      ) : null}
      {size && !x.intro && hint ? <HintBar text={T.tutorial[hint]} top={pultLayout(size.w, size.h, textScale()).map.y + 8} /> : null}
      <Pressable style={styles.back} onPress={onBack} accessibilityRole="button" testID="map-back">
        <Txt style={styles.backText}>{`‹ ${T.common.back}`}</Txt>
      </Pressable>
      {/* вставка на месте — поверх всего пульта, «Назад» тоже под ней: касание пропускает ролик */}
      {scene ? (
        <View style={StyleSheet.absoluteFill}>
          <InsertView key={scene.place} video={INSERTS[scene.place].video} still={INSERTS[scene.place].still} seconds={INSERTS[scene.place].seconds} sound={INSERTS[scene.place].sound} onDone={() => setScene(null)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101315' },
  back: { position: 'absolute', left: 8, bottom: 6, minHeight: 30, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 15, backgroundColor: 'rgba(20,26,31,0.82)', borderWidth: 1, borderColor: '#2c3842' },
  backText: { color: '#e6e9e4', fontSize: 13, fontFamily: FONTS.medium },
});
