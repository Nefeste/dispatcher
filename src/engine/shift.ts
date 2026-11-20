// Смена (часть П5; docs/02-architecture.md, §3; docs/08-game-design.md, §2–§5): поток звонков, линия, разговор,
// решение, бригады, доклад и больница. `newShift`, `apply` (команда диспетчера) и `advance` (часы между командами).
// Время — целые миллисекунды от начала смены. Пока открыт разговор, часы стоят, и каждая команда разговора сдвигает
// их на свою цену (ADR 0003); бригады за это время едут. Всё случайное — из зерна смены и его именованных веток: та же
// смена с теми же командами — тот же итог байт в байт. Состояние меняется на месте, `rev` растёт с каждым событием и
// каждой принятой командой — по нему экран знает, что перерисовать; ход часов без событий его не меняет: часы экран
// берёт из `t` (0.10.1 — раньше `rev` рос на каждом кадре, и пульт пересобирался целиком 60–120 раз в секунду). Сохранение — зерно и команды с их временем (src/state/session.ts).
import type { ContentDb } from '../content/med';
import type { City, Db, FormKind, ShiftSetup } from '../content/types';
import { type CallTruth, newCall } from './callers';
import { Rng } from './core/rng';
import { atBase, atHospital, type Crew, crewAtBase, crewNext, free, home, hourPct, nodeNow, onScene, restocked, send, toHospital, used } from './crews';
import { gapAfter } from './flow';
import { edgeTimes, type Road, roadOf } from './road/graph';
import { arrival, passed } from './road/pos';
import { FAR, search } from './road/route';
import { AGAIN, ANSWER, DECIDE, HANDOVER, REPEAT, REPORT_WAIT } from './rules';
import { formByKnown, threatsHeard } from './form';
import { ask as askCaller, type Answer, firstWords, type Heard, type Learned } from './talk';
import type { MapData } from '../map/format';

/** Что не меняется за смену: база, карта, дороги, город. Строится один раз (`shiftCtx`). */
export interface ShiftCtx {
  db: Db;
  med: ContentDb;
  setup: ShiftSetup;
  city: City;
  map: MapData;
  road: Road;
  /** время рёбер по множителю часа — по одному набору на множитель */
  times: Map<number, Uint32Array>;
}

export function shiftCtx(db: Db, med: ContentDb, setupId: string, map: MapData): ShiftCtx {
  const setup = db.shifts[setupId];
  if (!setup) throw new Error(`shiftCtx: unknown shift ${setupId}`);
  // больницы смены — часть больниц города (первая смена недели — одна)
  const all = db.cities[setup.city];
  const city = setup.hospitals ? { ...all, hospitals: all.hospitals.filter(h => setup.hospitals!.includes(h.id)) } : all;
  return { db, med, setup, city, map, road: roadOf(map), times: new Map() };
}

/** Время рёбер в момент `t` смены: по часу суток. */
export function timesAt(ctx: ShiftCtx, t: number): Uint32Array {
  const pct = hourPct(ctx.db.roads.hours, ctx.setup.start + Math.floor(t / 1000));
  let x = ctx.times.get(pct);
  if (!x) ctx.times.set(pct, (x = edgeTimes(ctx.road, ctx.db.roads.kmh, pct)));
  return x;
}

/** Звонок на линии: новый или повторный по вызову, который ждёт бригаду. */
export interface Ring {
  id: string;
  call: string;
  at: number;
  /** повторный: вызов уже принят, бригады всё нет */
  repeat: boolean;
  /** ждал на линии так долго, что перезвонил: «звонят второй раз» */
  again: boolean;
  againAt: number;
}

export type CallState = 'ring' | 'talk' | 'wait' | 'sent' | 'scene' | 'report' | 'transport' | 'hospital' | 'done';

export interface Asked {
  q: string;
  at: number;
  words: string;
  /** какой по счёту раз задан этот вопрос: 0 — впервые */
  n: number;
  /** что узнал диспетчер из этого ответа — для разбора «по известному» */
  learned: Learned[];
}

/** Решение о форме и что было известно в ту минуту (ADR 0005): форма по услышанному и признаки угрозы. */
export interface Decision {
  t: number;
  form: FormKind | 'none';
  known: FormKind;
  threats: string[];
}

