// Снимки карточки RuStore и страницы на сайте: 1080 × 1920 (9 : 16), по сценарию браузера (tools/e2e/browser.ts) в
// окне 432 × 768 × 2,5. Сначала `npm run content && npm run export:web`; затем
//
//   NODE_PATH=/opt/node22/lib/node_modules bun tools/store/shots.ts
//
// Список кадров — SHOTS ниже: имя кадра сценария → имя в store/screenshots/ru/. Подписи и описания — store/site/page.*.md.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const OUT = join(ROOT, 'store', 'screenshots', 'ru');

export const SHOTS: [string, string][] = [
  ['08-call', '01-call.png'],
  ['10-call-crews', '02-crews.png'],
  ['18-crew-card-onsite', '03-map.png'],
  ['19-review', '04-report.png'],
  ['21-call-review', '05-call-review.png'],
  ['22-station', '06-station.png'],
  ['34-week-done', '07-week.png'],
  ['27-desk', '08-desk.png'],
];

const tmp = mkdtempSync(join(tmpdir(), 'dispatcher-shots-'));
const run = spawnSync('bun', [join(ROOT, 'tools', 'e2e', 'browser.ts')], {
  stdio: 'inherit',
  env: { ...process.env, E2E_OUT: tmp, E2E_VIEW: '432x768x2.5' },
});
if (run.status !== 0) process.exit(run.status ?? 1);
mkdirSync(OUT, { recursive: true });
for (const [from, to] of SHOTS) copyFileSync(join(tmp, `${from}.png`), join(OUT, to));
console.log(`store/screenshots/ru: ${SHOTS.length} снимков`);
