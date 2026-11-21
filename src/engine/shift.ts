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
import {
  ADDRESS_CHANCE, ADDRESS_NEAR, ADDRESS_SEARCH, AGAIN, ANSWER, ASK_AFTER, ASK_WAIT, CALLBACK, CALLBACK_SOON, CLINIC_ARRIVE, CLINIC_HOURS, DECIDE, DOOR_CHANCE, DOOR_WAIT, HANDOVER, NORM_EMERGENCY,
  NORM_URGENT, REPEAT, REPORT_WAIT, SNAG_PHONE, VICTIM_CHANCE, VICTIM_EXTRA, VICTIM_SCENE,
} from './rules';
import { formByKnown, formByTruth, threatsHeard } from './form';
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
  /** звонят снова после отказа в выезде (срез, С3) */
  refused: boolean;
  /** звонит врач поликлиники, которой передали вызов: нужна скорая (срез, С5) */
  clinic: boolean;
  againAt: number;
}

export type CallState = 'ring' | 'talk' | 'wait' | 'clinic' | 'sent' | 'scene' | 'ask' | 'report' | 'transport' | 'hospital' | 'done';

/** Вызов передали в неотложную помощь поликлиники (срез, С5): когда, когда её врач у больного и с чем вернулся вызов. */
export interface Clinic {
  at: number;
  arrive: number;
  /** `emergency` — угроза жизни, нужна скорая; `urgent` — нужна больница, пришлите бригаду; null — поликлиника справилась
   *  (или ещё не приехала) */
  back: 'emergency' | 'urgent' | null;
}

/** Бригада на месте попросила реанимационную (срез, С4; 388н, прил. 2, п. 17) — и что было дальше. */
export interface SecondCrew {
  /** когда попросила и какая бригада */
  at: number;
  by: string;
  /** до какого момента ждёт ответа диспетчера */
  until: number;
  /** послали реанимационную, «везите сами», не ответили — везут сами; null — ждёт ответа */
  answer: 'sent' | 'own' | 'auto' | null;
  /** была ли свободная реанимационная, когда решили (по известному: список бригад был перед глазами) */
  free: boolean;
  /** реанимационная: какая и когда приехала */
  crew: string | null;
  came: number | null;
}

/** Просьба бригады на месте не про медицину (срез, С4, вторая половина; решение владельца #34, вариант 2): не можем
 *  попасть в подъезд, адрес не тот, на месте второй пострадавший. Слова и время — не медицинские факты. */
export type SnagKind = 'door' | 'address' | 'victim';

export interface Snag {
  kind: SnagKind;
  /** когда попросила и какая бригада */
  at: number;
  by: string;
  /** до какого момента ждёт ответа диспетчера; FAR — диспетчер на звонке: срок пойдёт, когда разговор закроют */
  until: number;
  /** просьба решилась без ответа, а срок так и не пошёл — диспетчер всё это время говорил: разбор ошибкой не считает */
  busy: boolean;
  /** перезвонили звонящему, послали ещё бригаду, «ждите» / «сами»; не ответили — `auto`; null — ждёт ответа */
  answer: 'phone' | 'send' | 'wait' | 'auto' | null;
  answeredAt: number | null;
  /** когда бригада снова за делом: войдёт, поедет по верному адресу; null — ещё не решено */
  next: number | null;
  /** когда это случилось; null — ещё нет */
  done: number | null;
  /** сколько ждали бы сами: у подъезда, искать адрес; у второго пострадавшего — на сколько дольше одна бригада, мс */
  wait: number;
  /** второй пострадавший — что было перед глазами, когда решили: была ли свободная бригада; экстренные, ждавшие бригаду */
  free: boolean;
  bypassed: string[];
  /** бригада ко второму пострадавшему и сколько она работает на месте, мс */
  crew: string | null;
  scene: number;
  /** адрес не тот: где больной на самом деле — узел дорог */
  node: number | null;
}

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
  /** бригада приехала, а больной умер до её приезда (срез, С3; по записи `fatal` с источником) */
  died: boolean;
  /** отказали в выезде, когда повод был: когда позвонят снова; null — не позвонят */
  callbackAt: number | null;
  /** когда бригада на месте попросит реанимационную; null — не попросит (срез, С4) */
  askAt: number | null;
  second: SecondCrew | null;
  /** когда бригада начала помогать больному: вошла в подъезд, нашла адрес; null — ещё нет */
  inAt: number | null;
  /** просьба не про медицину, которая случится на этом вызове, — бросок при звонке; экран её не видит */
  plan: SnagKind | null;
  /** когда бригада попросит про второго пострадавшего; null — не попросит */
  snagAt: number | null;
  snag: Snag | null;
  /** передали в поликлинику (срез, С5); null — нет */
  clinic: Clinic | null;
}

