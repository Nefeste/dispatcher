// Типы содержания (docs/04-data-model.md, §1): что собирает tools/content/build.ts из content/ в
// src/content/generated/db.ts (не в git). Чистый TypeScript.

/** Дороги: скорость по классу, км/ч, и множитель часа суток, % («оценка»). */
export interface Roads {
  estimate: boolean;
  kmh: number[];
  hours: { from: number; pct: number }[];
}

/** Вид бригады; класс машины — по 388н, прил. 2. */
export interface CrewKind {
  id: string;
  name: string;
  class: 'A' | 'B' | 'C';
  sources: string[];
  review: 'draft' | 'checked';
}

/** Место на карте: точка записи и узел дорог, к которому её привязала сборка. */
export interface Place {
  id: string;
  name: string;
  at: [number, number];
  node: number;
}

export interface Hospital extends Place {
  profiles: Profile[];
}

/** Подстанция: короткое имя — для табеля станции («Север»). */
export interface Base extends Place {
  short: string;
}

export interface City {
  id: string;
  map: string;
  bases: Base[];
  hospitals: Hospital[];
}

export interface ShiftCrew {
  id: string;
  kind: string;
  base: string;
}

/** Учебный звонок смены: когда, что, кто и откуда звонит. */
export interface ScriptedRing {
  /** секунды от начала смены */
  at: number;
  condition: string;
  caller: string;
  where: 'home' | 'street';
  /** скрытые параметры болезни «Анамнеза»: тяжёлая гипогликемия — `severity: severe` */
  params?: Record<string, string>;
  /** первые слова: `clear` — сразу о главном, `vague` — смутное «плохо»; нет — как у всех (доля `say` повода) */
  first?: 'clear' | 'vague';
}

export interface ShiftSetup {
  id: string;
  city: string;
  /** начало, секунды от полуночи */
  start: number;
  /** длина, секунды */
  length: number;
  /** время года — от него болезни «Анамнеза» */
  season: 'winter' | 'spring' | 'summer' | 'autumn';
  crews: ShiftCrew[];
  /** учебные звонки — до потока */
  script: ScriptedRing[];
  /** поток звонков смены — процент от кривой часа (content/flow.yaml): 100 — как есть (docs/08-game-design.md, §8) */
  flowPct: number;
  /** больницы смены — часть больниц города; null — все */
  hospitals: string[] | null;
  /** место в «Первой неделе» (срез, часть С1): номер, день и час словами, что нового; null — смена не из недели */
  week: { n: number; day: string; what: string } | null;
}

/** Поток звонков: сколько в час — с какого часа суток (оценка). */
export interface Flow {
  estimate: boolean;
  hours: { from: number; perHour: number }[];
}

// --- медицина по телефону (часть П4; docs/04-data-model.md, §1; ADR 0002) ----------------------------------------
// Болезни, признаки, факторы риска — копия базы «Анамнеза» (src/content/generated/med.ts, тип ContentDb из
// src/content/med.ts). Здесь — своё у «Диспетчера»: что о признаке скажет звонящий, какие вопросы его открывают, как
// звонят и с чем, форма вызова, больница, окно. Вероятности — целые доли 1/10 000, как в «Анамнезе».

/** Слова звонящего: от себя («давит в груди») и о другом («говорит, давит в груди»). Шаблоны: `{м|ж}` — по полу
 *  больного, `{^м|ж}` — по полу звонящего, `{who}` и `{Who}` — кто больной звонящему («отец», «соседка»,
 *  «мужчина»), с маленькой и большой буквы. */
export interface Lines {
  self: string[];
  other: string[];
}

/** Признак по телефону — запись phone/findings/<id>.yaml, идентификатор — тот же, что в базе «Анамнеза». */
export interface PhoneFinding {
  id: string;
  /** насколько вероятно, что звонящий этого вида знает, есть признак или нет; вид звонящего → доля 1/10 000 */
  tell: Record<string, number>;
  says: { present: Lines; absent?: Lines };
  /** повод экстренной формы — пункт 388н, п. 11, с буквой; нет — признак угрозы жизни не означает */
  threat?: string;
  /** доли `tell` — оценка, а не факт */
  estimate: boolean;
  sources: string[];
  notes?: string;
  review: 'draft' | 'checked';
}

export type QuestionGroup = 'who' | 'vital' | 'what' | 'see' | 'history' | 'place';
export const QUESTION_GROUPS: readonly QuestionGroup[] = ['who', 'vital', 'what', 'see', 'history', 'place'];

/** Слова ответа по числу: первая полоса, в которую оно попало (`to` — не больше). */
export interface Band<T = string> {
  to: number;
  words: T;
}

/** Вопрос диспетчера — запись questions/<id>.yaml. */
export interface Question {
  id: string;
  group: QuestionGroup;
  /** порядок в группе */
  rank: number;
  /** слова вопроса; `{м|ж}` — по полу больного: диспетчер знает его из первых слов */
  text: string;
  /** поле карточки вызова: «Дыхание» */
  label: string;
  /** цена, игровые секунды (docs/08-game-design.md, §9) */
  cost: number;
  /** признаки, которые он открывает, по порядку: звонящий называет первые два, что есть */
  opens: string[];
  /** все открытые признаки, о которых звонящий знает, — нет */
  none?: Lines;
  /** не признак, а сведения: возраст, когда началось, как пройти; повтор — что ещё не сказано */
  about?: 'age' | 'onset' | 'place' | 'more';
  /** знает ли звонящий этого вида то, о чём вопрос, — доля 1/10 000. Знает — отвечает как есть; не знает — называет
   *  только то, что заметил сам (`tell` признака), иначе «не знаю» */
  tell: Record<string, number>;
  /** для `age`: точный ответ, `{age}` и `{years}` — число и «год», «года», «лет» */
  answer?: Lines;
  years?: [string, string, string];
  /** для `age` — приблизительно, когда точно не знает (лет); для `onset` — по минутам до звонка */
  bands?: Band<Lines>[];
  /** для `place`: слова по месту больного */
  place?: Record<Where, Lines>;
}

