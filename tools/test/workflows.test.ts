// Порядок работы (ADR студии 0018, 0019, 0022): проверки PR — на каждом PR, имя проверки — то, что ждёт
// автослияние; автослияние — из набора gornitsa-kit; во всех заданиях — ubuntu-24.04. По образцу shelter:
// tools/test/guardrails.test.ts @ 396daee. Сборка APK по тегу — с частью П9, тогда же её проверки.
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
});
