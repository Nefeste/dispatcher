// Экран «Станция» между сменами (срез, часть С2; docs/08-game-design.md, §15): сцена рабочего места, касание предмета —
// окно с письмом, табелем или журналом фонда. Всё, что покупается, — в окне «Закупки» (кнопка внизу; укладка на столе
// открывает его же; игра владельца 22.11.2026): укладки — заказ на выбранные бригады, расширенная укладка, склад,
// бригада, реанимобиль; с подтверждением (src/ui/dialog.tsx). Решений за перерыв — не больше трёх; станция знает
// только итоги смен (src/engine/station.ts).
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { T } from '../i18n';
import { ProgramPanel, type PanelRow } from '../scenes/panel';
import type { StationItem } from '../scenes/station/layout';
import { StationScene } from '../scenes/station/StationScene';
import { softOutcome } from '../state/session';
import { DB } from '../content/generated/db';
import { decideAndSave, readStation } from '../state/station';
import { type Choice, type StationView, stationView } from '../state/stationView';
import { Dialog, type DialogSpec } from '../ui/dialog';
import { Button, Txt } from '../ui/kit';
import { useTextScale } from '../ui/textScale';
import { SCENE, UI } from '../scenes/palette';

/** Нижняя полоса с подсказкой и кнопками, точки экрана. */
const FOOT_MIN = 180;
const HEAD_MIN = 64;

