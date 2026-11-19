This is «Диспетчер 03» (`dispatcher`), an Expo/React Native mobile game for RuStore: a shift as an ambulance dispatcher
in a big Russian city. A caller describes what happened; the player asks questions, decides how urgent the call is,
sends a crew across a real street map, and after the shift reviews where urgency was misjudged and what it cost.
Prioritize mobile-first patterns, a smooth map on the owner's phone, correctness of every medical fact, and a pure
deterministic engine.

## Studio charter — read first

This project belongs to the «Горница» studio. Studio-wide rules live only in the public
charter repository `Nefeste/gornitsa` (https://github.com/Nefeste/gornitsa); this repository
keeps only what is specific to the project. Before changing anything — and after a context
reset — read the charter's `AGENTS.md`, then `docs/05-rules.md` (hard rules for every game)
and `docs/04-process.md` (how work is done). Raw files:
`https://raw.githubusercontent.com/Nefeste/gornitsa/main/<path>`.

Current state of this project: `STATUS.md` (it is not repeated here).

Precedence: the owner's recorded decision → the charter → this project's documents. A project
rule may narrow a charter rule, never weaken it. If a document here restates or contradicts
the charter, replace it with a link or report the contradiction to the owner.

## Read `docs/` before changing anything

The project documents itself in [`docs/`](docs/README.md), in Russian. Start there:

- `docs/README.md` — index and reading order.
- `docs/01-product.md` — what we promise the player, what is deliberately absent, the vocabulary (UI and code terms
  must match it).
- `docs/08-game-design.md` — the game as it should ship in 1.0; **all game-design numbers live only there** (medical
  numbers live in content records with their sources).
- `docs/09-content.md` — medicine, callers and the map: allowed and forbidden sources, record rules, checks. **Read
  before adding or editing any content record.**
- `docs/02-architecture.md`, `docs/04-data-model.md` — how it is built.
- `docs/07-roadmap.md` — stages, prototype parts, owner questions (Issues labelled `владелец`) and decisions.
- `docs/specs/2026-11-prototype.md` — the live specification: what the prototype must answer.
- `docs/adr/` — decisions that are expensive to reverse; read the relevant one *before* proposing the opposite.
  `docs/adr/0001-studio-adrs.md` says how the studio ADRs apply here.

## Sister projects

The medical model comes from `Nefeste/anamnez` **by copying** with a source line on top of each file (studio ADR 0002,
project ADR 0002): `// из anamnez: src/engine/med/infer.ts @ <commit>`. Anamnez content records are copied byte for byte
into `content/med/` and listed in `content/med/FROM.yaml`; this game's own fields live in separate `content/phone/`
records with the same id. A fix in a copied file is a task to carry it to the other side as well. The hourly flow and the
«virtual player» follow `Nefeste/bolnitsa`; the dialog, i18n mechanics, crash log, storage and settings come from
`Nefeste/votchina`; CI comes from the studio kit `Nefeste/gornitsa-kit` (studio ADR 0022). Map and copy table —
`docs/02-architecture.md`, «Что берём у соседей».

## Expo and native SDKs

Planned Expo SDK 57, as the sister projects. Never write Expo, React Native, `@shopify/react-native-skia`,
Reanimated or gesture-handler code from memory — follow «Expo has changed» in the charter's `AGENTS.md`; if
`docs.expo.dev` is unreachable, the working configuration of `Nefeste/votchina` (same SDK) is the reference, and of
`Nefeste/anamnez` for Skia on the web.

## Commands

```bash
npm ci                              # dependencies (npm; tests and tools run in Bun)
npx expo install <package>          # ALWAYS instead of npm/yarn/bun add — SDK-compatible versions
npx expo start                      # dev server
npm run typecheck                   # tsc (app) + tsc -p tools
npm run lint                        # zero warnings; engine purity rules for src/engine
bun test tools/test                 # i18n guard, version, settings, docs links, workflows, map file, road search
bun tools/map/fetch.ts nn-center    # OSM extract of a district via Overpass (network) → map-src/ (not in git)
bun tools/map/build.ts nn-center    # → src/map/generated/nn-center.ts + passport assets/map/nn-center.json
python blender/build.py             # the workplace model: src/art/desk.gen.ts + assets/models/ (bpy==4.5.15, Python 3.11)
npm run export:web                  # web build into dist-web/
NODE_PATH=/opt/node22/lib/node_modules bun tools/e2e/browser.ts   # the browser scenario, shots in tools/e2e/out/
```

Run typecheck, lint, tests and — for UI changes — the web build and the browser scenario before every push
(`.github/workflows/pr.yml` runs the first three on every PR; `docs/06-testing.md`).

## Hard rules

Studio-wide rules — no React Native `Alert`, player-facing strings only in `src/i18n/` and `content/`, generated
`ios/`/`android/`, a permanent application id and signing key, a pure engine, no pressure, no geolocation, content only
from named sources — are in the charter's `docs/05-rules.md` and are not repeated here. This project's own rules:

- **Medical content follows Anamnez's rules** (its `AGENTS.md`, «Medical content rules», and `docs/11-content.md`):
  named primary sources only (Russian Ministry of Health orders and clinical guidelines cited by their rubricator entry),
  never from memory, never data, files or structure from other games (911 Operator, 911 Emergency Dispatcher or any
  other — not "to compare" either), no doses, no regimens, no brand names, eternal ids, every new record
  `review: draft` — only a human raises it to `checked`.
- **A game, not training** (ADR 0007): the dispatcher asks, decides and sends; there are no first-aid instructions or
  advice to the caller anywhere in the game. The title screen, «Об игре» and the store card carry «Это игра. Если нужна
  помощь — звоните 103 или 112.»
- **The screen never sees the truth** (ADR 0005): screens get the call view from `src/state/callView.ts` (what was said
  and learned); only the review of a finished shift reads the patient's truth. The review judges a decision by what was
  known then, and the outcome by the truth — separately.
- **Real streets, fictional institutions** (ADR 0004): roads, rivers and bridges come from OpenStreetMap, built into
  `src/map/generated/<area>.ts` by `tools/map/fetch.ts` + `tools/map/build.ts` with a passport in `assets/map/` (query,
  OSM date, SHA-256, licence); never edit generated map files by hand; substations and
  hospitals are fictional and never carry the name of a real one. «© участники OpenStreetMap» is always visible on the
  map and in «Об игре». No real call recordings or transcripts — every caller and line is written.
- **The engine is pure TypeScript** (`src/engine/`): integer seconds, no React, no `Date`, no `Math.random`, seeded named
  branches; `newShift`, `apply(db, state, command)`, `advance(db, state, seconds)`. The conversation is turn-based in game
  seconds (ADR 0003): while a call is open the clock stands and each question moves it by its cost.
- **Portrait only** (ADR 0006).
- **No server, no network calls**; no location, contacts, camera or microphone permission. `INTERNET` only if the
  owner chooses a purchase (RuStore Pay); the permission white list arrives with the first code.
- **Scenes, not button columns** (ADR 0009, owner's decision in `Nefeste/uprava#121`): shift screens are full-screen Skia
  scenes — the dispatcher's desk with the live map monitor, the caller's picture with the call card — over frames
  pre-rendered from Blender scripts and Three.js; live Three.js only where the camera moves. Video inserts only where
  they fit, skippable, never during a call or a choice. Skia stays on version 2.
- `applicationId` is `games.gornitsa.dispatcher` — eternal (charter ADR 0006; owner's decision in #4).
- Never press «Merge»; merging follows charter ADR 0018 (owner paths in `.github/CODEOWNERS`).