export interface CallRec {
  id: string;
  /** правда вызова: экран её не видит (ADR 0005), ему — src/state/callView.ts */
  truth: CallTruth;
  /** узел дорог — адрес на карте */
  node: number;
  state: CallState;
  ringAt: number;
  answeredAt: number | null;
  /** когда открыт этот разговор — последний раз; повторный звонок открывает его снова */
  openedAt: number | null;
  /** первые слова и повод */
  first: { reason: string; words: string; learned: Learned[] } | null;
  asked: Asked[];
  /** что диспетчер узнал о признаках: последнее определённое побеждает «не знаю» */
  heard: Record<string, Heard>;
  age: Answer['age'] | null;
  onset: Answer['onset'] | null;
  form: FormKind | 'none' | null;
  decidedAt: number | null;
  /** все решения о форме по порядку: повторный звонок может её поменять */
  decisions: Decision[];
  crew: string | null;
  /** когда бригаде передан вызов, когда приехала */
  sentAt: number | null;
  arrivedAt: number | null;
  /** доклад: когда, куда предложила везти, везут ли */
  reportAt: number | null;
  suggested: string | null;
  transport: boolean;
  hospital: string | null;
  transportAt: number | null;
  hospitalAt: number | null;
  doneAt: number | null;
  /** сколько стоит бригада на месте, мс — бросок при звонке */
  scene: number;
  /** когда перезвонят, если бригады всё нет; null — не ждут */
  repeatAt: number | null;
  repeats: number;
  /** бригады, которых сняли с этого вызова на экстренный */
  recalled: string[];
  /** экстренные вызовы, которые ждали бригаду, когда этот неотложный её получил (388н, п. 12) */
  bypassed: string[];
}

export type NoticeKind = 'ring' | 'scene' | 'report' | 'auto' | 'free' | 'restock' | 'base' | 'repeat' | 'recall' | 'end';

export interface Notice {
  t: number;
  kind: NoticeKind;
  call?: string;
  crew?: string;
}

/**
 * Что смене даёт станция (срез, часть С2; docs/08-game-design.md, §15): её бригады сверх записи смены и сколько
 * вызовов осталось в укладке каждой бригады с прошлой смены. Нет — бригады записи с полными укладками.
 */
export interface Lineup {
  extra: readonly { id: string; kind: string; base: string }[];
  kits: Readonly<Record<string, number>>;
}

export const NO_LINEUP: Lineup = { extra: [], kits: {} };

export interface Shift {
  setup: string;
  seed: number;
  /** что дала станция: сохраняется со сменой — переигровка начинает с того же */
  lineup: Lineup;
  t: number;
  rev: number;
  /** сколько вызовов родилось — номер следующего */
  n: number;
  /** следующий учебный звонок — номер в script */
  script: number;
  /** когда следующий звонок потока; FAR — больше не будет */
  nextRing: number;
  /** сколько звонков потока было — для ветви зерна */
  flowN: number;
  rings: Ring[];
  calls: CallRec[];
  crews: Crew[];
  /** вызов, разговор по которому открыт: часы стоят */
  open: string | null;
  notices: Notice[];
  /** след бригад за смену: каждый путь по улицам — для снимка смены (спецификация, §5) */
  trail: Trail[];
  over: boolean;
}

/** Путь бригады за смену: узлы и рёбра, зачем ехала (на вызов, в больницу, домой). */
export interface Trail {
  crew: string;
  state: Crew['state'];
  nodes: number[];
  edges: number[];
}

export type Command =
  | { c: 'answer'; ring?: string }
  | { c: 'ask'; q: string }
  | { c: 'form'; form: FormKind | 'none' }
  | { c: 'send'; call: string; crew: string }
  | { c: 'hold'; call: string }
  | { c: 'hospital'; call: string; hospital: string };

/** Почему команду не приняли; слова — src/i18n (T.refusal). */
export type Refusal = 'over' | 'talking' | 'noRing' | 'notOpen' | 'unknown' | 'noForm' | 'crewBusy' | 'noRoute' | 'notReport';