export function StationScreen({ week, onWeek, onNext, onWeekEnd }: { week: string; onWeek: () => void; onNext: (shiftId: string) => void; onWeekEnd: () => void }) {
  const { width, height } = useWindowDimensions();
  // шапка и низ с кнопками — выше с крупным текстом (§12 геймдизайна; срез, С8б); надписи на предметах сцены — нет:
  // их текст целиком — в окне по касанию предмета, а оно растёт
  const k = useTextScale();
  const FOOT = Math.round(FOOT_MIN * k);
  const HEAD = Math.round(HEAD_MIN * k);
  const [view, setView] = useState<StationView | null>(null);
  const [open, setOpen] = useState<StationItem | 'shop' | null>(null);
  // какие бригады в заказе укладок; null — по умолчанию: те, что выходят на следующую смену
  const [picked, setPicked] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const refresh = useCallback(() => {
    void readStation(week).then(st => { setView(stationView(st, DB, week)); setPicked(null); });
  }, [week]);
  useEffect(refresh, [refresh]);
  if (!view) return <View style={styles.root} testID="station-loading" />;

  const S = T.station;
  const no = (id: string) => Number(id.split('.')[1]);
  const ask = (c: Choice) => {
    const d = c.d;
    const title = d.d === 'resus' ? S.confirm.resus(no(d.crew)) : d.d === 'crew' ? S.confirm.crew(c.base ?? '') : d.d === 'kits' ? S.confirm.kits(d.crews.map(no))
      : d.d === 'plus' ? S.confirm.plus(no(d.crew)) : S.confirm.stock(c.base ?? '');
    setDialog({
      title,
      text: S.confirm.text(c.price, view.left - 1),
      actions: [{ label: S.confirm.yes, onPress: () => void decideAndSave(c.d, week).then(refresh) }],
    });
  };
  const choiceRow = (c: Choice, text: string, sub: string, testID: string): PanelRow => ({
    key: testID,
    text,
    // почему нельзя — первой строкой под решением; справа — только цена, чтобы строка не сжималась
    sub: c.no ? `${S.no[c.no]}. ${sub}` : sub,
    mark: S.price(c.price),
    label: `${text}. ${S.price(c.price)}${c.no ? `, ${S.no[c.no]}` : ''}`,
    disabled: Boolean(c.no),
    onPress: () => { if (!c.no) ask(c); },
    testID,
  });

  let panel: React.ReactNode = null;
  if (open === 'letter') {
    const l = view.letter;
    const lines = l
      ? [
          S.letter.score(l.n, l.day, l.inNorm, l.emergency),
          S.letter.income(l.income, view.num.perShift, view.num.perInNorm),
          l.thanks ? S.letter.thanks(view.num.thanks) : S.letter.mistakes,
          ...(l.deaths ? [S.letter.deaths(l.deaths, softOutcome())] : []),
          ...(l.inquiries.length ? [S.letter.inquiry(l.inquiries)] : []),
          ...(l.longWaits ? [S.letter.longWaits(l.longWaits)] : []),
          ...(l.refusals ? [S.letter.refusals(l.refusals)] : []),
          ...(l.fine ? [S.letter.fine(l.fine)] : []),
          S.letter.end,
        ]
      : [S.letter.none];
    panel = <ProgramPanel testID="station-panel-letter" title={l ? S.letter.title(l.n) : S.items.letter} lead={lines.join('\n\n')} rows={[]} actions={[{ label: S.close, onPress: () => setOpen(null), testID: 'station-close' }]} />;
  } else if (open === 'roster') {
    const n = view.next;
    panel = (
      <ProgramPanel
        testID="station-panel-roster"
        title={n ? S.roster.title(n.n, n.day) : S.items.roster}
        lead={n ? n.roster.map(r => `${S.roster.row(r.no, r.kind, r.base)}${r.own ? ` · ${S.roster.own}` : ''} — ${S.roster.kit(r.kit, view.num.kit)}`).join('\n') : S.roster.none}
        rows={[]}
        actions={[
          ...(n ? [{ label: S.shopButton, onPress: () => setOpen('shop'), testID: 'station-roster-shop' }] : []),
          { label: S.close, onPress: () => setOpen(null), testID: 'station-close' },
        ]}
      />
    );
  } else if (open === 'ledger') {
    const rows = view.journal.map(e => {
      const what =
        e.kind === 'shift' ? S.ledger.shift(e.n) : e.kind === 'thanks' ? S.ledger.thanks(e.n) : e.kind === 'complaint' ? S.ledger.complaint(e.n) : e.kind === 'inquiry' ? S.ledger.inquiry(e.n)
          : e.kind === 'crew' ? S.ledger.crew(e.no ?? 0, e.baseName ?? '') : e.kind === 'resus' ? S.ledger.resus(e.no ?? 0)
          : e.kind === 'plus' ? S.ledger.plus(e.no ?? 0) : e.kind === 'stock' ? S.ledger.stock(e.baseName ?? '') : S.ledger.kits((e.crews ?? []).map(no));
      return `${what}: ${S.ledger.amount(e.amount)}`;
    });
    panel = (
      <ProgramPanel
        testID="station-panel-ledger"
        title={S.ledger.title}
        lead={[S.ledger.lead, rows.length ? rows.join('\n') : S.ledger.empty].join('\n\n')}
        note={S.ledger.total(view.fund)}
        rows={[]}
        actions={[{ label: S.close, onPress: () => setOpen(null), testID: 'station-close' }]}
      />
    );
  } else if (open === 'bag' || open === 'shop') {
    // «Закупки»: укладки — отметить бригады и заказать одним решением; дальше — бригады, машины, склады
    const chosen = picked ?? view.kitRows.filter(r => r.next).map(r => r.crew);
    const order = view.order(chosen);
    const toggle = (crew: string) => setPicked(chosen.includes(crew) ? chosen.filter(c => c !== crew) : [...chosen, crew]);
    const kitRows: PanelRow[] = view.kitRows.map(r => ({
      key: `kit-${r.crew}`,
      text: S.shop.kitRow(r.no, r.base, r.kit, r.cap),
      sub: `${r.next ? S.shop.kitNext : S.shop.kitLater} · ${S.price(r.price)}`,
      mark: chosen.includes(r.crew) ? S.shop.chosen : undefined,
      label: `${S.shop.kitRow(r.no, r.base, r.kit, r.cap)}. ${S.price(r.price)}${chosen.includes(r.crew) ? `, ${S.shop.chosen}` : ''}`,
      onPress: () => toggle(r.crew),
      testID: `station-kit-${r.no}`,
    }));
    const orderRow: PanelRow[] = view.kitRows.length && view.next
      ? [{ ...choiceRow(order, S.shop.order(chosen.length, order.price), S.shop.kitPrice(view.num.kitCall), 'station-kits'), disabled: Boolean(order.no) || !chosen.length }]
      : [];
    panel = (
      <ProgramPanel
        testID="station-panel-shop"
        title={S.shop.title}
        lead={[S.shop.lead(view.left), S.kits.lead(view.num.kit, view.num.restockMin), view.kitRows.length ? S.shop.kitsHead : S.shop.kitsFull].join('\n\n')}
        rows={view.next ? [
          ...kitRows,
          ...orderRow,
          ...view.crew.map(c => choiceRow(c, S.roster.crew(c.base ?? ''), S.roster.crewSub(view.num.carB, 2 * view.num.feldsher), `station-crew-${c.d.d === 'crew' ? c.d.base : ''}`)),
          ...view.resus.map(c => choiceRow(c, S.roster.resus(c.crewNo, c.base ?? ''), S.roster.resusSub(view.num.carC, view.num.train), `station-resus-${c.crewNo}`)),
          ...view.stock.map(c => choiceRow(c, S.shop.stock(c.base ?? ''), S.shop.stockSub(view.num.fastMin, view.num.restockMin), `station-stock-${c.d.d === 'stock' ? c.d.base : ''}`)),
          ...view.plus.map(c => choiceRow(c, S.shop.plus(c.crewNo), S.shop.plusSub(view.num.plusCalls), `station-plus-${c.crewNo}`)),
        ] : []}
        empty={S.roster.none}
        actions={[{ label: S.close, onPress: () => setOpen(null), testID: 'station-close' }]}
      />
    );
  }

  const sceneH = height - HEAD - FOOT;
  return (
    <View style={styles.root} testID="station">
      <View style={[styles.head, { height: HEAD }]}>
        <Txt style={styles.title}>{view.letter ? S.title(view.letter.n) : S.titleWeek}</Txt>
        <Txt style={styles.fund} testID="station-fund">{S.fund(view.fund, view.left, view.num.decisions)}</Txt>
      </View>
      <StationScene width={width} height={sceneH} view={view} onItem={setOpen} />
      <View style={[styles.foot, { height: FOOT }]}>
        {view.next ? <Button label={S.shopButton} kind="onDark" onPress={() => setOpen('shop')} testID="station-shop" /> : null}
        <Txt style={styles.hint}>{S.hint}</Txt>
        <View style={styles.buttons}>
          <View style={styles.button}><Button label={S.toWeek} kind="onDark" onPress={onWeek} testID="station-week" /></View>
          {view.next ? (
            <View style={styles.button}><Button label={S.next(view.next.n)} onPress={() => onNext(view.next!.id)} testID="station-next" /></View>
          ) : view.complete ? (
            <View style={styles.button}><Button label={T.week.end} onPress={onWeekEnd} testID="station-weekend" /></View>
          ) : null}
        </View>
      </View>
      {panel ? <View style={[styles.panel, { bottom: FOOT, maxHeight: sceneH * 0.8 }]}>{panel}</View> : null}
      <Dialog spec={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SCENE.hallTop },
  head: { paddingHorizontal: 16, justifyContent: 'center', gap: 2 },
  title: { color: UI.text, fontSize: 16, fontWeight: '600' },
  fund: { color: UI.amber, fontSize: 14 },
  foot: { paddingHorizontal: 16, paddingTop: 10, gap: 10 },
  hint: { color: UI.dim, fontSize: 13, textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: 10 },
  button: { flex: 1 },
  panel: { position: 'absolute', left: 0, right: 0 },
});
