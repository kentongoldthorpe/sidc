# COA Builder

Build Courses of Action (COAs): named collections of military unit symbols (SIDC, MIL-STD-2525 / APP-6)
placed on a map. Plain HTML, CSS and JavaScript with no build step and no dependencies. Leaflet and
milsymbol are vendored in `vendor/`.

> **Status:** usable end to end in the browser, with every tool in one left panel (COAs, Units, Map
> sections; collapse what you don't need; COAs show the active one, recent ones, or all): create, rename, duplicate and delete COAs; add units
> from presets (affiliation, unit type, echelon, HQ) or a typed SIDC with live preview; place them by
> typing coordinates or "Pick on map"; edit, drag and delete them; tick several to copy them (within the
> COA or to another) or delete them together. Export PNG slides from the Export section (classification bars, title, DTG, map, legend; 16:9, 4:3 or 5:4). Draw phase lines, boundaries, axes,
> routes, objectives and other areas, and range rings in **Lines & areas**. Save COAs as JSON, GeoJSON or CSV
> (Export → Data file) and bring them back, or files from other systems, with **Import COAs…**.
> **Back up all COAs** (COAs section) saves everything in one file; if saving ever fails, a banner says so.
> **Undo / Redo** (header, Ctrl+Z / Ctrl+Shift+Z) work per COA; a deleted COA can be brought back with Undo.
> Keyboard: **Delete** removes the selected unit or line, **arrow keys** nudge it (Shift: further), **Esc** closes the editor;
> lines and rings can also be added from typed coordinates (Lines & areas → Or type the points).
> **Snap** (on the map and the template canvas) puts points on existing points, on the grid, or at 15°/45°/90°
> from the last point; hold **Alt** to place freely. On the canvas it also sets the grid spacing (50 m to 10 km).
> **Map → MGRS grid** draws the Military Grid Reference System (100 km down to 100 m lines as you zoom) and shows the
> MGRS reference under the pointer; grid snapping then uses it. Positions can be typed as MGRS grids anywhere
> (unit editor, Or type the points, imports with an `mgrs` column or field).

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
| UI (headless) | `npm run test:browser`: serves the repo itself and uses Playwright's Chromium if Playwright is installed; otherwise it says how to run the specs in a browser |

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): ports & adapters, UML diagrams, and every message at every boundary.
- [`CHANGELOG.md`](CHANGELOG.md) and [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md): what changed, and how to test and package a release (`npm run package` → a zip for an offline machine).
- [`docs/UI-STYLE.md`](docs/UI-STYLE.md): the panel's building blocks (groups, segmented choices, buttons, hints) and their rules.
- [`docs/IMPORT-FORMAT.md`](docs/IMPORT-FORMAT.md): the import file format for systems that produce COAs, with a JSON Schema and examples in [`docs/import/`](docs/import/).
- [`docs/PHOTO-UNDERLAY.md`](docs/PHOTO-UNDERLAY.md): tracing a photo or scan placed under the map by its grids.
- [`docs/OVERLAYS.md`](docs/OVERLAYS.md): printing a COA at map scale (1:25 000 to 1:100 000) to lay over the paper map.
- [`docs/WORKSHEETS.md`](docs/WORKSHEETS.md): printable unit, line and change worksheets, and typing them back in.
- [`docs/CHANGE-SHEETS.md`](docs/CHANGE-SHEETS.md): version fingerprints, change sheets, and updating a COA from a file with a preview.
- [`docs/ANALOG-DIGITAL-WORKFLOW.md`](docs/ANALOG-DIGITAL-WORKFLOW.md): how planning moves between paper and the app with the least re-entry and no loss of data (worksheets, transfer points, read-back).
- [`docs/EPIC-COA-BUILDER.md`](docs/EPIC-COA-BUILDER.md): the plan, stories, decisions and risks.
- [`vendor/README.md`](vendor/README.md): vendored library versions and licenses.