const lengthOf = (ctx: ShiftCtx) => ctx.setup.length * 1000;
const rngOf = (s: Shift, name: string) => Rng.seeded(s.seed).fork(name);

export function newShift(ctx: ShiftCtx, seed: number, lineup: Lineup = NO_LINEUP): Shift {
  const node = (id: string) => ctx.city.bases.find(b => b.id === id)!.node;
  const crews = [...ctx.setup.crews, ...lineup.extra.filter(x => !ctx.setup.crews.some(c => c.id === x.id))];
  const s: Shift = {
    setup: ctx.setup.id, seed: seed >>> 0, lineup, t: 0, rev: 0, n: 0, script: 0, nextRing: FAR, flowN: 0,
    rings: [], calls: [], crews: crews.map(c => crewAtBase(c.id, c.kind, node(c.base), lineup.kits[c.id])), open: null, notices: [], trail: [], over: false,
  };
  // поток — после последнего учебного звонка
  const last = ctx.setup.script.length ? ctx.setup.script[ctx.setup.script.length - 1].at * 1000 : 0;
  s.nextRing = last + gapAfter(ctx.db.flow, ctx.setup.start + Math.floor(last / 1000), rngOf(s, 'flow:0'), ctx.setup.flowPct);
  return s;
}

export const callOf = (s: Shift, id: string) => s.calls.find(c => c.id === id);
export const crewOf = (s: Shift, id: string) => s.crews.find(c => c.id === id);
const repeatIn = (s: Shift, key: string) => {
  const r = rngOf(s, `repeat:${key}`);
  return r.range(REPEAT[0], REPEAT[1]);
};

// --- события -----------------------------------------------------------------------------------------------------

function ring(ctx: ShiftCtx, s: Shift, scripted: ShiftSetup['script'][number] | null): void {
  s.n += 1;
  const id = `call.${s.n}`;
  const r = rngOf(s, `call:${s.n}`);
  const opts = {
    season: ctx.setup.season,
    ...(scripted ? { condition: scripted.condition, caller: scripted.caller, where: scripted.where, ...(scripted.params ? { params: scripted.params } : {}), ...(scripted.first ? { first: scripted.first } : {}) } : {}),
  };
  let truth = newCall(ctx.db, ctx.med, r.fork('seed').u32(), opts);
  // учебный звонок — случай без редкостей: у болезни есть свой признак, о котором можно спросить, а у экстренной —
  // свой признак угрозы (иначе первый урок учит не тому)
  for (let k = 1; scripted && k < 16 && !typical(ctx, truth); k++) truth = newCall(ctx.db, ctx.med, r.fork(`seed:${k}`).u32(), opts);
  const node = r.fork('node').int(ctx.map.nodes.x.length);
  const pc = ctx.db.phone.conditions[truth.condition];
  const scene = r.fork('scene').range(pc.scene[0], pc.scene[1]) * 60_000;
  const transport = r.fork('transport').chance(pc.transport);
  s.calls.push({
    id, truth, node, state: 'ring', ringAt: s.t, answeredAt: null, openedAt: null, first: null, asked: [], heard: {}, age: null, onset: null, form: null, decidedAt: null, decisions: [],
    crew: null, sentAt: null, arrivedAt: null, reportAt: null, suggested: null, transport, hospital: null, transportAt: null, hospitalAt: null, doneAt: null,
    scene, repeatAt: null, repeats: 0, recalled: [], bypassed: [],
  });
  s.rings.push({ id: `ring.${s.n}`, call: id, at: s.t, repeat: false, again: false, againAt: s.t + repeatIn(s, `line:${s.n}`) });
  s.notices.push({ t: s.t, kind: 'ring', call: id });
}

/** Учебный случай: у больного есть признак основной болезни, который знает телефон; у экстренной — признак угрозы. */
function typical(ctx: ShiftCtx, truth: CallTruth): boolean {
  const pc = ctx.db.phone.conditions[truth.condition];
  const own = truth.patient.truth.findings.filter(x => x.cause === truth.condition && ctx.db.phone.findings[x.f]);
  if (!own.length) return false;
  if (pc.form === 'emergency' && !own.some(x => ctx.db.phone.findings[x.f].threat)) return false;
  // «сразу о главном» — значит, есть повод, который называет признак основной болезни
  if (truth.first === 'clear') return Object.values(ctx.db.phone.reasons).some(r => r.when.some(f => own.some(x => x.f === f)));
  return true;
}

