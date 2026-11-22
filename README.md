# COA Builder

Build Courses of Action (COAs): named collections of military unit symbols (SIDC, MIL-STD-2525 / APP-6)
placed on a map. Plain HTML, CSS and JavaScript with no build step and no dependencies. Leaflet and
milsymbol are vendored in `vendor/`.

> **Status:** the application core and storage are complete and tested. The browser views are being
> built, so for now the page shows the shell and an empty map (use the console, below, to create COAs).

## Where your COAs are saved

The header shows which is in use:

| Started with | COAs are saved |
|---|---|
| `serve.ps1` / `serve.cmd` | as GeoJSON files, one per COA, in `data/` next to the app (or `-DataDir <folder>`). They open in QGIS or ArcGIS. |
| any other server (e.g. Python) | in this browser's storage only: not shared between browsers or machines. |
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
| Python 3 | `python3 -m http.server 8080` | http://localhost:8080/ |

`serve.ps1` options: `-Port 8081` uses another port, and `-Root <folder>` serves another folder. It listens on
`localhost` only, never serves dot-files (such as `.git`) or anything outside its folder, and stops with
Ctrl+C.

**Trying it before the views exist:** open the browser console (F12) and drive the app directly:

```js
const c = coaBuilder.client
const { value: coa } = await c.send('coa.create', { name: 'COA 1' })
await c.send('symbol.add', { coaId: coa.id, sidc: '10031000001211000000', position: { lat: 34, lng: -117 }, label: 'A/1-5' })
await c.ask('coa.get', { coaId: coa.id })
```

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
