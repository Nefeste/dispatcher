// Медицина из «Анамнеза» (ADR 0002; docs/02-architecture.md, §4): собрать его базу его же сборкой на закреплённом
// коммите, взять болезни из content/med/select.yaml и всё, на что они ссылаются, и положить в проект:
// - content/med/anamnez.json — собранное подмножество базы (полосы уже в числах, ссылки проверены сборкой «Анамнеза»);
// - content/med/<путь «Анамнеза»> — исходные YAML этих записей байт в байт, для сверки и переноса исправлений;
// - content/med/FROM.yaml — коммит «Анамнеза», SHA-256 подмножества и каждой копии.
// Сборку «Анамнеза» здесь не копируем: она тянет движок его больницы. Запускается вручную, когда «Анамнез» меняется;
// тест сверяет копии с FROM.yaml без «Анамнеза».
//
//   bun tools/content/anamnez.ts <рабочая копия Nefeste/anamnez>   # там нужны зависимости (yaml, zod)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(import.meta.dir, '../..');
const MED = join(ROOT, 'content/med');
const src = process.argv[2];
if (!src) throw new Error('give the path to a Nefeste/anamnez checkout');

type Rec = Record<string, unknown> & { id: string };
type Db = Record<string, unknown> & { conditions: Record<string, Rec>; findings: Record<string, Rec>; risks: Record<string, Rec>; jobs: Record<string, Rec>; rules: Record<string, Rec> };

const commit = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['-C', src, 'status', '--porcelain', '--', 'content', 'src', 'tools'], { encoding: 'utf8' }).trim();
if (dirty) throw new Error(`anamnez checkout has local changes:\n${dirty}`);
const { buildDb } = (await import(join(src, 'tools/content/load.ts'))) as { buildDb: (dir?: string) => { db: Db; errors: string[] } };
const { db, errors } = buildDb(join(src, 'content'));
if (errors.length) throw new Error(`anamnez build failed:\n${errors.slice(0, 20).join('\n')}`);

const select = (parse(readFileSync(join(MED, 'select.yaml'), 'utf8')) as { conditions: string[] }).conditions;

// болезни: выбранные, то, без чего они не бывают, и хронические — сопутствующие (generatePatient берёт их из базы)
const conds = new Set<string>();
const addCond = (id: string) => {
  if (conds.has(id)) return;
  if (!db.conditions[id]) throw new Error(`no condition ${id} in anamnez`);
  conds.add(id);
  for (const r of (db.conditions[id].requires as string[] | undefined) ?? []) addCond(r);
};
for (const id of select) addCond(id);
for (const [id, c] of Object.entries(db.conditions)) if (c.chronic) addCond(id);

// всё, на что ссылаются оставленные записи: признаки, факторы риска, правила, профессии
const ids = (x: unknown, out: Set<string>) => {
  if (typeof x === 'string') out.add(x);
  else if (Array.isArray(x)) x.forEach(v => ids(v, out));
  else if (x && typeof x === 'object') Object.entries(x).forEach(([k, v]) => { out.add(k); ids(v, out); });
};
const findings = new Set<string>(), rules = new Set<string>();
const queue: unknown[] = [...conds].map(id => db.conditions[id]);
queue.push(...Object.values(db.risks), ...Object.values(db.jobs));
while (queue.length) {
  const seen = new Set<string>();
  ids(queue.pop(), seen);
  for (const s of seen) {
    if (db.findings[s] && !findings.has(s)) { findings.add(s); queue.push(db.findings[s]); }
    if (db.rules[s] && !rules.has(s)) { rules.add(s); queue.push(db.rules[s]); }
  }
}

const pick = <T>(rec: Record<string, T>, keep: Set<string>) => Object.fromEntries([...keep].sort().map(id => [id, rec[id]]));
// ссылки оставленных болезней на неоставленные (дифференциал, исключения) — убрать: их в игре нет
const trimmed = Object.fromEntries([...conds].sort().map(id => {
  const c = { ...db.conditions[id] } as Rec;
  for (const k of ['differential', 'excludes'] as const) if (Array.isArray(c[k])) c[k] = (c[k] as string[]).filter(x => conds.has(x));
  return [id, c];
}));
const subset = {
  ...db,
  conditions: trimmed,
  findings: pick(db.findings, findings),
  rules: pick(db.rules, rules),
  exams: {}, treatments: {}, economy: {}, rooms: {}, equipment: {}, roles: {}, presets: {}, characters: {}, chapters: {}, tips: {}, achievements: {}, scores: {}, targets: {}, measures: {}, skills: {}, revealedBy: {},
};
const json = JSON.stringify(subset, null, 1) + '\n';
writeFileSync(join(MED, 'anamnez.json'), json);

// исходные YAML оставленных записей — байт в байт
const yamlFiles = (dir: string): string[] => readdirSync(dir).sort().flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? yamlFiles(p) : n.endsWith('.yaml') ? [p] : [];
});
const keep = new Set<string>([...conds, ...findings, ...rules, ...Object.keys(db.risks), ...Object.keys(db.jobs)]);
for (const top of ['conditions', 'findings', 'risks', 'rules', 'people']) rmSync(join(MED, top), { recursive: true, force: true });
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const files: { path: string; sha256: string }[] = [];
for (const top of ['conditions', 'findings', 'risks', 'rules', 'people/professions']) {
  const dir = join(src, 'content', top);
  if (!existsSync(dir)) continue;
  for (const f of yamlFiles(dir)) {
    const id = /^id:\s*(\S+)/m.exec(readFileSync(f, 'utf8'))?.[1];
    if (!id || !keep.has(id)) continue;
    const rel = relative(join(src, 'content'), f);
    mkdirSync(dirname(join(MED, rel)), { recursive: true });
    copyFileSync(f, join(MED, rel));
    files.push({ path: rel, sha256: sha(readFileSync(f)) });
  }
}
const from = [
  '# Откуда медицина «Диспетчера 03» (ADR 0002): сделано tools/content/anamnez.ts — руками не править.',
  '# Записи под content/med/ — копии «Анамнеза» байт в байт; anamnez.json — подмножество его собранной базы.',
  `anamnez: ${commit}`,
  `contentVersion: ${String(db.contentVersion)}`,
  `bundle: { file: anamnez.json, sha256: ${sha(json)} }`,
  `counts: { conditions: ${conds.size}, findings: ${findings.size}, risks: ${Object.keys(db.risks).length}, jobs: ${Object.keys(db.jobs).length}, rules: ${rules.size} }`,
  'files:',
  ...files.map(f => `  - { path: ${f.path}, sha256: ${f.sha256} }`),
  '',
].join('\n');
writeFileSync(join(MED, 'FROM.yaml'), from);
console.log(`медицина из «Анамнеза» ${commit.slice(0, 7)}: болезней ${conds.size}, признаков ${findings.size}, правил ${rules.size}, файлов ${files.length}, ${Math.round(json.length / 1024)} КБ`);