/** Ближайшая больница профиля болезни от места вызова; нет такой — общего профиля; нет и её — любая. */
export function suggestHospital(ctx: ShiftCtx, s: Shift, call: CallRec): string {
  const tree = search(ctx.road, timesAt(ctx, s.t), call.node);
  const want = ctx.db.phone.conditions[call.truth.condition].hospital;
  const best = (ok: (h: City['hospitals'][number]) => boolean) =>
    ctx.city.hospitals.filter(h => ok(h) && tree.dist[h.node] !== FAR).sort((a, b) => tree.dist[a.node] - tree.dist[b.node] || a.id.localeCompare(b.id))[0];
  return (best(h => h.profiles.includes(want)) ?? best(h => h.profiles.includes('general')) ?? best(() => true) ?? ctx.city.hospitals[0]).id;
}

function goToHospital(ctx: ShiftCtx, s: Shift, call: CallRec, crew: Crew, hospital: string): void {
  const h = ctx.city.hospitals.find(x => x.id === hospital)!;
  const moved = toHospital(ctx.road, timesAt(ctx, s.t), crew, h.node, s.t);
  setCrew(s, moved ?? atHospital(crew, s.t + HANDOVER));
  call.hospital = hospital;
  call.transportAt = s.t;
  call.state = moved ? 'transport' : 'hospital';
  if (!moved) call.hospitalAt = s.t;
}

function setCrew(s: Shift, c: Crew): void {
  const i = s.crews.findIndex(x => x.id === c.id);
  const old = s.crews[i];
  if (old.route && old.route !== c.route) {
    // путь сменился раньше конца (развернули, послали с дороги домой) — в следе остаётся проеханное
    let last: Trail | undefined;
    for (let j = s.trail.length - 1; j >= 0 && !last; j--) if (s.trail[j].crew === c.id) last = s.trail[j];
    if (last && s.t < arrival(old.route)) {
      const k = passed(old.route, s.t);
      last.nodes = last.nodes.slice(0, k + 1);
      last.edges = last.edges.slice(0, k);
    }
  }
  if (c.route && c.route !== old.route) s.trail.push({ crew: c.id, state: c.state, nodes: Array.from(c.route.nodes), edges: Array.from(c.route.edges) });
  s.crews[i] = c;
}

function crewEvent(ctx: ShiftCtx, s: Shift, crew: Crew): void {
  const call = crew.call ? callOf(s, crew.call) : undefined;
  const times = timesAt(ctx, s.t);
  if (crew.state === 'drive' && call) {
    setCrew(s, onScene(crew, s.t + call.scene));
    call.state = 'scene';
    call.arrivedAt = s.t;
    s.notices.push({ t: s.t, kind: 'scene', call: call.id, crew: crew.id });
  } else if (crew.state === 'scene' && call && call.state === 'scene') {
    // отработала на месте — укладка на вызов меньше; доклад: везти — ждёт ответа диспетчера, не везти — свободна, а с
    // пустой укладкой — едет пополнять
    const worked = used(crew);
    call.reportAt = s.t;
    if (call.transport) {
      call.state = 'report';
      call.suggested = suggestHospital(ctx, s, call);
      setCrew(s, { ...worked, until: s.t + REPORT_WAIT });
      s.notices.push({ t: s.t, kind: 'report', call: call.id, crew: crew.id });
    } else {
      call.state = 'done';
      call.doneAt = s.t;
      setCrew(s, home(ctx.road, times, worked, s.t));
      s.notices.push({ t: s.t, kind: 'report', call: call.id, crew: crew.id });
      if (!worked.kit) s.notices.push({ t: s.t, kind: 'restock', call: call.id, crew: crew.id });
    }
  } else if (crew.state === 'scene' && call && call.state === 'report') {
    // на доклад не ответили — везёт в больницу, которую предложила
    goToHospital(ctx, s, call, crew, call.suggested!);
    s.notices.push({ t: s.t, kind: 'auto', call: call.id, crew: crew.id });
  } else if (crew.state === 'transport' && call) {
    setCrew(s, atHospital(crew, s.t + HANDOVER));
    call.state = 'hospital';
    call.hospitalAt = s.t;
  } else if (crew.state === 'hospital' && call) {
    call.state = 'done';
    call.doneAt = s.t;
    setCrew(s, home(ctx.road, times, crew, s.t));
    s.notices.push({ t: s.t, kind: crew.kit ? 'free' : 'restock', call: call.id, crew: crew.id });
  } else if (crew.state === 'back') {
    // с пустой укладкой — пополняет, извещения нет: «едем пополнять» уже было
    const at = atBase(crew, s.t);
    setCrew(s, at);
    if (at.state === 'base') s.notices.push({ t: s.t, kind: 'base', crew: crew.id });
  } else if (crew.state === 'restock') {
    setCrew(s, restocked(crew));
    s.notices.push({ t: s.t, kind: 'base', crew: crew.id });
  } else {
    // вызова нет (не должно быть): бригада свободна
    setCrew(s, home(ctx.road, times, { ...crew, call: null }, s.t));
  }
}

