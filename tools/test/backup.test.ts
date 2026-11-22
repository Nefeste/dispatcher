// из durak: tools/test/backup.test.ts @ 296f030 — только плагин и app.json; проверки телефона нет: профиля онлайна и
// покупок у игры нет, переезжает всё хранилище. Резервная копия Android (ADR 0010; путь к 1.0, ворота 5).
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { KEYS } from '../../src/state/storage';

const ROOT = join(import.meta.dir, '../..');
const sources = () => (readdirSync(join(ROOT, 'src'), { recursive: true }) as string[])
  .filter(f => /\.tsx?$/.test(f))
  .map(f => `src/${f.split('\\').join('/')}`);

describe('у каждого ключа хранилища есть решение', () => {
  test('все ключи переезжают с копией; новый ключ — решение в ADR 0010 и в этом списке', () => {
    // ключ, который принадлежит телефону (кэш прав на покупку, номер установки), не переезжает: проверка телефона и
    // его стирание на другом, как в «Нардах» (ADR 0010, «Когда пересмотреть»)
    expect(Object.keys(KEYS).sort()).toEqual(['crashlog', 'current', 'history', 'progress', 'settings', 'station', 'week']);
    for (const v of Object.values(KEYS)) expect(v).toMatch(/^dispatcher\.[a-z.]+\.v\d+$/);
    expect(new Set(Object.values(KEYS)).size).toBe(Object.keys(KEYS).length);
  });

  test('в хранилище пишут только через KEYS: AsyncStorage знает один файл', () => {
    const users = sources().filter(f => readFileSync(join(ROOT, f), 'utf8').includes('@react-native-async-storage/async-storage'));
    expect(users).toEqual(['src/state/storage.ts']);
    const literal = sources().filter(f => f !== 'src/state/storage.ts' && /['"]dispatcher\.[a-z.]+\.v\d+['"]/.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(literal).toEqual([]);
  });
});

describe('плагин резервной копии', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { transforms: t } = require('../../plugins/with-backup.js') as {
    transforms: { manifest: (m: object) => { manifest: { $: Record<string, string>; application: { $: Record<string, string> }[] } }; LEGACY: string; RULES: string; FILES: string[] };
  };

  test('в копию — только база AsyncStorage с журналами, и в облако, и при переносе на новый телефон', () => {
    expect(t.FILES).toEqual(['RKStorage', 'RKStorage-journal', 'RKStorage-wal']);
    const includes = (xml: string) => [...xml.matchAll(/<include domain="([a-z]+)" path="([^"]+)" \/>/g)].map(m => `${m[1]}:${m[2]}`);
    const db = t.FILES.map(f => `database:${f}`);
    expect(includes(t.LEGACY)).toEqual(db);
    expect(includes(t.RULES)).toEqual([...db, ...db]);
    expect(t.RULES).toContain('<cloud-backup>');
    expect(t.RULES).toContain('<device-transfer>');
    for (const xml of [t.LEGACY, t.RULES]) expect(xml).not.toContain('<exclude');
  });

  test('манифест: копия включена, наши правила, и они главнее правил библиотек', () => {
    const m = { manifest: { $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' }, application: [{ $: { 'android:name': '.MainApplication', 'android:allowBackup': 'false' } }] } };
    const app = t.manifest(m).manifest.application[0].$;
    expect(app['android:allowBackup']).toBe('true');
    expect(app['android:fullBackupContent']).toBe('@xml/dispatcher_backup_rules');
    expect(app['android:dataExtractionRules']).toBe('@xml/dispatcher_data_extraction_rules');
    expect(app['tools:replace'].split(',').sort()).toEqual(['android:allowBackup', 'android:dataExtractionRules', 'android:fullBackupContent']);
    expect(t.manifest(m).manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
  });

  test('app.json: копия включена и плагин подключён; сборка без копии не выпускается', () => {
    const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as { expo: { android: { allowBackup: boolean }; plugins: (string | unknown[])[] } };
    expect(app.expo.android.allowBackup).toBe(true);
    expect(app.expo.plugins).toContain('./plugins/with-backup.js');
    expect(readFileSync(join(ROOT, '.github/workflows/android.yml'), 'utf8')).toContain("backup: 'on'");
  });
});