export type NoticeKind = 'ring' | 'scene' | 'ask' | SnagKind | 'report' | 'auto' | 'free' | 'restock' | 'base' | 'repeat' | 'recall' | 'end';

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
  /** бригады, которые станция обучила до реанимационных (срез, С4): выходят реанимационными */
  trained: readonly string[];
}

export const NO_LINEUP: Lineup = { extra: [], kits: {}, trained: [] };

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
  | { c: 'hospital'; call: string; hospital: string }
  /** ответ на просьбу бригады на месте: послать реанимационную `crew` или «везите сами» (`crew` нет) */
  | { c: 'second'; call: string; crew?: string }
  /** ответ на просьбу не про медицину: перезвонить звонящему, послать ещё бригаду `crew`, «ждите» / «справитесь сами» */
  | { c: 'snag'; call: string; act: 'phone' | 'send' | 'wait'; crew?: string }
  /** неотложный вызов — в неотложную помощь поликлиники (срез, С5), в её часы */
  | { c: 'pass'; call: string };

/** Почему команду не приняли; слова — src/i18n (T.refusal). */
export type Refusal = 'over' | 'talking' | 'noRing' | 'notOpen' | 'unknown' | 'noForm' | 'crewBusy' | 'noRoute' | 'notReport' | 'notAsked' | 'notResus' | 'clinicClosed' | 'clinicBack';

const lengthOf = (ctx: ShiftCtx) => ctx.setup.length * 1000;

/** О чём бригада на месте ждёт ответа сейчас: реанимационная, просьба не про медицину; null — ни о чём. */
export function asking(call: CallRec): 'resus' | SnagKind | null {
  if (call.state !== 'ask') return null;
  if (call.snag && call.snag.answer === null) return call.snag.kind;
  if (call.second && call.second.answer === null) return 'resus';
  return null;
}
const rngOf = (s: Shift, name: string) => Rng.seeded(s.seed).fork(name);

export function newShift(ctx: ShiftCtx, seed: number, lineup: Lineup = NO_LINEUP): Shift {
  const node = (id: string) => ctx.city.bases.find(b => b.id === id)!.node;
  const crews = [...ctx.setup.crews, ...lineup.extra.filter(x => !ctx.setup.crews.some(c => c.id === x.id))];
  const s: Shift = {
    setup: ctx.setup.id, seed: seed >>> 0, lineup, t: 0, rev: 0, n: 0, script: 0, nextRing: FAR, flowN: 0,
    rings: [], calls: [], crews: crews.map(c => crewAtBase(c.id, lineup.trained.includes(c.id) ? 'crew.resus' : c.kind, node(c.base), lineup.kits[c.id])), open: null, notices: [], trail: [], over: false,
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
    scene, repeatAt: null, repeats: 0, recalled: [], bypassed: [], died: false, callbackAt: null, askAt: null, second: null,
    inAt: null, plan: null, snagAt: null, snag: null, clinic: null,
  });
  const call = s.calls[s.calls.length - 1];
  // просьба не про медицину — только у вызовов потока (учебный звонок учит своему) и не там, где попросят реанимационную
  if (!scripted && !needsResus(ctx, call)) call.plan = planOf(r.fork('snag').int(10_000));
  s.rings.push({ id: `ring.${s.n}`, call: id, at: s.t, repeat: false, again: false, refused: false, clinic: false, againAt: s.t + repeatIn(s, `line:${s.n}`) });
  s.notices.push({ t: s.t, kind: 'ring', call: id });
}

/** Какая просьба не про медицину случится на вызове — по броску 0…9999 (§9 геймдизайна). */
function planOf(u: number): SnagKind | null {
  if (u < ADDRESS_CHANCE) return 'address';
  if (u < ADDRESS_CHANCE + VICTIM_CHANCE) return 'victim';
  if (u < ADDRESS_CHANCE + VICTIM_CHANCE + DOOR_CHANCE) return 'door';
  return null;
}

