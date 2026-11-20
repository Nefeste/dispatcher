// Настройки игрока: автопауза на новом звонке, звук и «меньше движения» (ADR устава 0023, правило 6;
// docs/08-game-design.md, §10). Чистые функции: разбор сохранённой строки и что действует, если игрок
// «меньше движения» не трогал, — как в системе телефона. Читает и пишет их src/state/storage.ts.
// Разбор строки — из shelter: src/state/settings.ts @ 396daee, изменено: плюс автопауза.

export interface Settings {
  /** новый звонок ставит мир на паузу (ADR 0003) */
  autopause: boolean;
  sound: boolean;
  /** короткий отклик телефона на новый звонок (docs/08-game-design.md, §11) */
  haptics: boolean;
  /** «меньше движения»; не задано — как в системе телефона */
  lessMotion?: boolean;
  /** «Мягкий исход» (срез, С3; решение владельца #25): третья ступень исхода — «помощь опоздала, состояние тяжёлое»
   *  вместо слов о смерти; выключен по умолчанию, последствия на станции от него не меняются */
  softOutcome: boolean;
}

export const DEFAULT_SETTINGS: Settings = { autopause: true, sound: true, haptics: true, softOutcome: false };

/** Сохранённая строка → настройки; мусор и пусто — по умолчанию. */
export function parseSettings(raw: string | null): Settings {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : {};
    const s = v && typeof v === 'object' ? (v as Partial<Settings>) : {};
    const out: Settings = { autopause: s.autopause !== false, sound: s.sound !== false, haptics: s.haptics !== false, softOutcome: s.softOutcome === true };
    if (typeof s.lessMotion === 'boolean') out.lessMotion = s.lessMotion;
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Действует ли «меньше движения»: выбор игрока, а если он не выбирал — системная настройка. */
export function lessMotionOf(s: Settings, system: boolean): boolean {
  return s.lessMotion ?? system;
}