export type Where = 'home' | 'street';

/** Кем звонящий приходится больному: его слово и слово о больном по полу больного. */
export interface Relation {
  caller: string;
  /** пол звонящего: «дочь» — ж */
  as: 'm' | 'f';
  patient: { m?: string; f?: string };
  /** только для больных этого пола и возраста */
  sex?: 'm' | 'f';
  /** картинка звонящего для сцены «Разговор» (assets/scenes/callers.json): одна или по полу звонящего; нет — тёмная сцена */
  picture?: string | { m?: string; f?: string };
  age?: [number, number];
}

/** Вид звонящего — запись callers/<id>.yaml. */
export interface CallerKind {
  id: string;
  name: string;
  /** говорит о себе: первое лицо, «кто он» не называет */
  self: boolean;
  at: Where[];
  /** доля среди звонящих, кто мог позвонить (оценка) */
  weight: number;
  relations: Relation[];
  /** больной с любым из этих признаков позвонить так не может: не отвечает — сам не позвонит */
  cannot: string[];
  /** «не знаю» — когда о признаке не знает */
  unsure: string[];
  /** на повтор, когда сказать больше нечего */
  nothing: string[];
  /** первые слова повторного звонка: бригады всё нет */
  again: string[];
  /** звонят снова после отказа в выезде, когда повод был (срез, С3) */
  refused: string[];
  estimate: boolean;
  sources: string[];
  review: 'draft' | 'checked';
}

/** Повод — первые слова звонящего: первый по `rank`, чей признак есть и звонящий о нём знает. */
export interface Reason {
  id: string;
  rank: number;
  /** сколько из тех, кто знает признак повода, с него и начнут (доля 1/10 000, оценка); остальные — со смутного «плохо» */
  say: number;
  /** любой из этих признаков; пусто — повод на всякий случай, если ни один не подошёл */
  when: string[];
  words: Lines;
}

export type FormKind = 'emergency' | 'urgent';
export type Profile = 'stroke' | 'cardio' | 'trauma' | 'neuro' | 'uro' | 'infect' | 'general';
export const PROFILES: readonly Profile[] = ['stroke', 'cardio', 'trauma', 'neuro', 'uro', 'infect', 'general'];

/** Окно состояния: после него опоздание меняет исход (docs/08-game-design.md, §7). */
export interface Window {
  minutes: number;
  /** от начала болезни, от звонка или от прибытия бригады (там ставят диагноз) */
  from: 'onset' | 'call' | 'crew';
  /** только при этих скрытых параметрах болезни «Анамнеза» */
  when?: Record<string, string[]>;
  source: string;
}

/** Болезнь по телефону — запись phone/conditions/<id>.yaml, идентификатор — тот же, что в базе «Анамнеза». */
export interface PhoneCondition {
  id: string;
  /** доля среди вызовов смены, относительный вес (оценка) */
  weight: number;
  /** форма вызова по правде; признак с `threat` у больного делает её экстренной всегда */
  form: FormKind;
  hospital: Profile;
  /** доля тех, кого везут в больницу (оценка) */
  transport: number;
  /** минут на месте (оценка) */
  scene: [number, number];
  /** доля вызовов не из дома: улица, остановка, магазин (оценка) */
  street: number;
  /** минут от начала до звонка: [до, вес] по полосам (оценка) */
  onset: [number, number][];
  window?: Window;
  /** смерть до приезда бригады (срез, часть С3): только если источник говорит, что без помощи в срок состояние
   *  убивает; минуты и шанс — оценка (`estimate`) */
  fatal?: Fatal;
  /** бригада на месте просит реанимационную (срез, часть С4; 388н, прил. 2, п. 17: «когда состояние пациента требует
   *  использования специальных методов»): при этих параметрах, по источнику, где сказано о таком методе */
  resus?: { when: Record<string, string[]>; source: string };
  estimate: boolean;
  sources: string[];
  notes?: string;
  review: 'draft' | 'checked';
}

/** Когда опоздание убивает (docs/08-game-design.md, §7, третья ступень исхода): только опоздание бригады против нормы
 *  доезда — поздний звонок сам по себе не убивает в игре. */
export interface Fatal {
  /** через сколько минут опоздания против нормы доезда смерть возможна (оценка) */
  late: number;
  /** шанс смерти, если бригада приехала позже (оценка): в записи — проценты, в базе — доли 1/10 000, как у Rng.chance */
  chance: number;
  /** только при этих параметрах болезни */
  when?: Record<string, string[]>;
  /** где источник говорит, что без помощи состояние убивает */
  source: string;
}

export interface Phone {
  findings: Record<string, PhoneFinding>;
  conditions: Record<string, PhoneCondition>;
  questions: Record<string, Question>;
  callers: Record<string, CallerKind>;
  reasons: Record<string, Reason>;
}

export interface Db {
  roads: Roads;
  flow: Flow;
  crews: Record<string, CrewKind>;
  cities: Record<string, City>;
  shifts: Record<string, ShiftSetup>;
  phone: Phone;
}
