// Порядок работы (ADR студии 0018, 0019, 0022): проверки PR — на каждом PR, имя проверки — то, что ждёт
// автослияние; автослияние — из набора gornitsa-kit; во всех заданиях — ubuntu-24.04. По образцу shelter:
// tools/test/guardrails.test.ts @ 396daee. Сборка APK — только по тегу (ADR студии 0019), без сети и по белому списку
// разрешений (часть П9).
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

const root = join(import.meta.dir, '..', '..');
const wf = (f: string) => YAML.parse(readFileSync(join(root, '.github/workflows', f), 'utf8'));

describe('workflow', () => {
  test('везде ubuntu-24.04; задания набора выбирают машину сами', () => {
    for (const f of readdirSync(join(root, '.github/workflows'))) {
      for (const [job, def] of Object.entries<{ 'runs-on'?: string; uses?: string }>(wf(f).jobs)) {
        if (def.uses) continue;
        expect({ f, job, runsOn: def['runs-on'] }).toEqual({ f, job, runsOn: 'ubuntu-24.04' });
      }
    }
  });

  test('проверки PR — на каждом PR, имя проверки — то, что ждёт автослияние', () => {
    const pr = wf('pr.yml');
    expect(pr.on.pull_request['paths-ignore']).toBeUndefined();
    const am = wf('automerge.yml');
    expect(am.jobs.automerge.uses).toBe('Nefeste/gornitsa-kit/.github/workflows/automerge.yml@v1');
    expect(am.jobs.automerge.with.check).toBe(pr.jobs.checks.name);
    expect(am.on.workflow_run.workflows).toEqual([pr.name]);
  });

  test('APK не собирается на PR', () => {
    const steps: { run?: string }[] = wf('pr.yml').jobs.checks.steps;
    expect(steps.some(s => /prebuild|gradle|assemble/i.test(s.run ?? ''))).toBe(false);
  });

  test('APK — только по тегу vX.Y.Z, без ручного запуска; ключ, подпись, содержимое — из набора @v1', () => {
    const a = wf('android.yml');
    expect(Object.keys(a.on)).toEqual(['push']);
    expect(a.on.push.tags).toEqual(['v*']);
    const steps: { uses?: string; with?: Record<string, string> }[] = a.jobs.build.steps;
    const kit = (name: string) => steps.find(s => s.uses === `Nefeste/gornitsa-kit/actions/${name}@v1`);
    expect(kit('android-keystore')?.with?.['gradle-prefix']).toBe('DISPATCHER');
    expect(kit('android-signature')).toBeDefined();
    const contents = kit('android-contents')!;
    expect(contents.with!['allow-file']).toBe('.github/apk-permissions.txt');
    expect(contents.with!.forbid.split('|')).toContain('INTERNET');
    // приставка свойств Gradle — та же, что читает плагин подписи
    expect(readFileSync(join(root, 'plugins/with-release-signing.js'), 'utf8')).toContain("'DISPATCHER_UPLOAD_STORE_FILE'");
    // выпуск — только с постоянным ключом
    expect(a.jobs.release.if).toBe("needs.key.outputs.ready == 'yes'");
  });

  test('белый список разрешений: без сети, без звонков, без места', () => {
    const allow = readFileSync(join(root, '.github/apk-permissions.txt'), 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
    expect(allow).toEqual(['android.permission.MODIFY_AUDIO_SETTINGS', 'games.gornitsa.dispatcher.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION']);
  });
});
