# COA Builder

Build Courses of Action (COAs): named collections of military unit symbols (SIDC, MIL-STD-2525 / APP-6)
placed on a map. Plain HTML, CSS and JavaScript with no build step and no dependencies. Leaflet and
milsymbol are vendored in `vendor/`.

> **Status:** usable end to end in the browser, with every tool in one left panel (COAs, Units, Map
> sections; collapse what you don't need; COAs show the active one, recent ones, or all): create, rename, duplicate and delete COAs; add units
> from presets (affiliation, unit type, echelon, HQ) or a typed SIDC with live preview; place them by
> typing coordinates or "Pick on map"; edit, drag and delete them; tick several to copy them (within the
> COA or to another) or delete them together. Import/export is next.

## Where your COAs are saved

The header shows which is in use:

| Started with | COAs are saved |
|---|---|
| `serve.ps1` / `serve.cmd` | as GeoJSON files, one per COA, in `data/` next to the app (or `-DataDir <folder>`). They open in QGIS or ArcGIS. |
| `serve.py` or any other server | in this browser's storage only: not shared between browsers or machines. |
| storage blocked (some private modes) | **not saved**: memory only. |

With a non-PowerShell server, the browser console shows a harmless `404` for `/api/health`. That's the
app checking for `serve.ps1`.

## Run it

The app must be served over HTTP, because browsers don't load ES modules from `file://`. Use whichever
you have:

| You have | Run | Then open |
|---|---|---|
| **Windows (PowerShell only)** | double-click `serve.cmd`, or `powershell -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1` | http://localhost:8080/ |
| PowerShell 7 (`pwsh`), any OS | `pwsh -File ./serve.ps1` | http://localhost:8080/ |
| Python 3 (macOS, Linux) | `python3 serve.py` | http://localhost:8080/ |

Prefer `serve.ps1` or `serve.py` over `python3 -m http.server`: they tell the browser not to cache, so
after a `git pull` a normal reload always runs the new code. (`http.server` lets the browser keep old files,
which can mix old and new code until a hard reload, Cmd/Ctrl+Shift+R.)

`serve.ps1` options: `-Port 8081` uses another port, and `-Root <folder>` serves another folder. It listens on
`localhost` only, never serves dot-files (such as `.git`) or anything outside its folder, and stops with
Ctrl+C.

**Scripting from the console:** the app client is available as `coaBuilder.client`, e.g.
`await coaBuilder.client.ask('coa.list')`. Every message is listed in `docs/ARCHITECTURE.md`.

## Test it

| What | How |
|---|---|
| Core, adapters, architecture rules | `npm test` (or `node --test`): Node 20+, no install |
| `serve.ps1` | Included in `npm test` when PowerShell is available (`pwsh` on PATH, or set `PWSH=<path>`); skipped otherwise |
| UI (in a real browser) | Start a server, then open http://localhost:8080/tests/browser/ |

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): ports & adapters, UML diagrams, and every message at every boundary.
- [`docs/EPIC-COA-BUILDER.md`](docs/EPIC-COA-BUILDER.md): the plan, stories, decisions and risks.
- [`vendor/README.md`](vendor/README.md): vendored library versions and licenses.
