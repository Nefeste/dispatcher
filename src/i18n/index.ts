// Все строки для игрока (AGENTS.md): экраны читают `T.раздел.ключ` в момент отрисовки, не в константах модуля.
// Тексты содержания (звонящие, вопросы, болезни) — в content/. В прототипе — только русский.
import { APP_BUILD, APP_VERSION } from '../version';

const nb = ' ';

/** Бригады по рации: «Четвёртая, на месте». */
const ORDINAL = ['Первая', 'Вторая', 'Третья', 'Четвёртая', 'Пятая', 'Шестая', 'Седьмая', 'Восьмая'];

export type RadioWhat = 'scene' | 'report' | 'auto' | 'free' | 'base' | 'recall';
const RADIO = { scene: 'на месте', report: 'везём, куда?', stay: 'помощь на месте, свободна', auto: 'везём в предложенную', free: 'свободна', base: 'на подстанции', recall: 'разворачиваемся на экстренный' } as const;
const RADIO_LCD = { scene: 'НА МЕСТЕ', report: 'ДОКЛАД', stay: 'СВОБОДНА', auto: 'ВЕЗЁТ', free: 'СВОБОДНА', base: 'НА ПОДСТАНЦИИ', recall: 'РАЗВОРОТ' } as const;

/** Русское число: 1 звонок, 2 звонка, 5 звонков. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const T = {
  common: {
    back: 'Назад',
    cancel: 'Отмена',
  },
  title: {
    name: 'Диспетчер 03',
    lead: 'Смена диспетчера скорой помощи в большом городе.',
    /** ADR 0007: на первом экране, в «Об игре» и в карточке магазина */
    notTraining: `Это игра. Если нужна помощь —${nb}звоните 103 или 112.`,
    start: 'Начать смену',
    resume: 'Продолжить смену',
    shift: 'Вечер буднего дня, 17:00–19:00 · пять бригад, три больницы',
    desk: 'Рабочее место',
    about: 'Об игре',
  },
  map: {
    title: 'Нижний Новгород: центр и Канавино',
    /** ADR 0004: указание OpenStreetMap на карте — всегда */
    osm: '© участники OpenStreetMap',
  },
  desk: {
    title: 'Рабочее место диспетчера',
    hint: 'Проведите пальцем — оглядеться',
    fps: (n: number) => `${n} к/с`,
    loading: 'Готовим рабочее место…',
    /** экраны мониторов — картинки на Skia (src/scenes/desk/screens.ts); данные — пример вызова для эталонного кадра.
     *  Номер пульта и счётчик времени приёма — как в электронной карте вызова (docs/13-art.md, «Рабочее место») */
    call: {
      head: 'Пульт 7 · Вызов № 41 · 17:42',
      timer: 'на линии 01:24',
      rows: [
        ['Адрес', 'ул. Большая Покровская, 12, кв. 5'],
        ['Кто звонит', 'дочь'],
        ['Повод', 'Маме плохо, не встаёт'],
        ['Возраст', '78 лет'],
        ['Спросили', 'в сознании · дышит · давление'],
      ] as readonly (readonly [string, string])[],
      form: 'экстренная',
      crew: 'Бригада 4 · доезд 9 мин',
    },
    crews: {
      head: 'Бригады',
      rows: [
        ['1', 'общепроф.', 'на подстанции', 'free'],
        ['2', 'общепроф.', 'едет · 6 мин', 'drive'],
        ['3', 'реаним.', 'на месте', 'scene'],
        ['4', 'общепроф.', 'едет на вызов 41', 'drive'],
        ['5', 'общепроф.', 'везёт в больницу', 'transport'],
        ['6', 'общепроф.', 'возвращается', 'back'],
      ] as readonly (readonly [string, string, string, string])[],
    },
    wall: {
      head: 'Оперативная обстановка',
      line: 'На линии: 2 · ждут бригаду: 3 · свободно бригад: 1',
      /** табло загрузки рядом с картой, как в зале Московской станции; доли — в screens.ts (пример кадра) */
      board: 'Загрузка',
      bars: ['Ждут звонка', 'Говорят', 'Бригады на вызовах'],
    },
  },
  /** Сцена «Пульт» (ADR 0009): строки на мониторе, экранчики телефона и рации */
  pult: {
    /** часы смены: часы и минуты от полуночи */
    clock: (secOfDay: number) => {
      const m = Math.floor(secOfDay / 60) % 1440;
      return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    },
    speed: (x: number) => `×${x}`,
    paused: 'пауза',
    line: (n: number) => `На линии: ${n}`,
    phoneLcd: (n: number) => `ЛИНИЯ ${n}`,
    /** рация: экранчик и строка бригады — «Четвёртая, на месте» */
    radioLcd: (n: number, what: RadioWhat, transport = true) => `${n} · ${RADIO_LCD[what === 'report' && !transport ? 'stay' : what]}`,
    radioSays: (n: number, what: RadioWhat, transport = true) => `«${ORDINAL[n - 1] ?? n}, ${RADIO[what === 'report' && !transport ? 'stay' : what]}»`,
    radioIdle: 'ЭФИР',
    waitingHead: 'Ждут бригаду',
    waitingNone: 'Все вызовы с бригадами',
    /** буква формы (цвет — не единственный знак) и слово */
    forms: { emergency: ['Э', 'экстренная'], urgent: ['Н', 'неотложная'] } as const,
    callNo: (id: string) => `№ ${id.split('.')[1]}`,
    waited: (min: number) => `ждёт ${min} мин`,
    repeats: (n: number) => (n > 0 ? ` · звонят ${n + 1}-й раз` : ''),
    closing: 'Смена кончилась: новых звонков нет — доведите вызовы',
    tileLabel: (no: number, form: string, min: number) => `Вызов № ${no}, ${form}, ждёт ${min} минут. Выбрать бригаду`,
    phoneLabel: (n: number) => `Телефон: на линии ${n} ${plural(n, 'звонок', 'звонка', 'звонков')}`,
    radioLabel: 'Рация: последний доклад бригады',
    clockLabel: 'Часы смены: пауза',
    speedLabel: (now: string) => `Скорость смены: ${now}`,
  },
  /** Сцена «Разговор» (ADR 0009): звонящий и опросник на мониторе; вопросы и ответы — из content/ (часть П4) */
  call: {
    /** вкладки опросника по группам вопросов (content/questions, group) */
    tabs: { who: 'Кто', vital: 'Сознание', what: 'Что было', see: 'Видно', history: 'Болезни', place: 'Место' } as const,
    headNo: (no: number) => `Пульт 7 · Вызов № ${no}`,
    timer: (s: number) => `на линии ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`,
    repeat: 'звонят второй раз',
    reason: 'Повод',
    quote: (s: string) => `«${s}»`,
    tabLabel: (name: string) => `Вопросы: ${name}`,
    cost: (s: number) => `${s} с`,
    forms: [
      ['Э', 'Экстренная', 'emergency'],
      ['Н', 'Неотложная', 'urgent'],
      ['—', 'Без выезда', 'none'],
    ] as readonly (readonly [string, string, 'emergency' | 'urgent' | 'none'])[],
    questionLabel: (q: string, s: number) => `Спросить: ${q} Стоит ${s} секунд`,
    formLabel: (f: string) => `Решение: ${f}`,
  },
  /** Выбор бригады (docs/08-game-design.md, §5) — на мониторе после решения и по касанию вызова, ждущего бригаду */
  crews: {
    head: (no: number) => `Кого послать на вызов № ${no}`,
    row: (no: number, kind: string, min: number) => `Бригада ${no} · ${kind} · ${min} мин`,
    redirect: 'снять с неотложного',
    none: 'Свободных бригад нет — вызов подождёт',
    hold: 'Оставить ждать',
    close: 'Закрыть',
    label: (no: number, kind: string, min: number, redirect: boolean) => `Послать бригаду ${no}, ${kind}, доедет за ${min} минут${redirect ? ', снять её с неотложного' : ''}`,
  },
  /** Доклад бригады (§5): что нашла и куда везти */
  report: {
    head: (crew: number, no: number) => `Бригада ${crew} · вызов № ${no}`,
    says: (diagnosis: string) => `Подозрение: ${diagnosis}. Везём — куда?`,
    row: (name: string) => name,
    sub: (min: number, profiles: string) => `${min} мин · ${profiles}`,
    offered: 'предлагает бригада',
    auto: (s: number) => `Нет ответа — через ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} повезут в предложенную`,
    label: (name: string, min: number) => `Везти в ${name}, ${min} минут`,
  },
  /** Профили больниц: строка под именем */
  profiles: { stroke: 'сосудистый центр', cardio: 'кардиология', trauma: 'травма', neuro: 'неврология', uro: 'урология', infect: 'инфекция', general: 'общий' } as const,
  /** Конец смены (§7, «Итог смены»): три числа; разбор — с частью П6 */
  end: {
    title: 'Смена окончена',
    emergency: (inNorm: number, all: number) => `Экстренные с доездом до 20 минут: ${inNorm} из ${all}`,
    urgent: (min: number | null) => (min === null ? 'Неотложных вызовов не было' : `Неотложные ждали бригаду: ${min} мин по медиане`),
    accepted: (n: number) => `Принято звонков: ${n}`,
    review: 'Разбор вызовов появится в следующей части прототипа',
    home: 'На заглавный экран',
  },
  /** Почему команду не приняли (src/engine/shift.ts, Refusal) */
  refusal: {
    over: 'Смена закончилась',
    talking: 'Сначала закончите разговор',
    noRing: 'На линии никого',
    notOpen: 'Разговор не открыт',
    unknown: 'Так нельзя',
    noForm: 'Сначала решите форму вызова',
    crewBusy: 'Бригада занята',
    noRoute: 'Бригада туда не доедет',
    notReport: 'Бригада уже не ждёт ответа',
  },
  insert: {
    skip: 'Коснитесь, чтобы пропустить',
  },
  about: {
    title: 'Об игре',
    what: 'Звонит человек — вы расспрашиваете, решаете, насколько вызов срочный, и отправляете бригаду. После смены — разбор: где ошиблись и чего это стоило.',
    notTraining: `Это игра, а не обучение. Советов, что делать до приезда бригады, в ней нет. Если нужна помощь —${nb}звоните 103 или 112.`,
    fictional: 'Улицы в игре настоящие, а подстанции, больницы и все звонящие — вымышленные.',
    map: `Данные карты — © участники OpenStreetMap, лицензия ODbL: openstreetmap.org/copyright.`,
    medicine: 'Медицина — из названных источников: порядок оказания скорой медицинской помощи и клинические рекомендации Минздрава России. Список — в документах игры.',
    studio: 'Игра студии «Горница» · gornitsa.games',
    version: `Версия ${APP_VERSION} (сборка ${APP_BUILD})`,
  },
} as const;