/** Когда следующее событие смены; FAR — нет. */
function nextAt(ctx: ShiftCtx, s: Shift): number {
  const end = lengthOf(ctx);
  let t = FAR;
  const script = ctx.setup.script[s.script];
  if (script) t = Math.min(t, script.at * 1000);
  else if (s.nextRing < end) t = Math.min(t, s.nextRing);
  for (const c of s.crews) t = Math.min(t, crewNext(c));
  for (const c of s.calls) if (c.state === 'wait' && c.repeatAt !== null) t = Math.min(t, c.repeatAt);
  for (const r of s.rings) if (!r.again) t = Math.min(t, r.againAt);
  return t;
}

/** Всё, что наступает ровно в `s.t`, — по порядку: звонки, бригады, повторные звонки, долгие на линии. */
function fireAll(ctx: ShiftCtx, s: Shift): void {
  const t = s.t;
  const end = lengthOf(ctx);
  const script = ctx.setup.script[s.script];
  if (script && script.at * 1000 === t) {
    s.script += 1;
    ring(ctx, s, script);
  } else if (!script && s.nextRing === t && t < end) {
    ring(ctx, s, null);
    s.flowN += 1;
    s.nextRing = t + gapAfter(ctx.db.flow, ctx.setup.start + Math.floor(t / 1000), rngOf(s, `flow:${s.flowN}`), ctx.setup.flowPct);
  }
  for (const c of [...s.crews]) if (crewNext(c) === t) crewEvent(ctx, s, crewOf(s, c.id)!);
  for (const c of s.calls) {
    if (c.state !== 'wait' || c.repeatAt !== t) continue;
    c.repeatAt = null;
    c.repeats += 1;
    s.rings.push({ id: `ring.${c.id.split('.')[1]}.${c.repeats}`, call: c.id, at: t, repeat: true, again: false, againAt: t + repeatIn(s, `line:${c.id}:${c.repeats}`) });
    s.notices.push({ t, kind: 'repeat', call: c.id });
  }
  for (const r of s.rings) if (!r.again && r.againAt === t) r.again = true;
}

function checkOver(ctx: ShiftCtx, s: Shift): void {
  if (s.over || s.t < lengthOf(ctx) || s.open || s.rings.length || ctx.setup.script[s.script]) return;
  if (s.calls.every(c => c.state === 'done')) {
    s.over = true;
    s.notices.push({ t: s.t, kind: 'end' });
  }
}

/** Довести смену до `to` (мс), проходя все события по порядку. `rev` растёт, если событие было. */
function runTo(ctx: ShiftCtx, s: Shift, to: number): void {
  let fired = false;
  for (;;) {
    const t = nextAt(ctx, s);
    if (t > to) break;
    s.t = Math.max(s.t, t);
    fireAll(ctx, s);
    fired = true;
  }
  s.t = Math.max(s.t, to);
  const wasOver = s.over;
  checkOver(ctx, s);
  if (fired || s.over !== wasOver) s.rev += 1;
}