/** Открыта ли неотложная помощь поликлиники сейчас: в смене с ней и в её часы (срез, С5). */
export function clinicOpen(ctx: ShiftCtx, s: Shift): boolean {
  if (!ctx.setup.clinic) return false;
  const sec = (ctx.setup.start + Math.floor(s.t / 1000)) % 86_400;
  return sec >= CLINIC_HOURS[0] && sec < CLINIC_HOURS[1];
}

/** С чем поликлиника вернёт вызов, когда её врач будет у больного: угроза жизни — нужна скорая; нужна больница —
 *  бригада; иначе — справится сама (по правде: это решает врач на месте). */
function clinicBack(ctx: ShiftCtx, c: CallRec): Clinic['back'] {
  return formByTruth(ctx.db, c.truth) === 'emergency' ? 'emergency' : c.transport ? 'urgent' : null;
}

/** Поликлиника помогла сама: вызов закрыт её приездом. */
function served(c: CallRec): void {
  const at = c.clinic!.arrive;
  c.state = 'done';
  c.arrivedAt = at;
  c.inAt = at;
  c.doneAt = at;
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
  if (crew.state === 'drive' && call && call.second?.crew === crew.id) {
    // приехала реанимационная: первая бригада свободна (её укладка потрачена), дальше — реанимационная, с начала
    const first = crewOf(s, call.crew!)!;
    setCrew(s, home(ctx.road, times, used({ ...first, call: null }), s.t));
    call.second.came = s.t;
    call.crew = crew.id;
    setCrew(s, onScene(crew, s.t + call.scene));
    s.notices.push({ t: s.t, kind: 'scene', call: call.id, crew: crew.id });
  } else if (crew.state === 'drive' && call && call.snag?.crew === crew.id) {
    // ко второму пострадавшему приехала ещё бригада: работает на месте своё время, первая — своё
    setCrew(s, onScene(crew, s.t + call.snag.scene));
    s.notices.push({ t: s.t, kind: 'scene', call: call.id, crew: crew.id });
  } else if (crew.state === 'scene' && call && call.snag?.crew === crew.id) {
    // отработала со вторым пострадавшим — свободна, укладка на вызов меньше
    const worked = used({ ...crew, call: null });
    setCrew(s, home(ctx.road, times, worked, s.t));
    s.notices.push({ t: s.t, kind: worked.kit ? 'free' : 'restock', call: call.id, crew: crew.id });
  } else if (crew.state === 'drive' && call) {
    // у адреса: подъезд закрыт, а как пройти не спросили; адрес не тот — бригада ждёт ответа; иначе — к больному
    const snag = call.snag ? null : arrivalSnag(ctx, s, call, crew);
    if (snag) {
      if (snag.kind === 'door') call.arrivedAt = s.t;
      call.snag = snag;
      call.state = 'ask';
      setCrew(s, onScene(crew, FAR));
      s.notices.push({ t: s.t, kind: snag.kind, call: call.id, crew: crew.id });
    } else reach(ctx, s, call, crew);
  } else if (crew.state === 'scene' && call && call.state === 'ask' && call.snag?.kind === 'victim' && call.snag.answer === null) {
    // бригада кончила со своим больным, а про второго ответа нет — справляется сама, дольше
    alone(ctx, s, call, 'auto');
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

/** Бригада у больного: работает на месте; приехали слишком поздно — по записи с источником состояние убивает без помощи в
 *  срок (третья ступень исхода); нужны специальные методы — общепрофильная попросит реанимационную (срез, С4); на месте
 *  второй пострадавший — попросит ещё бригаду. */
function reach(ctx: ShiftCtx, s: Shift, call: CallRec, crew: Crew): void {
  setCrew(s, onScene(crew, s.t + call.scene));
  call.state = 'scene';
  if (call.arrivedAt === null) call.arrivedAt = s.t;
  call.inAt = s.t;
  if (diedBefore(ctx, s, call)) {
    call.died = true;
    call.transport = false;
  } else if (crew.kind !== 'crew.resus' && needsResus(ctx, call)) call.askAt = s.t + ASK_AFTER;
  else if (call.plan === 'victim' && !call.snag) call.snagAt = s.t + ASK_AFTER;
  s.notices.push({ t: s.t, kind: 'scene', call: call.id, crew: crew.id });
}

/** Просьба у адреса: подъезд закрыт (дома, и «Подъезд, этаж, код?» не спрошено) или адрес не тот (верный — рядом). */
function arrivalSnag(ctx: ShiftCtx, s: Shift, call: CallRec, crew: Crew): Snag | null {
  const r = rngOf(s, `snag:${call.id}`);
  const base = { at: s.t, by: crew.id, until: askUntil(s), busy: false, answer: null, answeredAt: null, next: null, done: null, free: false, bypassed: [], crew: null, scene: 0 };
  if (call.plan === 'door' && call.truth.where === 'home' && !call.asked.some(a => a.q === ACCESS)) {
    return { kind: 'door', ...base, wait: r.fork('wait').range(DOOR_WAIT[0], DOOR_WAIT[1]), node: null };
  }
  if (call.plan === 'address') {
    const dist = search(ctx.road, timesAt(ctx, s.t), call.node).dist;
    const near: number[] = [];
    for (let i = 0; i < dist.length; i++) if (dist[i] >= ADDRESS_NEAR[0] && dist[i] <= ADDRESS_NEAR[1]) near.push(i);
    if (!near.length) return null;
    return { kind: 'address', ...base, wait: r.fork('wait').range(ADDRESS_SEARCH[0], ADDRESS_SEARCH[1]), node: near[r.fork('node').int(near.length)] };
  }
  return null;
}

/** Срок ответа на просьбу не про медицину: диспетчер на звонке — срок не идёт, пока разговор не закроют (окно просьбы
 *  на пульте он увидит только тогда). */
const askUntil = (s: Shift) => (s.open ? FAR : s.t + ASK_WAIT);

/** Вопрос «как пройти»: подъезд, этаж, код домофона (content/questions/access.yaml). */
export const ACCESS = 'q.access';

/** Ответили на просьбу не про медицину «ждите» / «сами» или не ответили: бригада ждёт у подъезда, ищет адрес, работает
 *  со вторым одна — дольше. */
function alone(ctx: ShiftCtx, s: Shift, call: CallRec, answer: 'wait' | 'auto'): void {
  const g = call.snag!;
  g.answer = answer;
  g.answeredAt = s.t;
  g.busy = answer === 'auto' && g.until === FAR;
  if (g.kind === 'victim') {
    // первая бригада работала и пока ждала ответа — теперь со вторым она задержится
    g.free = crewOptions(ctx, s, call.id).some(o => !o.redirect);
    g.done = s.t;
    call.state = 'scene';
    const crew = crewOf(s, call.crew!)!;
    setCrew(s, { ...crew, until: Math.max(crew.until, s.t) + g.wait });
  } else {
    g.next = Math.max(s.t, g.at + g.wait);
    call.state = 'scene';
  }
}

/** Первая бригада снова работает на месте: сколько осталось от её времени там — с тех пор, как просьба её остановила. */
function resume(s: Shift, call: CallRec, stopped: number, extra: number): void {
  call.state = 'scene';
  const crew = crewOf(s, call.crew!)!;
  const left = Math.max(0, call.scene - (stopped - call.inAt!));
  setCrew(s, { ...crew, until: s.t + left + extra });
}

/** Умер ли больной до приезда бригады: запись `fatal`, параметры болезни, опоздание против нормы доезда формы по
 *  правде — и бросок своей ветки. */
function diedBefore(ctx: ShiftCtx, s: Shift, call: CallRec): boolean {
  const f = ctx.db.phone.conditions[call.truth.condition].fatal;
  if (!f) return false;
  const params = call.truth.patient.truth.conditions[0]?.params ?? {};
  if (!Object.entries(f.when ?? {}).every(([k, vs]) => vs.includes(params[k]))) return false;
  const norm = formByTruth(ctx.db, call.truth) === 'emergency' ? NORM_EMERGENCY : NORM_URGENT;
  if (s.t - call.ringAt - norm <= f.late * 60_000) return false;
  return rngOf(s, `fatal:${call.id}`).chance(f.chance);
}

/** Нужна ли реанимационная по записи болезни (`resus`) и её параметрам. */
function needsResus(ctx: ShiftCtx, call: CallRec): boolean {
  const r = ctx.db.phone.conditions[call.truth.condition].resus;
  if (!r) return false;
  const params = call.truth.patient.truth.conditions[0]?.params ?? {};
  return Object.entries(r.when).every(([k, vs]) => vs.includes(params[k]));
}

/** Есть ли сейчас реанимационная, которую можно послать на этот вызов. */
function resusFree(ctx: ShiftCtx, s: Shift, call: CallRec): boolean {
  return crewOptions(ctx, s, call.id).some(o => !o.redirect && crewOf(s, o.crew)?.kind === 'crew.resus');
}

/** «Везите сами»: первая бригада доделывает на месте, что осталось, и дальше — как обычно (доклад, больница). */
function own(ctx: ShiftCtx, s: Shift, call: CallRec, answer: 'own' | 'auto'): void {
  const sc = call.second!;
  sc.answer = answer;
  sc.free = resusFree(ctx, s, call);
  resume(s, call, sc.at, 0);
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
  for (const c of s.calls) if (c.callbackAt !== null) t = Math.min(t, c.callbackAt);
  for (const c of s.calls) if (c.askAt !== null) t = Math.min(t, c.askAt);
  for (const c of s.calls) if (c.state === 'ask' && c.second?.answer === null) t = Math.min(t, c.second.until);
  for (const c of s.calls) if (c.snagAt !== null) t = Math.min(t, c.snagAt);
  for (const c of s.calls) if (c.snag?.answer === null) t = Math.min(t, c.snag.until, c.snag.kind === 'victim' ? FAR : c.snag.at + c.snag.wait);
  for (const c of s.calls) if (c.snag && c.snag.next !== null && c.snag.done === null) t = Math.min(t, c.snag.next);
  for (const c of s.calls) if (c.state === 'clinic' && c.clinic) t = Math.min(t, c.clinic.arrive);
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
    s.rings.push({ id: `ring.${c.id.split('.')[1]}.${c.repeats}`, call: c.id, at: t, repeat: true, again: false, refused: false, clinic: false, againAt: t + repeatIn(s, `line:${c.id}:${c.repeats}`) });
    s.notices.push({ t, kind: 'repeat', call: c.id });
  }
  // бригада на месте просит реанимационную: ждёт ответа, работая на месте (388н, прил. 2, п. 17)
  for (const c of s.calls) {
    if (c.askAt !== t) continue;
    c.askAt = null;
    if (c.state !== 'scene' || !c.crew) continue;
    c.state = 'ask';
    c.second = { at: t, by: c.crew, until: t + ASK_WAIT, answer: null, free: false, crew: null, came: null };
    const crew = crewOf(s, c.crew)!;
    setCrew(s, { ...crew, until: FAR });
    s.notices.push({ t, kind: 'ask', call: c.id, crew: c.crew });
  }
  // на месте второй пострадавший: бригада просит ещё одну и ждёт ответа, работая на месте
  for (const c of s.calls) {
    if (c.snagAt !== t) continue;
    c.snagAt = null;
    if (c.state !== 'scene' || !c.crew) continue;
    const r = rngOf(s, `snag:${c.id}`);
    c.state = 'ask';
    // бригада работает на месте и пока ждёт ответа: она не стоит из-за диспетчера
    c.snag = {
      kind: 'victim', at: t, by: c.crew, until: askUntil(s), busy: false, answer: null, answeredAt: null, next: null, done: null,
      wait: r.fork('extra').range(VICTIM_EXTRA[0], VICTIM_EXTRA[1]), free: false, bypassed: [], crew: null, scene: r.fork('scene').range(VICTIM_SCENE[0], VICTIM_SCENE[1]), node: null,
    };
    s.notices.push({ t, kind: 'victim', call: c.id, crew: c.crew });
  }
  // не ответили на просьбу не про медицину — ждут, ищут, справляются сами; подъезд открыли и адрес нашли и без ответа
  for (const c of s.calls) {
    if (c.state !== 'ask' || c.snag?.answer !== null) continue;
    const self = c.snag.kind !== 'victim' && c.snag.at + c.snag.wait === t;
    if (c.snag.until === t || self) alone(ctx, s, c, 'auto');
  }
  // вошли в подъезд — к больному; адрес уточнили или нашли — едут по верному
  for (const c of s.calls) {
    const g = c.snag;
    if (!g || g.done !== null || g.next !== t || !c.crew) continue;
    g.done = t;
    const crew = crewOf(s, c.crew)!;
    if (g.kind === 'door') reach(ctx, s, c, crew);
    else if (g.kind === 'address') {
      c.node = g.node!;
      const sent = send(ctx.road, timesAt(ctx, t), crew, c.id, c.node, t);
      if (sent) {
        setCrew(s, sent);
        c.state = 'sent';
      } else reach(ctx, s, c, crew);
    }
  }
  // не ответили — везут сами
  for (const c of s.calls) {
    if (c.state !== 'ask' || c.second?.answer !== null || c.second.until !== t) continue;
    own(ctx, s, c, 'auto');
    s.notices.push({ t, kind: 'auto', call: c.id, crew: c.crew! });
  }
  // врач поликлиники у больного: угроза жизни — звонит в скорую, вызов возвращается; нужна больница — просит бригаду;
  // иначе — помог сам, вызов закрыт (срез, С5)
  for (const c of s.calls) {
    if (c.state !== 'clinic' || !c.clinic || c.clinic.arrive !== t) continue;
    const back = clinicBack(ctx, c);
    c.clinic.back = back;
    if (!back) {
      served(c);
      continue;
    }
    // врач поликлиники видел больного: что у него есть из признаков угрозы — теперь известно и диспетчеру
    if (back === 'emergency') {
      for (const x of c.truth.patient.truth.findings) if (ctx.db.phone.findings[x.f]?.threat) c.heard[x.f] = 'yes';
    }
    c.repeats += 1;
    c.state = 'wait';
    c.form = null;
    s.rings.push({ id: `ring.${c.id.split('.')[1]}.${c.repeats}`, call: c.id, at: t, repeat: true, again: false, refused: false, clinic: true, againAt: t + repeatIn(s, `line:${c.id}:${c.repeats}`) });
    s.notices.push({ t, kind: 'repeat', call: c.id });
  }
  // звонят снова после отказа в выезде: тот же вызов, решение можно поменять
  for (const c of s.calls) {
    if (c.callbackAt !== t) continue;
    c.callbackAt = null;
    c.repeats += 1;
    c.state = 'wait';
    // решать заново: прежний отказ остаётся в решениях — его видит разбор
    c.form = null;
    s.rings.push({ id: `ring.${c.id.split('.')[1]}.${c.repeats}`, call: c.id, at: t, repeat: true, again: false, refused: true, clinic: false, againAt: t + repeatIn(s, `line:${c.id}:${c.repeats}`) });
    s.notices.push({ t, kind: 'repeat', call: c.id });
  }
  for (const r of s.rings) if (!r.again && r.againAt === t) r.again = true;
}

function checkOver(ctx: ShiftCtx, s: Shift): void {
  if (s.over || s.t < lengthOf(ctx) || s.open || s.rings.length || ctx.setup.script[s.script]) return;
  // в поликлинике и вернуться не должен — смена его не ждёт: вызов закрыт приездом её врача (срез, С5)
  const left = (c: CallRec) => !(c.state === 'done' && c.callbackAt === null) && !(c.state === 'clinic' && !clinicBack(ctx, c));
  if (!s.calls.some(left)) {
    for (const c of s.calls) if (c.state === 'clinic') {
      c.clinic!.back = null;
      served(c);
    }
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

/** Бригады, которые можно послать на вызов: свободные и едущие на неотложный, если этот — экстренный. Развернуть можно
 *  только бригаду вызова — не вторую, которая едет к нему на помощь (реанимационную, ко второму пострадавшему). */
export function canTake(s: Shift, call: CallRec, crew: Crew): boolean {
  if (free(crew)) return true;
  if (crew.state !== 'drive' || call.form !== 'emergency' || !crew.call || crew.call === call.id) return false;
  const other = callOf(s, crew.call);
  return other?.form === 'urgent' && other.crew === crew.id && other.second?.crew !== crew.id;
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

/** Когда позвонят после отказа: через 1–3 часа, но не позже конца смены; смена кончается — через `CALLBACK_SOON`. */
function callbackAt(ctx: ShiftCtx, s: Shift, call: CallRec): number {
  const at = s.t + rngOf(s, `callback:${call.id}:${call.repeats}`).range(CALLBACK[0], CALLBACK[1]);
  return Math.min(at, Math.max(s.t + CALLBACK_SOON, lengthOf(ctx)));
}

function close(s: Shift): void {
  s.open = null;
  // разговор закрыт — просьбы, пришедшие за это время, ждут ответа своё время с этой минуты
  for (const c of s.calls) if (c.snag && c.snag.answer === null && c.snag.until === FAR) c.snag.until = s.t + ASK_WAIT;
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
      // врач поликлиники сказал «угроза жизни» — по известному вызов экстренный, что бы ни назвал звонящий (срез, С5)
      const known = open.clinic?.back === 'emergency' ? 'emergency' : formByKnown(ctx.db, heard);
      open.decisions.push({ t: s.t, form: cmd.form, known, threats: threatsHeard(ctx.db, heard) });
      runTo(ctx, s, s.t + DECIDE);
      if (cmd.form === 'none') {
        open.state = 'done';
        open.doneAt = s.t;
        open.repeatAt = null;
        // отказ, а повод был (по правде повод есть у каждого вызова: форма — экстренная или неотложная): через 1–3 часа
        // позвонят снова, но в эту смену (§7 геймдизайна)
        // отказали в третий раз — больше не звонят
        open.callbackAt = open.decisions.filter(d => d.form === 'none').length < 3 ? callbackAt(ctx, s, open) : null;
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
    case 'second': {
      const call = callOf(s, cmd.call);
      if (!call) return 'unknown';
      if (asking(call) !== 'resus' || !call.second) return 'notAsked';
      if (!cmd.crew) {
        own(ctx, s, call, 'own');
        s.rev += 1;
        return null;
      }
      const crew = crewOf(s, cmd.crew);
      if (!crew) return 'unknown';
      if (crew.kind !== 'crew.resus') return 'notResus';
      if (!free(crew)) return 'crewBusy';
      const sent = send(ctx.road, timesAt(ctx, s.t), crew, call.id, call.node, s.t);
      if (!sent) return 'noRoute';
      setCrew(s, sent);
      call.second.answer = 'sent';
      call.second.free = true;
      call.second.crew = crew.id;
      call.state = 'scene';
      s.rev += 1;
      return null;
    }
    case 'snag': {
      const call = callOf(s, cmd.call);
      if (!call) return 'unknown';
      const kind = asking(call);
      const g = call.snag;
      if (!kind || kind === 'resus' || !g) return 'notAsked';
      if (cmd.act === 'wait') {
        alone(ctx, s, call, 'wait');
        return null;
      }
      if (cmd.act === 'phone') {
        // перезвонить звонящему — минута диспетчера: пока он говорит, мир идёт; потом бригада входит или едет
        if (kind === 'victim') return 'unknown';
        g.answer = 'phone';
        g.answeredAt = s.t;
        g.next = s.t + SNAG_PHONE;
        call.state = 'scene';
        runTo(ctx, s, g.next);
        return null;
      }
      if (kind !== 'victim') return 'unknown';
      const crew = cmd.crew ? crewOf(s, cmd.crew) : undefined;
      if (!crew) return 'unknown';
      if (!free(crew)) return 'crewBusy';
      const sent = send(ctx.road, timesAt(ctx, s.t), crew, call.id, call.node, s.t);
      if (!sent) return 'noRoute';
      setCrew(s, sent);
      g.answer = 'send';
      g.answeredAt = s.t;
      g.done = s.t;
      g.free = true;
      g.crew = crew.id;
      // экстренные, которые ждали бригаду, пока её послали ко второму (388н, п. 12) — разбор это назовёт
      g.bypassed = s.calls.filter(c => c.state === 'wait' && c.form === 'emergency').map(c => c.id);
      call.state = 'scene';
      return null;
    }
    case 'pass': {
      const call = callOf(s, cmd.call);
      if (!call || open !== call) return 'notOpen';
      if (call.form !== 'urgent') return 'noForm';
      if (!clinicOpen(ctx, s)) return 'clinicClosed';
      // поликлиника уже была и вернула вызов — второй раз не передают
      if (call.clinic) return 'clinicBack';
      call.state = 'clinic';
      call.clinic = { at: s.t, arrive: s.t + rngOf(s, `clinic:${call.id}:${call.repeats}`).range(CLINIC_ARRIVE[0], CLINIC_ARRIVE[1]), back: null };
      call.repeatAt = null;
      s.rings = s.rings.filter(r => r.call !== call.id);
      close(s);
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
