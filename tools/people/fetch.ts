// Исходники людей Microsoft Rocketbox (MIT) для картинок звонящих (blender/caller.py): скачать файлы закреплённой
// ревизии в папку и сверить SHA-256 со списком tools/people/sources.json. Скачанное — данные, не код: скрипт только
// пишет файлы и проверяет суммы. По образцу bolnitsa: tools/app/people.mjs @ main (--fetch).
//
//   bun tools/people/fetch.ts <папка>        # скачать недостающее, сверить всё
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LIST = JSON.parse(readFileSync(join(import.meta.dir, 'sources.json'), 'utf8')) as {
  repo: string;
  commit: string;
  files: Record<string, string>;
};

const dir = process.argv[2];
if (!dir) throw new Error('укажите папку для исходников: bun tools/people/fetch.ts <папка>');

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const raw = `https://raw.githubusercontent.com/${LIST.repo}/${LIST.commit}/`;

let fetched = 0;
for (const [path, want] of Object.entries(LIST.files)) {
  const file = join(dir, path);
  if (!existsSync(file)) {
    const r = await fetch(raw + path.split('/').map(encodeURIComponent).join('/'));
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, new Uint8Array(await r.arrayBuffer()));
    fetched++;
  }
  const got = sha(readFileSync(file));
  if (got !== want) throw new Error(`${path}: не тот файл (SHA-256 ${got})`);
}
console.log(`Rocketbox ${LIST.commit.slice(0, 7)}: ${Object.keys(LIST.files).length} файлов сверено, скачано ${fetched}`);