/** Часы между командами: сдвинуть на `ms`. Пока открыт разговор, часы стоят (ADR 0003). */
export function advance(ctx: ShiftCtx, s: Shift, ms: number): void {
  if (s.open || s.over || ms <= 0) return;
  runTo(ctx, s, s.t + Math.floor(ms));
}

/** Когда следующее событие — для «до следующего события» и тестов. */
export function nextEvent(ctx: ShiftCtx, s: Shift): number {
  return nextAt(ctx, s);
}

// --- команды -----------------------------------------------------------------------------------------------------

function merge(call: CallRec, a: Answer): void {
  for (const l of a.learned) if (l.heard !== 'unsure' || !call.heard[l.f]) call.heard[l.f] = l.heard;
  if (a.age && (!call.age || a.age.exact)) call.age = a.age;
  if (a.onset !== undefined && (a.onset || !call.onset)) call.onset = a.onset;
}

/** Бригады, которые можно послать на вызов: свободные и едущие на неотложный, если этот — экстренный. */
export function canTake(s: Shift, call: CallRec, crew: Crew): boolean {
  if (free(crew)) return true;
  if (crew.state !== 'drive' || call.form !== 'emergency' || !crew.call || crew.call === call.id) return false;
  return callOf(s, crew.call)?.form === 'urgent';
}

export interface CrewOption {
  crew: string;
  /** время доезда, мс; FAR — не доедет */
  eta: number;
  /** развернуть с неотложного */
  redirect: boolean;
}

/** Кого можно послать и за сколько доедет — по возрастанию времени (§5, «Выбор бригады»). */
export function crewOptions(ctx: ShiftCtx, s: Shift, callId: string): CrewOption[] {
  const call = callOf(s, callId);
  if (!call) return [];
  const back = search(ctx.road, timesAt(ctx, s.t), call.node, true);
  return s.crews
    .filter(c => canTake(s, call, c))
    .map(c => ({ crew: c.id, eta: back.dist[nodeNow(c, s.t)], redirect: !free(c) }))
    .filter(o => o.eta !== FAR)
    .sort((a, b) => a.eta - b.eta || a.crew.localeCompare(b.crew));
}

function close(s: Shift): void {
  s.open = null;
}

/** Команда диспетчера. null — принята; иначе — почему нет (смена не меняется). */
export function apply(ctx: ShiftCtx, s: Shift, cmd: Command): Refusal | null {
  const why = command(ctx, s, cmd);
  // принятая команда меняет смену всегда — экран перерисуется
  if (!why) s.rev += 1;
  return why;
}

