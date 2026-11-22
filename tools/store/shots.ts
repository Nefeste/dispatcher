// Снимки карточки RuStore и страницы на сайте: 1080 × 1920 (9 : 16), по сценарию браузера (tools/e2e/browser.ts) в
// окне 432 × 768 × 2,5. Сначала `npm run content && npm run export:web`; затем
//
//   NODE_PATH=/opt/node22/lib/node_modules bun tools/store/shots.ts
//
// Список кадров — SHOTS ниже: имя кадра сценария без номера (номера сдвигаются, когда в сценарий добавляют кадры) →
// имя в store/screenshots/ru/. Подписи и описания — store/site/page.*.md.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const OUT = join(ROOT, 'store', 'screenshots', 'ru');

export const SHOTS: [string, string][] = [
  ['call', '01-call.png'],
  ['call-crews', '02-crews.png'],
  ['pult-waiting', '03-map.png'],
  ['review', '04-report.png'],
  ['call-review', '05-call-review.png'],
  ['station', '06-station.png'],
  ['week-done', '07-week.png'],
  ['desk', '08-desk.png'],
];

const tmp = mkdtempSync(join(tmpdir(), 'dispatcher-shots-'));
const run = spawnSync('bun', [join(ROOT, 'tools', 'e2e', 'browser.ts')], {
  stdio: 'inherit',
  env: { ...process.env, E2E_OUT: tmp, E2E_VIEW: '432x768x2.5' },
});
if (run.status !== 0) process.exit(run.status ?? 1);
mkdirSync(OUT, { recursive: true });
const files = readdirSync(tmp);
for (const [from, to] of SHOTS) {
  const found = files.filter(f => f.replace(/^\d+-/, '') === `${from}.png`);
  if (found.length !== 1) throw new Error(`кадр «${from}»: найдено ${found.length}`);
  copyFileSync(join(tmp, found[0]), join(OUT, to));
}
console.log(`store/screenshots/ru: ${SHOTS.length} снимков`);