function command(ctx: ShiftCtx, s: Shift, cmd: Command): Refusal | null {
  if (s.over) return 'over';
  const open = s.open ? callOf(s, s.open)! : null;
  switch (cmd.c) {
    case 'answer': {
      if (open) return 'talking';
      const r = cmd.ring ? s.rings.find(x => x.id === cmd.ring) : s.rings[0];
      if (!r) return 'noRing';
      s.rings = s.rings.filter(x => x !== r);
      const call = callOf(s, r.call)!;
      s.open = call.id;
      call.openedAt = s.t;
      if (call.state === 'ring') {
        call.state = 'talk';
        call.answeredAt = s.t;
        const fw = firstWords(ctx.db, call.truth);
        call.first = { reason: fw.reason, words: fw.words, learned: fw.learned };
        for (const l of fw.learned) call.heard[l.f] = l.heard;
      } else {
        // повторный звонок по вызову, который ждёт бригаду: тот же разговор, решение можно поменять
        call.state = 'talk';
      }
      runTo(ctx, s, s.t + ANSWER);
      return null;
    }
    case 'ask': {
      if (!open) return 'notOpen';
      const q = ctx.db.phone.questions[cmd.q];
      if (!q) return 'unknown';
      const n = open.asked.filter(a => a.q === cmd.q).length;
      // переспросить дешевле; не знал — иногда вспомнит, переспросит у больного (§3, «Уточнить»)
      if (n > 0 && !open.truth.knows[cmd.q]) open.truth.knows[cmd.q] = rngOf(s, `again:${open.id}:${cmd.q}:${n}`).chance(q.tell[open.truth.caller] ?? 0);
      const at = s.t;
      runTo(ctx, s, s.t + (n > 0 ? AGAIN : q.cost * 1000));
      const a = askCaller(ctx.db, ctx.med, open.truth, cmd.q, new Map(Object.entries(open.heard)), n);
      open.asked.push({ q: cmd.q, at, words: a.words, n, learned: a.learned });
      merge(open, a);
      return null;
    }
    case 'form': {
      if (!open) return 'notOpen';
      open.form = cmd.form;
      open.decidedAt = s.t;
      const heard = new Map(Object.entries(open.heard));
      open.decisions.push({ t: s.t, form: cmd.form, known: formByKnown(ctx.db, heard), threats: threatsHeard(ctx.db, heard) });
      runTo(ctx, s, s.t + DECIDE);
      if (cmd.form === 'none') {
        open.state = 'done';
        open.doneAt = s.t;
        open.repeatAt = null;
        close(s);
        s.rings = s.rings.filter(r => r.call !== open.id);
        checkOver(ctx, s);
      }
      return null;
    }
    case 'send': {
      const call = callOf(s, cmd.call);
      const crew = crewOf(s, cmd.crew);
      if (!call || !crew) return 'unknown';
      if (call.form !== 'emergency' && call.form !== 'urgent') return 'noForm';
      if (!(call.state === 'talk' || call.state === 'wait')) return 'unknown';
      if (open && open !== call) return 'talking';
      if (!canTake(s, call, crew)) return 'crewBusy';
      const sent = send(ctx.road, timesAt(ctx, s.t), crew, call.id, call.node, s.t);
      if (!sent) return 'noRoute';
      // сняли с неотложного: тот вызов снова ждёт бригаду
      if (!free(crew) && crew.call) {
        const old = callOf(s, crew.call)!;
        old.state = 'wait';
        old.crew = null;
        old.sentAt = null;
        old.recalled.push(crew.id);
        old.repeatAt = s.t + repeatIn(s, `wait:${old.id}:${old.recalled.length}`);
        s.notices.push({ t: s.t, kind: 'recall', call: old.id, crew: crew.id });
      }
      setCrew(s, sent);
      // неотложный получил бригаду, пока экстренные ждут, — против порядка (388н, п. 12); разбор это назовёт
      if (call.form === 'urgent') call.bypassed = s.calls.filter(c => c !== call && c.state === 'wait' && c.form === 'emergency').map(c => c.id);
      call.state = 'sent';
      call.crew = crew.id;
      call.sentAt = s.t;
      call.repeatAt = null;
      s.rings = s.rings.filter(r => r.call !== call.id);
      if (open === call) close(s);
      s.rev += 1;
      return null;
    }
    case 'hold': {
      const call = callOf(s, cmd.call);
      if (!call || open !== call) return 'notOpen';
      if (call.form !== 'emergency' && call.form !== 'urgent') return 'noForm';
      call.state = 'wait';
      call.repeatAt = s.t + repeatIn(s, `wait:${call.id}:${call.repeats}`);
      close(s);
      s.rev += 1;
      return null;
    }
    case 'hospital': {
      const call = callOf(s, cmd.call);
      if (!call) return 'unknown';
      if (call.state !== 'report') return 'notReport';
      if (!ctx.city.hospitals.some(h => h.id === cmd.hospital)) return 'unknown';
      goToHospital(ctx, s, call, crewOf(s, call.crew!)!, cmd.hospital);
      s.rev += 1;
      return null;
    }
  }
}

// --- сохранение ----------------------------------------------------------------------------------------------------

/** Команда с временем, когда её отдали: сохранение смены — зерно и такие записи (docs/04-data-model.md, §3). */
export interface Logged {
  t: number;
  cmd: Command;
}

/** Переиграть смену: часы до времени команды, команда — и так по порядку. Тот же итог байт в байт. */
export function replay(ctx: ShiftCtx, seed: number, log: readonly Logged[], lineup: Lineup = NO_LINEUP): Shift {
  const s = newShift(ctx, seed, lineup);
  for (const { t, cmd } of log) {
    if (t > s.t) advance(ctx, s, t - s.t);
    apply(ctx, s, cmd);
  }
  return s;
}
