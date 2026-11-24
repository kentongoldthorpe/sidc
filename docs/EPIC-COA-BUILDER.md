# EPIC: COA Builder — Course of Action editor for military symbols (SIDC)

| Field | Value |
|---|---|
| Epic ID | COA-1 |
| Status | In progress: Milestones 0–3, 5, 5b and 6a done (full GUI, file/browser storage, PNG slide export), plus the documented import format and JSON/GeoJSON/CSV export and import (COA-1.23, 1.24, 1.28); Milestones 0–8 done (incl. 7a consolidation and the UI style pass); Milestone 9 (Hardening) **done**, released as 0.2.0; next: **Epic 3, Threat models** in progress (T-1 to T-5 done); **Milestone 10, data model v2** in progress (M10-1 storage port, M10-2 projects, M10-3 rich units and unit templates, M10-4 linked SITTEMPs and one drawing renderer done; Milestone 10 complete; T-7 template slide done: Epic 3 complete), which absorbs T-6 |
| Architecture | Ports & Adapters (Hexagonal), message envelopes, in-process message bus |
| Delivery method | Test-Driven Development (red → green → refactor), testing messages at the boundaries only |
| Reference | `docs/ARCHITECTURE.md`: UML diagrams and the message catalogue for every boundary |
| Stack | HTML, CSS, vanilla JavaScript (ES modules). No frameworks, no build step, no npm dependencies |
| Test runner | Node.js built-in `node:test` + `node:assert/strict` (Node ≥ 20) |
| Vendored libraries | Leaflet (map), milsymbol by Spatial Illusions (SIDC → SVG), both copied into `vendor/` |

---

## 1. Problem & goal

Planners need to sketch **Courses of Action (COAs)**. A COA is a named collection of military symbols, each identified by a **SIDC** (Symbol Identification Code, MIL-STD-2525 / APP-6) and placed on a map.

**Goal:** a browser app where the user can, using only the GUI:

1. **CRUD COAs**: create, list, view, rename/edit, duplicate, and delete.
2. **CRUD symbols within a COA**: add, list, view, edit (SIDC, label, modifiers), move (drag on the map), and delete.
3. See every symbol of the active COA rendered correctly on a map.
4. Keep work across reloads, and move COAs between machines as JSON files.

### Non-goals (this epic)
- Multi-user / server sync, authentication.
- Full 2525 tactical-graphic symbology. Simple lines, areas and range rings arrived in Milestone 8 (decisions D15–D18).
- Symbol-browser "wizard" covering the full 2525 catalogue (a SIDC text field with live preview is in scope; a picker is a follow-on epic).
- Offline map tiles (see Open Questions).

---

## 2. Architectural principles

1. **Dependency rule:** source dependencies point inward only.
   `adapters → application → domain`. The domain and application layers never import an adapter, never touch `window`, `document`, `localStorage`, `L` (Leaflet), or `ms` (milsymbol).
2. **Ports are plain JS contracts.** Each port is documented with JSDoc `@typedef` / `@interface` and enforced by a **shared contract test suite** that every adapter for that port must pass.
3. **All interaction crosses the hexagon boundary as an envelope.** Commands, queries, events, and replies share one envelope shape (§4).
4. **The domain is pure.** Aggregate functions take state plus input and return new state plus events. Time and IDs are injected. No hidden I/O.
5. **Immutability:** domain objects are deep-frozen. Updates produce new objects.
6. **Errors are values.** Use cases return a `Result` (`{ ok: true, value }` or `{ ok: false, error }`). Only programmer errors throw.
7. **One composition root** (`src/main.js`) is the only place that knows about concrete adapters.
8. **No build step.** The browser loads `src/**` as native ES modules. Node runs the same files for tests (`"type": "module"` in `package.json`, used only for scripts, with **zero dependencies**).

---

## 3. Architecture overview

```
              DRIVING (primary) ADAPTERS                      DRIVEN (secondary) ADAPTERS
        ┌──────────────────────────────┐                ┌────────────────────────────────┐
        │ DomCoaListView   (DOM)       │                │ LocalStorageCoaRepository      │
        │ DomSymbolEditor  (DOM)       │                │ InMemoryCoaRepository (tests)  │
        │ LeafletMapView   (drag/click)│                │ MilsymbolRenderer              │
        │ FileImportControl (File API) │                │ BrowserFileGateway (download)  │
        └──────────────┬───────────────┘                │ CryptoIdGenerator / SeqIdGen   │
                       │ envelopes                      │ SystemClock / FixedClock       │
                       ▼                                └───────────────▲────────────────┘
        ┌────────────────────────────────────────────────────────────── │ ───────────────┐
        │  APPLICATION                                                  │ driven ports   │
        │   MessageBus (dispatch/query/publish, middleware)             │                │
        │   Command handlers  ── use ──►  CoaRepository, IdGenerator, Clock,             │
        │   Query handlers                SymbolRenderer, FileGateway, EventPublisher    │
        │  ┌─────────────────────────────────────────────────────────────────────────┐   │
        │  │  DOMAIN: Coa aggregate, MapSymbol entity, Sidc / LatLng / Label VOs,    │   │
        │  │          domain events, invariants, DomainError codes                   │   │
        │  └─────────────────────────────────────────────────────────────────────────┘   │
        └────────────────────────────────────────────────────────────────────────────────┘
                       │ events (envelopes)
                       ▼
        Views subscribe to events → re-render (DOM list, map layer, editor)
```

**Flow example: drag a symbol on the map.**
`LeafletMapView` fires `dragend` → builds a `symbol.move` command envelope → `bus.dispatch()` → `MoveSymbolHandler` loads the COA through `CoaRepository`, calls `Coa.moveSymbol()` (pure), saves with an optimistic revision check, publishes `symbol.moved` → `LeafletMapView` and `DomSymbolEditor` update. The map view never mutates state itself.

### 3.1 Folder structure

```
sidc/
├── index.html                  # shell; loads vendor scripts (classic) + src/main.js (module)
├── css/
│   ├── tokens.css              # colors, spacing, light/dark
│   └── app.css
├── src/
│   ├── shared/
│   │   ├── envelope.js         # createEnvelope, isEnvelope, deriveEnvelope
│   │   ├── result.js           # ok(), err(), isOk()
│   │   ├── errors.js           # ErrorCode enum, appError()
│   │   └── freeze.js           # deepFreeze
│   ├── domain/
│   │   ├── sidc.js             # Sidc value object (structural validation)
│   │   ├── lat-lng.js
│   │   ├── label.js
│   │   ├── map-symbol.js       # entity
│   │   ├── coa.js              # aggregate root (pure functions)
│   │   └── events.js           # domain event type constants + factories
│   ├── application/
│   │   ├── ports/              # JSDoc contracts only
│   │   │   ├── coa-repository.js
│   │   │   ├── symbol-renderer.js
│   │   │   ├── file-gateway.js
│   │   │   ├── id-generator.js
│   │   │   └── clock.js
│   │   ├── bus/
│   │   │   ├── message-bus.js
│   │   │   └── middleware.js   # envelope validation, logging, error capture
│   │   ├── messages.js         # message type catalogue + payload schemas
│   │   ├── commands/           # one handler per file
│   │   └── queries/
│   ├── adapters/
│   │   ├── persistence/
│   │   │   ├── in-memory-coa-repository.js
│   │   │   ├── local-storage-coa-repository.js
│   │   │   └── migrations.js
│   │   ├── rendering/milsymbol-renderer.js
│   │   ├── files/browser-file-gateway.js
│   │   ├── system/crypto-id-generator.js
│   │   ├── system/system-clock.js
│   │   └── ui/
│   │       ├── dom-coa-list-view.js
│   │       ├── dom-symbol-editor.js
│   │       ├── leaflet-map-view.js
│   │       └── dom-helpers.js
│   └── main.js                 # composition root
├── tests/
│   ├── support/                # FixedClock, SequenceIdGenerator, FakeStorage, builders
│   ├── contracts/              # reusable port contract suites
│   ├── shared/ domain/ application/ adapters/   # mirrors src/
│   └── architecture.test.js    # enforces the dependency rule
├── vendor/
│   ├── package.json            # {"type":"commonjs"} so Node can require() the UMD bundles
│   ├── README.md               # library names, versions, source URLs, licenses
│   ├── leaflet/  (leaflet.js, leaflet.css, images/, LICENSE)
│   └── milsymbol/ (milsymbol.js, LICENSE)
├── docs/
│   └── EPIC-COA-BUILDER.md     # this file
└── package.json                # {"type":"module","scripts":{"test":"node --test","serve":"python3 -m http.server 8080"}}
```

> **Note:** ES modules do not load from `file://` in most browsers, so the app must be served (`python3 -m http.server`). This is still pure static hosting: GitHub Pages, any web server, or a USB stick plus Python all work.

---

## 4. Message envelopes

Every message crossing the application boundary uses one shape:

```js
/**
 * @typedef {'command'|'query'|'event'|'reply'} MessageKind
 * @typedef {Object} Envelope
 * @property {MessageKind} kind
 * @property {string} type           // dotted, e.g. "coa.create", "symbol.moved"
 * @property {number} v              // payload schema version for this type
 * @property {string} id             // unique message id
 * @property {string} correlationId  // id of the originating user action (same across the whole chain)
 * @property {string|null} causationId // id of the message that directly caused this one
 * @property {string} at             // ISO-8601 UTC timestamp
 * @property {Object} payload        // type-specific, frozen
 * @property {{source:string, actor?:string}} meta
 */
```

**Example: command and resulting event**

```json
{ "kind":"command", "type":"symbol.add", "v":1,
  "id":"m-01", "correlationId":"m-01", "causationId":null,
  "at":"2026-11-22T20:40:00.000Z",
  "payload":{ "coaId":"c-7", "sidc":"10031000001211000000",
              "position":{"lat":34.05,"lng":-117.6}, "label":"A/1-5" },
  "meta":{ "source":"ui.symbol-editor" } }

{ "kind":"event", "type":"symbol.added", "v":1,
  "id":"m-02", "correlationId":"m-01", "causationId":"m-01",
  "at":"2026-11-22T20:40:00.004Z",
  "payload":{ "coaId":"c-7", "revision":4,
              "symbol":{ "id":"s-3", "sidc":"10031000001211000000",
                         "position":{"lat":34.05,"lng":-117.6}, "label":"A/1-5", "modifiers":{} } },
  "meta":{ "source":"app" } }
```

**Reply envelope** (returned from `dispatch` / `query`): `kind:"reply"`, `type:"<request type>.reply"`, `causationId` = request id, `payload` = `Result`:

```js
{ ok: true,  value: {...} }
{ ok: false, error: { code: "VALIDATION_FAILED", message: "Name is required", details: { field: "name" } } }
```

**Naming conventions**
- Commands are imperative: `coa.create`, `coa.rename`, `coa.update`, `coa.duplicate`, `coa.delete`, `symbol.add`, `symbol.update`, `symbol.move`, `symbol.remove`, `coa.import`, `coa.export`.
- Events are past tense: `coa.created`, `coa.updated`, `coa.duplicated`, `coa.deleted`, `symbol.added`, `symbol.updated`, `symbol.moved`, `symbol.removed`, `coa.imported`.
- Queries are nouns: `coa.list`, `coa.get`, `symbol.preview` (SIDC → SVG plus validity).

**Persistence and file envelopes** reuse the idea with a document header so formats can evolve:

```json
{ "format":"coa-builder/coa", "schemaVersion":1, "savedAt":"2026-11-22T20:40:00Z",
  "data":{ "id":"c-7", "name":"COA 1 – Envelopment", "revision":4, "symbols":[ ... ] } }
```

Export bundles use `"format":"coa-builder/bundle"` with `data.coas: [...]`. Readers run `migrations.js` (`v1 → v2 → …`) before handing data to the domain. Unknown or newer versions are rejected with `UNSUPPORTED_VERSION`.

### 4.1 Error codes (`src/shared/errors.js`)
`VALIDATION_FAILED`, `INVALID_SIDC`, `NOT_FOUND`, `CONFLICT` (stale revision), `UNKNOWN_MESSAGE_TYPE`, `INVALID_ENVELOPE`, `STORAGE_UNAVAILABLE`, `STORAGE_QUOTA_EXCEEDED`, `IMPORT_INVALID`, `UNSUPPORTED_VERSION`, `UNEXPECTED` (caught throw, wrapped by middleware).

---

## 5. Domain model

| Concept | Type | Rules / invariants |
|---|---|---|
| `Coa` | Aggregate root | `id`, `name` (trimmed, 1–120 chars), `description` (≤ 2000), `createdAt`, `updatedAt`, `revision` (int, +1 per change), `symbols` (ordered array of `MapSymbol`). Symbol ids are unique within a COA. |
| `MapSymbol` | Entity (within Coa) | `id`, `sidc: Sidc`, `position: LatLng`, `label` (unique designation, ≤ 30), `modifiers` (allow-listed keys only: `higherFormation`, `additionalInformation`, `staffComments`, `dtg`, `quantity`, `direction` 0–359). Named `MapSymbol` to avoid clashing with JS `Symbol`. |
| `Sidc` | Value object | Structural validation only: **20 or 30 digits** (2525D/E, APP-6D/E numeric) or **15 characters** in the 2525C letter form (`[A-Z0-9*-]{15}`). Normalized (trim, uppercase). *Semantic* validity (does this symbol exist?) belongs to the `SymbolRenderer` port, so the domain doesn't depend on milsymbol. |
| `LatLng` | Value object | `lat` ∈ [-90, 90], `lng` normalized into [-180, 180). Finite numbers only. |

The aggregate API is pure functions. Each returns `Result<{ coa, events }>`:

```js
createCoa({ id, name, description }, { now })
renameCoa(coa, { name }, { now })
updateCoa(coa, { name?, description? }, { now })
duplicateCoa(coa, { newId, name, symbolIds }, { now })   // symbolIds: fresh ids, injected
addSymbol(coa, { symbolId, sidc, position, label, modifiers }, { now })
updateSymbol(coa, { symbolId, sidc?, label?, modifiers? }, { now })
moveSymbol(coa, { symbolId, position }, { now })
removeSymbol(coa, { symbolId }, { now })
```

Deleting a COA is an application-level concern (repository `remove`) and emits `coa.deleted`.

---

## 6. Ports catalogue

### Driving (inbound) port: the bus
```js
bus.dispatch(commandEnvelope) -> Promise<ReplyEnvelope>
bus.query(queryEnvelope)      -> Promise<ReplyEnvelope>
bus.subscribe(eventTypeOrPattern, handler) -> unsubscribe   // "symbol.*", "*"
bus.use(middleware)
```

### Driven (outbound) ports
| Port | Methods | Adapters |
|---|---|---|
| `DocumentRepository` (D31; replaced `CoaRepository` and `SettingsRepository`) | `list(collection)`, `get(collection, id)`, `save(collection, doc, { expectedRevision })`, `remove(collection, id, { expectedRevision })` → `Result` | `InMemoryDocumentRepository`, `LocalStorageDocumentRepository`, `HttpFileDocumentRepository` (`serve.ps1`) |
| `SymbolRenderer` | `render(sidc, { label, modifiers, size }) → { svg, anchor:{x,y}, width, height, valid, warnings[] }` | `MilsymbolRenderer(ms)` (library injected through the constructor); `StubRenderer` (tests) |
| `FileGateway` | `exportJson(filename, object) → Result<void>`, `readJson(file) → Promise<Result<object>>` | `BrowserFileGateway` (Blob + `<a download>`, `FileReader`/`file.text()`); `FakeFileGateway` |
| `IdGenerator` | `next(prefix) → string` | `CryptoIdGenerator` (`crypto.randomUUID`, with a fallback on non-secure contexts); `SequenceIdGenerator` (tests) |
| `Clock` | `now() → ISO string` | `SystemClock`, `FixedClock` |
| `EventPublisher` | `publish(eventEnvelope)` | provided by the bus itself |

The UI views are also adapters. `MapView` and `ListView` are small driven interfaces too (`renderCoa(coaDto)`, `highlight(symbolId)`), so presentation logic can be tested with a recording fake.

---

## 7. Testing strategy (TDD, boundary-only)

**Test the messages at the boundaries, not the code behind them.** A test sends a message
across a boundary and asserts on the messages that come back. Internal functions (domain
aggregates, value objects, helpers) are never imported by tests. They are covered by the
behaviour they produce at the boundary, so they can be refactored freely. A test that reaches
inside needs a specific, written-down reason.

**Workflow for every story:** red → green → refactor. Write the failing boundary test first and
watch it fail. Write the least code that passes it. Refactor while the tests stay green. Commit at green.

| Boundary | Test style | Doubles | Runs in |
|---|---|---|---|
| **Application API** (driving port): `createApplication()` | Send command and query envelopes through `tests/support/app-harness.js`. Assert on reply envelopes, published events, and later query results. Never peek into a repository. | In-memory driven adapters, `FixedClock`, `SequenceIdGenerator`, `StubRenderer`, recording `FileGateway` | Node |
| **Message bus** mechanics | Envelopes in and out, with throwaway handlers | same | Node |
| **Envelope format** (`shared/envelope.js`, used by every adapter) | Build, validate and JSON round-trip envelopes | none | Node |
| **Driven ports**: one contract suite each in `tests/contracts/` | Call port methods and assert on the returned Results. **Every** adapter runs the same suite, test doubles included. | `FakeStorage` (Web Storage API) for the localStorage adapter | Node |
| `MilsymbolRenderer` | `SymbolRenderer` contract against the real vendored `milsymbol.js` (`asSVG()` needs no DOM) | none | Node |
| **UI adapters** (driving) | DOM events in → envelopes dispatched to a recording fake app; events published → DOM out. Leaflet behaviour is covered by the manual smoke checklist in the DoD. | fake app | Browser, or Node with a fake DOM where needed |
| **Fitness** (specific reason: they guard structure, not behaviour) | `architecture.test.js` (dependency rule), `skeleton.test.js` (layout, vendored libraries), `docs.test.js` (the catalogue in `docs/ARCHITECTURE.md` matches the registered messages) | — | Node |

Conventions:
- Files are named `*.test.js`. Run them with `npm test` (`node --test`) or watch with `node --test --watch`. Use only `node:test` and `node:assert/strict`.
- Coverage: `node --test --experimental-test-coverage`. Aim for 100 % of lines in `src/shared`, `src/domain` and `src/application` **reached through boundary tests**. An uncovered line is either a missing boundary scenario or dead code, which gets deleted.
- Tests must be deterministic: no real time, randomness or network.
- `docs/ARCHITECTURE.md` is the reference for every message at every boundary. Update it in the same commit as the code.

## 8. Definition of Done (each story)

- [ ] Acceptance criteria are covered by tests that were written first and seen failing.
- [ ] `node --test` is green, and `architecture.test.js` is green.
- [ ] No new runtime or dev dependencies (vendored libraries only, with versions in `vendor/README.md`).
- [ ] Public functions and ports have JSDoc types.
- [ ] Any new message type is added to `messages.js` with its payload validator and a `v` number.
- [ ] UI stories: manual smoke checklist passed in current Chrome and Firefox. Usable by keyboard. No console errors. Works at 375 px width.
- [ ] Code reviewed and merged to the main branch.

---

## 9. Stories

Estimates use story points (1, 2, 3, 5, 8). The milestones are ordered so that each one leaves a working, tested system.

### Milestone 0: Foundation

**COA-1.1 Repo skeleton and test harness (2) ✅**
As a developer, I want the folder layout, `package.json` (no dependencies), a vendored libraries README, and a passing sample test, so TDD can start immediately.
- AC: `node --test` runs and passes one placeholder test. `python3 -m http.server` serves `index.html`, which shows "COA Builder" and an empty map container.
- AC: Leaflet and milsymbol are in `vendor/` with LICENSE files and pinned versions recorded. `vendor/package.json` sets `"type":"commonjs"`.

**COA-1.2 Architecture fitness test (2) ✅**
- AC: `architecture.test.js` fails if any file in `src/domain` or `src/application` imports from `src/adapters` or `vendor`, or references browser globals. Proven with a fixture file that violates the rule.

**COA-1.3 Result and error codes (1) ✅**
- AC: `ok(v)`, `err(code, message, details)`, and `isOk(r)` exist. Error objects are frozen. Codes come from a frozen enum, and unknown codes throw (programmer error).

**COA-1.4 Envelope module (3) ✅**
- AC: `createEnvelope({kind,type,v,payload,meta}, {id, now})` returns a deep-frozen envelope with `correlationId = id` and `causationId = null`.
- AC: `deriveEnvelope(parent, {...})` copies `correlationId` and sets `causationId = parent.id`.
- AC: `validateEnvelope(x)` returns `INVALID_ENVELOPE` with details for a missing or invalid kind, type, v, id, at, or payload.
- AC: An envelope survives a `JSON.stringify` → `JSON.parse` round-trip and is still valid.

**COA-1.5 In-process message bus (5) ✅**
- AC: `dispatch` routes a command to exactly one registered handler. Registering a second handler for the same type throws.
- AC: Dispatching an unknown type returns a reply with `UNKNOWN_MESSAGE_TYPE`.
- AC: A handler that throws is turned into a `UNEXPECTED` error reply. The bus never rejects.
- AC: Events the handler publishes reach subscribers after the handler's save succeeds, in order, with derived correlation and causation ids. Wildcard subscriptions (`symbol.*`, `*`) work. A failing subscriber does not break the others or the reply.
- AC: Middleware runs in registration order around handlers. Envelope validation middleware is installed by default.

### Milestone 1: Vertical slices through the Application API

Because of the boundary-only testing rule (§7), the domain and its handlers are built one
message at a time. Each slice adds the domain rules, the handler, any driven port it needs (with
its contract suite and in-memory adapter), and a row in `docs/ARCHITECTURE.md` §6. All of it is
tested by sending envelopes. (This replaces the original layer-by-layer stories 1.6–1.14 and
Milestone 2. The SIDC, LatLng and label rules from those stories now appear as `VALIDATION_FAILED`
or `INVALID_SIDC` replies in the slices below.)

**COA-1.6 Slice: `coa.create`, `coa.get`, `coa.list` (5) ✅**
- AC: `coa.create {name, description?}` replies `ok(Coa)` (revision 1, trimmed text, `createdAt = updatedAt = clock.now()`, no symbols) and publishes `coa.created {coa}`.
- AC: A missing, non-string, blank or over-120-character name, a description over 2000 characters, or unknown fields gives `VALIDATION_FAILED { problems: [{field, reason}] }`. All problems are reported at once, and nothing is stored or published.
- AC: Payload `v` ≠ 1 gives `UNSUPPORTED_VERSION {type, v, supported}`. Repository failures pass through unchanged.
- AC: `coa.get {coaId}` gives `ok(Coa)` or `NOT_FOUND {coaId}`. `coa.list {}` gives summaries, most recently updated first.
- AC: The `CoaRepository` port contract suite passes for `InMemoryCoaRepository`.

**COA-1.7 Slice: `coa.update` (3) ✅**
- AC: `coa.update {coaId, expectedRevision, name?, description?}` replies `ok(Coa)` with revision + 1 and the new `updatedAt`, and publishes `coa.updated {coa, changed}`.
- AC: Validation as for create. A stale `expectedRevision` gives `CONFLICT`, an unknown id gives `NOT_FOUND`, and neither publishes anything. A no-op update (no changes) is `ok` with no event.

**COA-1.8 Slice: `coa.duplicate`, `coa.delete` (3) ✅**
- AC: Duplicating gives a new id, a default name of `"<name> (copy)"`, revision 1 and new symbol ids, and publishes `coa.duplicated`. `coa.get` of the source is unchanged.
- AC: Deleting with the right revision publishes `coa.deleted`, after which `coa.get` is `NOT_FOUND`. A stale revision gives `CONFLICT`.

**COA-1.9 Slice: `symbol.add` (5) ✅**
- AC: Replies `{coaId, revision, symbol}`, publishes `symbol.added`, and `coa.get` shows the symbol.
- AC (table-driven, all through replies): SIDCs with 20 or 30 digits or the 15-character letter form are accepted and normalised (trimmed, upper-case). Other lengths, characters or blanks give `VALIDATION_FAILED` on `sidc`, reported together with any other problems. (`INVALID_SIDC` is kept for well-formed SIDCs the renderer rejects; see COA-1.11.) Lat outside ±90, NaN or non-numbers give `VALIDATION_FAILED (position.lat)`. Lng is normalised (190 → −170). A label over 30 characters or modifiers outside the allow-list give `VALIDATION_FAILED`.
- AC: Stale revision gives `CONFLICT`. Unknown COA gives `NOT_FOUND`.

**COA-1.10 Slice: `symbol.update`, `symbol.move`, `symbol.remove` (5) ✅**
- AC: Each replies with the new revision and publishes its event (`symbol.moved` includes `from` and `to`). Order of the other symbols is preserved.
- AC: Unknown `symbolId` gives `NOT_FOUND {coaId, symbolId}`. Stale revision gives `CONFLICT`. Validation is as in 1.9.
- AC: A stale revision is checked before the symbol is looked up, so a stale client gets `CONFLICT`, not `NOT_FOUND`. Updates and moves that change nothing after normalising reply with the current state, with no write and no event. `symbol.update` replaces modifiers as a whole, and its event lists `changed`.

**COA-1.11 Slice: `symbol.preview` + `SymbolRenderer` port (3) ✅**
(Takes over the original 1.18.)
- AC: `symbol.preview {sidc, label?, modifiers?, size?}` replies `{svg, valid, warnings, anchor, width, height}` for any SIDC string, including invalid ones.
- AC: `symbol.add` and `symbol.update` use the renderer for semantic validity. A well-formed SIDC that milsymbol rejects gives `INVALID_SIDC {sidc, warnings}`.
- AC: The `SymbolRenderer` contract passes for `StubRenderer` and for `MilsymbolRenderer` (real vendored milsymbol in Node: friendly infantry, hostile armor, invalid SIDC).

### Milestone 2: Run it in a browser (GUI first, decision D5)

**COA-2.1 App shell, composition root and browser test runner (5) ✅**
- AC: `main.js` wires `createApplication()` with the system adapters, `MilsymbolRenderer(ms)` and the in-memory repository until Milestone 3 lands.
- AC: `SystemClock` and `CryptoIdGenerator` pass the Clock and IdGenerator contract suites. `CryptoIdGenerator` falls back to `crypto.getRandomValues` when `randomUUID` is unavailable (non-secure context).
- AC: The layout has a COA sidebar, the map in the centre and a symbol editor drawer. It works at 375 px wide and in light and dark mode.
- AC: `tests/browser/index.html` is an in-browser test runner with no dependencies. It tests UI adapters at their boundary: DOM events in → envelopes out to a recording fake app; published events in → DOM out. It runs in any browser and headless here.

**COA-2.2 App client: the UI's single way into the app (3) ✅**
- AC: `client.send(type, payload)` and `client.ask(type, payload)` build envelopes (`meta.source` = the view) and resolve with the reply's Result.
- AC: It remembers the latest revision of each COA from replies and events, and fills in `expectedRevision` when asked.
- AC: Commands for the same COA run one at a time (a per-COA queue), so a drag followed quickly by an edit doesn't cause a spurious `CONFLICT`.
- AC: Tested in Node at its boundary: its API in, envelopes out to a fake app.

**COA-2.3 `serve.ps1`: a PowerShell static server (3) ✅**
- AC: `pwsh ./serve.ps1` (or Windows PowerShell 5.1) serves the app on `http://localhost:8080/` using `System.Net.HttpListener`. It listens on localhost only.
- AC: It sends correct MIME types (`.js` → `text/javascript`, which module scripts require; `.css`, `.svg`, `.png`, `.json`, `.geojson`). Path traversal outside the app folder is refused with 403.
- AC: `npm run serve` (Python) stays as an alternative.
- Done: `tests/serve/serve-ps1.test.js` starts the real script (PowerShell 7.4 here) and checks MIME types, folder index, HEAD, 405, no-store and nosniff headers, traversal (including encoded and Windows drive paths) and dot-files. It skips cleanly without PowerShell. `serve.cmd` provides double-click start on Windows. **Not yet verified on Windows PowerShell 5.1.**

### Milestone 3: Persistence: GeoJSON files via the PowerShell server, browser storage as fallback (decision D6)

**COA-3.1 GeoJSON COA document format (3) ✅**
- AC: One COA is one GeoJSON `FeatureCollection` (RFC 7946). Each symbol is a `Point` feature: `geometry.coordinates = [lng, lat]`, and `properties = { id, sidc, label, modifiers }`. COA metadata (`id, name, description, revision, createdAt, updatedAt`) and `schemaVersion` live in a top-level `"coa"` foreign member. Feature order is symbol order.
- AC: COA → GeoJSON → COA is lossless. Malformed documents give `IMPORT_INVALID` with problems, and are never partially applied.
- Why GeoJSON: it opens in QGIS and ArcGIS, and lines (a later epic) map directly to `LineString`.

**COA-3.2 `serve.ps1` file API (5) ✅**
- AC: `GET /api/health` → `{ storage: "files", dataDir }`. `GET /api/coas` → `{ ids }` (changed from summaries: PowerShell 7's `ConvertFrom-Json` rewrites dates and accepts non-standard JSON, so the server never parses documents for the list; the client reads and validates each one). `GET`, `PUT` and `DELETE` on `/api/coas/{id}` read, write and remove `data/coas/{id}.geojson`.
- AC: Optimistic concurrency: `PUT` and `DELETE` send `If-Match: <revision>`, and a mismatch gives 409 with `{ expectedRevision, actualRevision }`. `If-None-Match: *` on create gives 409 if the file exists.
- AC: Ids are restricted to `[A-Za-z0-9_-]{1,128}`, writes go to a temp file then rename, and the server listens on localhost only.

**COA-3.3 `HttpFileCoaRepository` adapter (5) ✅**
- AC: Uses injected `fetch`, and maps HTTP status to Results (404 → `NOT_FOUND`, 409 → `CONFLICT`, network down → `STORAGE_UNAVAILABLE`).
- AC: Passes the `CoaRepository` contract suite against a Node fake of the file API. It also runs against the real `serve.ps1` when PowerShell is available.

**COA-3.4 Pick storage at startup (2) ✅**
- AC: If `/api/health` answers, COAs are saved as GeoJSON files. Otherwise the app falls back to browser storage (COA-1.15). The UI shows which is in use.

**COA-1.15 `LocalStorageCoaRepository`: fallback (5) ✅**
- AC: Passes the CoaRepository contract suite using an injected `FakeStorage`.
- AC: Data is stored in the COA-3.1 GeoJSON format, one key per COA (`coa-builder:coa:<id>`). COAs are found by key prefix, so there's no separate index to fall out of step.
- AC: `QuotaExceededError` becomes `STORAGE_QUOTA_EXCEEDED`. Missing or blocked storage becomes `STORAGE_UNAVAILABLE`. One corrupt COA does not hide the others.

**COA-1.16 Schema migrations ✅ (2)**
- Done (consolidation): storage schema v2 (adds line, area and range-ring features); `migrate` in `geojson-coa.js` upgrades v1 → v2 on every read, and a newer version gives `UNSUPPORTED_VERSION { found, supported: [1, 2] }`.
- AC: `migrate(doc)` upgrades step by step to the current `schemaVersion`. A newer version than supported gives `UNSUPPORTED_VERSION`, and the data is left unchanged. Used by all storage and import paths.

**COA-1.17 Cross-tab / external change awareness (3, stretch)**
- AC: A `storage` event, or a file changed on disk (polled through the server), becomes `coa.externally-changed`, and the UI offers a reload.

### Milestone 4: Symbol rendering
Moved into COA-1.11.

### Milestone 5: GUI views (driving adapters)

All views talk to the app only through the app client (COA-2.2). They are tested at the DOM boundary in the browser runner (COA-2.1). Only renderer SVG is inserted as markup; all user text uses `textContent`. (Checked: milsymbol escapes label and modifier text.)

**COA-1.20 COA list view: CRUD (5) ✅**
- AC: Lists COAs with name, symbol count and last updated time. Users can create (inline form), rename, duplicate and delete (with a confirm dialog naming the COA). Selecting a COA makes it active.
- AC: The view re-renders only from events and query replies. Error replies show next to the relevant field.
- Done: rename works with Enter/Escape **and** Save/Cancel buttons (touch screens). The most recently changed COA is selected on start-up, and the selection clears if that COA is deleted anywhere. Names are always shown as text.

**COA-1.21 Symbol list and editor: CRUD (8) ✅**
- AC: The active COA's symbols are listed with a thumbnail, label and SIDC.
- AC: The SIDC can be entered **either** by picking a preset (a short list of common units: friendly or hostile infantry, armour, mechanised infantry, artillery, recon, HQ, and so on) **or** by typing it. A live preview (`symbol.preview`, debounced) shows validity and warnings (decision D2).
- AC: The form covers label, modifiers and lat/lng, and deleting asks for confirmation. Selecting in the list highlights on the map, and the reverse.
- Done: the presets are a builder (affiliation × 12 unit types × echelon × HQ → a 2525D SIDC; each checked in milsymbol), and a typed SIDC is read back into the builder or shown as "custom". "Pick on map" fills the position from the next map click; on phones the panel steps aside while picking. Edits move first, then update, so an invalid position saves nothing. The map fits to a COA's first units and pans to a selected unit that's out of view.

**COA-1.22 Leaflet map view (5) ✅**
- AC: Base layers: an offline lat/lng grid (default) and an optional OpenStreetMap layer, switched with Leaflet's layer control (decision D3).
- AC: Symbols are drawn as `L.divIcon` from renderer SVG, anchored at the renderer's anchor. Dragging sends `symbol.move`, and on `CONFLICT` the marker snaps back and a message is shown. "Place symbol" mode means a map click pre-fills the editor's lat/lng.
- AC: The map fits to the COA's symbols when a COA is selected, and switching COAs clears the old layer.
- Done: the grid draws lines on canvas tiles and labels each line once along the left and bottom edges; OSM is only fetched when chosen. Markers are milsymbol SVG via `symbol.preview` (cached), pinned at the renderer's anchor; drag → `symbol.move`, refused moves snap back with a message. "Place symbol" (click the map to fill the editor's position) moved to COA-1.21, where the editor exists.

**COA-1.21b Copy units and delete groups of units (5) ✅** *(requested during manual testing)*
- AC: New commands `symbol.copy` (one or many units, within a COA or into another; fresh ids; optional offset; all or nothing in one revision) and `symbol.remove-many` (all or nothing in one revision). Both publish the existing per-unit events, so the views need no new subscriptions.
- AC: Units have tick boxes. Ticking any shows a bar with the count, "Copy to" (this COA or any other), Copy, Delete (with confirmation naming the count) and Clear. Copies within the same COA are nudged slightly south-east, keeping a group's formation.
- AC: The edit form has **Copy unit**, which copies the unit and opens the copy, ready to move.

**COA-1.21c Fixes and options from manual testing (3) ✅**
- `serve.py` (standard library) sends `no-store` like `serve.ps1`. `python3 -m http.server` let the browser mix cached old modules with new ones after `git pull` ("No command handler for symbol.copy").
- Views batch reloads for a burst of events (one redraw instead of one per copied unit; this was the stutter).
- An open unit form follows changes made elsewhere (map drag, other tabs) in every field the user hasn't changed, and Save sends only the changed fields. Before, Save after a drag moved the unit back.
- Map section option: **semi-transparent units (50%)**, with the selected unit kept opaque; remembered per browser.

### Milestone 5b: Layout v2: every tool on one side (decision D9)

**COA-5b.1 One left panel with collapsible sections (5) ✅**
- AC: A single panel on the left holds the sections **COAs**, **Units** and **Map** (and **Export** in Milestone 6a). Each section header is a button with `aria-expanded` that collapses or expands it. The map takes the rest of the width.
- AC: A header button shows or hides the whole panel. On narrow screens the panel slides over the map, and it still steps aside for "Pick on map".
- AC: Which sections are open is remembered in this browser (a per-viewer convenience; losing it is harmless).

**COA-5b.2 COA section levels (3) ✅**
- AC: The COA section has four levels: **collapsed** (header only), **active** (the active COA), **recent** (the active COA plus the 3 most recently used), and **all** (every COA, scrollable). "Show more" and "Show less" step between the expanded levels, and the header toggles collapsed or expanded, remembering the level.
- AC: "Recently used" means most recently *selected* in this browser, filled up with the most recently changed COAs when there's no history yet. The history is remembered in this browser.
- AC: Create, rename, duplicate and delete keep working at every expanded level.

**COA-5b.3 Map section: base layers in the panel (2) ✅**
- AC: The base-map choice (Grid (offline) / OpenStreetMap (online)) moves from Leaflet's floating control into the Map section as radio buttons. OSM is still only fetched when chosen, and the choice is remembered in this browser.

### Milestone 6a: Presentation export: PNG slides (decisions D10–D14)

**COA-6a.1 Export frame on the map (5) ✅**
- AC: Choose an aspect ratio: **16:9, 4:3 or 5:4**. The map shows the frame with the area outside it shaded; what's inside is exactly what gets exported.
- AC: There is **one shared frame** (ratio, centre and zoom), used by every COA, so COA slides line up for comparison. A COA can **override** it with its own frame, and can go back to the shared one.
- AC: The shared frame and the overrides are saved with the data (files or browser storage), not just in the browser's UI settings.
- Done: `Frame = { aspect, center, width }` (width in degrees of longitude, so it's resolution-independent). The shared frame and marking live in a **settings** document (`settings.get` / `settings.update`, a new `SettingsRepository` port: memory, browser storage, `data/settings.json` via `serve.ps1`). A COA's own frame is set with `coa.update { frame }`, not a separate `coa.set-frame`. The Export section has the slide shape, set shared frame or COA frame from the current view, use shared frame, zoom to frame, show/hide the frame, and the marking (text, colour presets, preview).

**COA-6a.2 Slide renderer: PNG (8) ✅**
- AC: Renders a slide at 1920×1080 (16:9), 1600×1200 (4:3) or 1500×1200 (5:4) on a canvas, with no screenshot library.
- AC: The slide contains, at minimum:
  - **classification bars** at top and bottom, always present: default text `UNCLASSIFIED` on green, changeable per export and never blank
  - the **title** (the COA name) and the **DTG** of the export
  - the framed **map**: grid or OpenStreetMap underneath, symbols drawn sharp from their SVG
  - a **legend**: each unit's symbol and label
- AC: The output is a `.png` download named from the COA name and DTG.
- Done: **layout** (`adapters/export/slide-layout.js`) is a pure function producing a **display list** (rects, text, lines, symbol images in slide pixels), tested in Node; the same list can feed SVG or `.pptx` later. **Painting** (`paint-slide.js`) draws it on a canvas, tested by reading pixels. The frame is fitted into the map area ("this area is guaranteed on the slide"); the extra space shows the surroundings. The legend uses the bare symbol (SIDC only). The DTG is UTC (`230215ZNOV26`). The base map is the grid; **OpenStreetMap under slides is a follow-up** (tile downloads can't be tested here).

**COA-6a.3 Export all COAs with the shared frame (2) ✅**
- AC: One action exports a PNG per COA using the shared frame (respecting overrides only if asked), so a comparison brief is consistent.
- Done: COAs in natural name order (COA 2 before COA 10), one DTG for the whole set, separate downloads (the browser may ask once to allow multiple downloads). A single zip download is a possible follow-up.

**COA-6a.4 Full-bleed slides (from manual testing) (3) ✅**
- The map covers the slide edge to edge between the metadata strip (title, DTG) on top and the bottom banner; no white margins.
- The on-screen frame has the shape of the slide's map area (`mapAreaRatio`), so what you frame is exactly what fills the slide.
- The legend is a see-through box over the corner of the map that hides the fewest units (top-right preferred).
- Fix: Export PNG now reads the COA fresh, so units added after selecting it are included.



**COA-1.23 Export ✅ (3)**
- Done: **Export → Data file**: JSON (the import format, complete), GeoJSON (points tagged with their COA) or CSV (one row per unit, columns named like the import fields; RFC 4180, UTF-8 BOM, formula-safe). Download the selected COA or all COAs in one file, named like slides (`coa-1_230215ZNOV26.csv`, `coas_….json`). The format is remembered. No core command is needed: the view reads COAs with `coa.get`.
- Original AC:
- AC: Export one or more COAs as GeoJSON (the COA-3.1 format), or as CSV with one row per symbol: `coa_name, label, sidc, lat, lng, higherFormation, …`. Files are written through `FileGateway`, with the filename slugged from the COA name plus a date.

**COA-1.28 Documented import format ✅ (5)** (numbered 1.28 because 1.25 is undo/redo)
- Done: `coa.import { document }` takes a `coa-builder/import` v1 document, specified for outside producers in `docs/IMPORT-FORMAT.md`, with a JSON Schema (`docs/import/coa-import.schema.json`) and examples (`docs/import/examples/`). Tests import every example, through the stub and the real milsymbol renderer, and check that the schema matches the fields the app accepts.
- Done: all or nothing. Every problem is reported by path (e.g. `coas[0].units[3].sidc`), unknown fields are refused, and limits are 100 COAs and 1000 units per COA. Imports always create new COAs, with one `coa.imported` event each.
- Done: the **Import COAs…** button in the COAs section accepts that format or the app's own GeoJSON files (converted by `readImportFile`). It selects the first imported COA and lists any problems.

**COA-1.24 Import GeoJSON and CSV ✅ (5)**
- Done: **Import COAs…** reads CSV and GeoJSON point files (grouped into COAs by name) as well as the import format and storage files. Problems are shown as `row 3, column sidc` or `features[2].properties.sidc`. Imports are always copies, so "import as copy" needs no prompt.
- Original AC:
- AC: Input goes through format validation and migration, then the domain rules. Nothing is trusted, and nothing is partially written. `IMPORT_INVALID` lists problems by row or feature.
- AC: An id collision offers "import as copy". `coa.imported` is published for each COA.

**COA-6.3 Import COAs from text documents (8, needs samples; decision D4)**
- Update: the extraction may live in **another system** that reads the documents and writes the COA-1.28 import format (`docs/IMPORT-FORMAT.md`). If it does, this story shrinks to optional in-app parsing.
- AC: Paste or open a text document. The new query `coa.parse-text { text }` returns **draft** COAs (name, units with SIDC or a best guess, positions) plus per-line warnings. Nothing is saved yet.
- AC: A review screen lets the user fix drafts, then imports them with `coa.import`.
- AC: Parsing is pure application logic, tested by sending sample documents through `coa.parse-text`.
- Open: which document formats and coordinate formats (decimal lat/lng, DMS, **MGRS**) must be supported. MGRS parsing needs no library, but it's real work.

### Milestone 7: Hardening (superseded by Milestone 9)

The stories below moved into Milestone 9, with fuller acceptance criteria.

**COA-1.25 Undo / redo (5, stretch)**
Inverse commands from published events (`symbol.moved` → `symbol.move` back to `from`). Events are not stored, so undo history lasts only for the session.

**COA-1.26 Accessibility and keyboard pass (3)**
Focus order, ARIA labels, Escape closes dialogs, Delete removes the selected symbol (with confirmation), and visible focus rings.

**COA-1.27 Release checklist (1)**
A README covering running with `serve.ps1` or Python and testing with `npm test` plus the browser runner, vendored library versions and licenses, and the smoke checklist.

### Milestone 7a: Consolidation ✅ (after the architecture review, 2026-11-23)

- Fixed: graphic labels were rendered as HTML on the map (script injection from typed labels or import files). They are now text nodes, with a regression test.
- Active-COA store shared by all views: one `coa.get` per change instead of six. The Lines & areas editor keeps what you type when the graphic changes elsewhere. The map fits to lines, areas and rings as well as units.
- Storage schema v2 with step-by-step migration (COA-1.16).
- `npm run test:browser`: a committed headless runner for the browser specs.
- File formats together in `src/adapters/files/`. Shared `isObject`/`wrapLng`, the map message box and the test drag helper replace their copies. Dead `graphics ?? []` fallbacks removed.

### Milestone 8: Lines, areas and range rings (decisions D15–D18)

The model is one **graphic** entity per COA (`src/domain/graphic.js`):
`{ id, kind, side, label, color?, points | center + radius }`. The kind fixes the shape:

| Shape | Kinds | Geometry |
|---|---|---|
| line | `phaseLine`, `boundary`, `axisOfAdvance`, `route`, `line` | `points` (2–500) |
| area | `objective`, `assemblyArea`, `engagementArea`, `area` | `points` (3–500, closed implicitly) |
| circle | `rangeRing` | `center`, `radius` (metres) |

**COA-8.1 Core, storage and files ✅ (5)**
- Done: `graphic.add`, `graphic.update` (the kind changes only within its shape; `color: null` goes back to the side colour) and `graphic.remove`, with `graphic.added`, `graphic.updated` and `graphic.removed` events. Optimistic concurrency works as for symbols. `coa.duplicate` copies graphics with fresh ids.
- Done: storage GeoJSON writes LineString, Polygon (closed ring) and Point-with-radius features with `properties.kind`; older files read as COAs with no graphics. The repository contract checks that every adapter keeps graphics exactly.
- Done: the import format (still v1, additive) has `coas[].graphics` (max 500), in the schema and docs; the JSON and GeoJSON exports and the Import button carry graphics. CSV stays units only.
- Done: lines stay continuous across the 180° meridian.

**COA-8.2 Draw and edit on the map ✅ (8)**
- Done as specified below: `map-drawer.js` (shared request state, like the picker), `draw-tool.js` (clicks, double-click/Enter, Backspace, Esc, hint with Cancel), `graphics-layer.js` (colours, hostile dashed, labels above lines and hidden while selected, arrowheads, point, midpoint and ring handles, right-click removes a point) and `graphics-view.js` (the panel section). Picking and drawing cancel each other.
- AC: Leaflet draws lines, areas and rings in their colour, with labels. Axis of advance gets an arrowhead. Hostile graphics are dashed.
- AC: A **Lines & areas** panel section lists the active COA's graphics and offers Draw buttons per kind. Clicking adds points; double-click or Enter finishes; Esc cancels; Backspace removes the last point. A range ring takes a centre click, then a radius click, or a typed radius in km.
- AC: Selecting a graphic shows an editor (kind within its shape, label, side, colour override, radius) and draggable point handles. Dragging a handle saves (`graphic.update`). Midpoint handles insert a point. A point can be deleted, keeping the minimum.
- AC: The narrow-screen panel steps aside while drawing, as with Pick on map.

**COA-8.3 Graphics on slides ✅ (3)**
- Done: a new display item `path` (points, closed, colour, width, dash, fill) that the painter strokes and fills. Graphics are drawn over the grid and under the units, with halo labels (lines above their middle, areas at the centroid, rings on the top edge, as on the map) and filled arrowheads. Rings are 96-point geodesic circles.
- AC: `layoutSlide` adds clipped paths for lines, areas and rings under the units, in the same colours, with labels and arrowheads. Rings are drawn as geodesic circles. The legend stays units only.

### Milestone 9: Hardening (epic 2, planned 2026-11-23)

**Goal:** nothing a user does is lost or silently overwritten. The app can be driven by keyboard
and a screen reader. A release can be carried to an offline machine and checked in minutes. No new
planning features.

**Out of scope:** phases and timing, COA comparison, editable PowerPoint (kept for later epics).

**H-1 Undo and redo ✅ (5)** (was COA-1.25)
- Done: `coa.restore` (domain `parseCoaContent` + `restoreCoa`), `undo-history.js` (per COA, 50 steps, fed by the active-COA store, so a group change is one step; history is dropped for a COA that changed while another was selected), Undo/Redo in the header with Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y (not while typing in a field), and "Deleted “X”. Undo" in the COA list. CONFLICT is reported, never overwritten.
- AC: Ctrl+Z / Ctrl+Shift+Z (and buttons in the header) undo and redo the last change to the
  **active COA**: units, lines, areas, rings, frames, name and description, group copy and delete.
  History is per COA and lasts for the session (it is not stored). Selecting another COA keeps
  each COA's history.
- AC: Undo is one new core command, `coa.restore { coaId, expectedRevision, content }`. It puts back
  a COA's content (name, description, frame, symbols, graphics) as a new revision, with ids kept,
  and publishes `coa.restored`. The UI keeps the snapshots (adapter state, not domain state).
  Redo is another restore.
- AC: Undo of **Delete COA** brings the COA back with the same id (`coa.restore` with
  `expectedRevision: 0`), for as long as the session lasts.
- AC: If the COA changed elsewhere since (another tab or person), undo gives `CONFLICT` and says
  so. It never overwrites someone else's work.
- Decided (D19): per COA.

**H-2 Stay in sync with other tabs and windows ✅ (5)** (was COA-1.17)
- Done, more simply than planned below (decision D20 made it single-user). `cross-window-sync.js` (a UI adapter): each window announces its own `coa.*`, `symbol.*`, `graphic.*` and `settings.*` events on a `BroadcastChannel`. The others reload the active COA, the COA list and the settings, and say "Updated from another window.". The `storage` event and window focus also reload, catching changes nobody announced. Reloading teaches the app client the new revisions, so there is no CONFLICT afterwards. No core, port or `serve.ps1` change was needed, and the `watch` port below stays unbuilt until several people share a server.
- AC: The `CoaRepository` port gets an optional `watch(onChange)`. LocalStorage implements it with
  the browser `storage` event. HttpFile polls `GET /api/coas?revisions`, which returns
  `[{ id, revision }]` (a new `serve.ps1` endpoint, covered by the file-API contract).
- AC: The core publishes `coa.changed-elsewhere { coaId, revision }`. The active-COA store reloads,
  and the app client learns the new revision, so the next command does not hit `CONFLICT`.
- AC: If you are editing a unit or a line when it changes elsewhere, the fields you have not
  touched follow (already true). A notice says "Changed in another window" with a Reload action.
- Decided (D20): one person, several tabs or windows. Polling every few seconds is enough, and sharing is by export/import.

**H-3 Keyboard and screen reader ✅ (5)** (was COA-1.26)
- Done: `keyboard-shortcuts.js`. Delete removes the selected unit or line at once (changed from "with confirmation": Ctrl+Z now brings anything back, and a note says so). Arrow keys nudge 10 px, Shift 50 px, and Leaflet's arrow panning is off while something is selected. Esc closes the editor. "Or type the points" in Lines & areas adds lines, areas and rings from typed `lat, lng` lines, naming any line it cannot read. Automated checks: `a11y.spec.js` (accessible names, unique ids and live regions on the whole app with editors open) and `tests/contrast.test.js` (WCAG AA for the token pairs, both themes).
- AC: Everything can be done without a mouse except drawing on the map, which gets a
  keyboard-free fallback: units already take typed coordinates; lines and areas get a "type
  points" box (one lat, lng per line).
- AC: Delete (with confirmation) removes the selected unit or graphic. Arrow keys nudge the
  selected unit or graphic (Shift for bigger steps). Esc cancels picking and drawing, and closes
  dialogs and editors.
- AC: Every control has an accessible name, live regions announce status messages, focus stays
  visible, and the panel and dialogs have a sensible focus order.
- AC: Automated checks in the browser specs: no unlabelled inputs or buttons and no duplicate ids
  in the mounted app. A Node test checks WCAG AA contrast (4.5:1) for the text and background
  tokens in both themes.

**H-4 Fail safely ✅ (3)**
- Done: `storage-health.js` watches every reply. On `STORAGE_UNAVAILABLE`, `STORAGE_QUOTA_EXCEEDED` or `UNEXPECTED`, a banner over the map says the change was not saved and what to do. It checks the store again every 5 s (Retry now checks at once) and says when saving works again. "Back up all COAs" (COAs section and banner) saves one import-format JSON file, falling back to the COA on screen when stored COAs cannot be read. The CSP is in `index.html`, `serve.ps1` and `serve.py` (a Node test checks they agree), and every browser spec runs under it, with a final spec asserting no violations. `style-src` allows inline styles: Leaflet and the milsymbol SVGs need them, and scripts stay `'self'` only.
- AC: When storage fails (file server stopped, browser storage full, `UNEXPECTED`), a clear
  banner says what happened and what to do. Edits are never shown as saved when they were not.
  The app retries reaching `serve.ps1` and says when it is back.
- AC: "Back up all COAs" (one JSON import-format file) is offered when storage fails, and from the
  COAs section at any time.
- AC: Content-Security-Policy (meta tag): scripts and styles only from the app's own origin,
  images also from `data:`/`blob:`, map tiles from OpenStreetMap only. `serve.ps1` sends the same
  CSP as a header. The browser specs run under it.

**H-5 Large COAs stay fast ✅ (2)**
- Done: measured with 1000 units and 200 lines. It appears in about 0.5 s. A one-unit move used to take 0.5 s to show, with a 0.36 s freeze, because every change rebuilt all markers and redrew every line (profiled). The map view now re-uses markers (rebuilding only those whose look changed, moving the rest), and the graphics layer redraws only graphics that changed. A move now shows in about 0.13 s, with the longest freeze 0.08 s. Storage was never the bottleneck (about 10 ms per read or write). `performance.spec.js` checks the time budget (generous: 3 s) and that markers and lines are re-used.
- AC: A COA with 1000 units and 200 graphics loads, pans and saves smoothly. Budget: under 1 s to
  show after selecting, on a mid-range laptop. A browser spec builds such a COA and checks a time
  budget, generous enough not to be flaky. Markers are re-used between renders instead of being
  rebuilt for every change.

**H-6 Release package and checklist ✅ (2)** (was COA-1.27)
- Done: `npm run package` (`tools/package.mjs`, zip written without dependencies) produces `dist/coa-builder-0.2.0.zip` (115 files, one folder, the build time stamped into `src/shared/version.js`). `tests/release.test.js` reads the zip back: contents, exclusions, byte-identical files. The version is in the title's tooltip and in exported files' `source`. `CHANGELOG.md` and `docs/RELEASE-CHECKLIST.md` are written. The extracted package was run in a browser.
- AC: `npm run package` produces `coa-builder-<version>.zip` with the app, `vendor/`, `serve.ps1`,
  `serve.cmd`, docs and examples, ready to copy to an offline machine.
- AC: The version and build date show in the app (header tooltip) and in exported files' `source`.
- AC: `CHANGELOG.md`, and `docs/RELEASE-CHECKLIST.md`: run the Node, browser and PowerShell tests,
  smoke-test the checklist by hand (create, draw, export a PNG, export and import JSON, two tabs),
  then package.

**Order:** H-4 (safety net first) → H-1 → H-2 → H-3 → H-5 → H-6. Each story is its own commit with tests.

### Epic 3: Threat models — IPB/IPOE steps 3 and 4, before the map (planned 2026-11-23)

**Why:** good threat COAs start without terrain. Step 3 (*Evaluate the threat*) builds a **threat
model**: the **doctrinal template** (how the threat fights, drawn to scale), its preferred tactics,
and its **high-value targets**. Step 4 (*Determine threat COAs*) writes each COA's **statement**
and play. Only then is the play laid on terrain as a **situation template (SITTEMP)**, which is what
COA Builder already does. Because the template is to scale, frontages, depths, fields of fire and
air-defence coverage keep their real distances, so a layout's constraints show before any terrain.

**Decisions:** D21 threat side only; D22 ranges come from a reusable **systems list**; D23 HVT is a
**tag** on a unit; D24 placing a threat COA creates a **new COA** linked back to its model.

**Model**

| Thing | Fields | Notes |
|---|---|---|
| **System** (library) | `{ id, name, role: direct \| indirect \| airDefence \| sensor \| other, maxRange (m), minRange?, arc (°, 360 = all round) }` | Entered by the user, once, and reused (e.g. "SA-15, AD, 12 km, 360°"; "T-72 gun, direct, 2.5 km, 60°"). Nothing is built in. |
| **Threat model** | `{ id, name, description (doctrine source, tactics), formation, coas[] }` | A new aggregate with its own revision, stored like COAs. |
| **Template** (formation or a COA's play) | units `{ id, sidc, label, x, y (m), facing (°), systems: [systemId], hvt }` and graphics in metres | Template space: the reference point is (0, 0) and **up (+y) is the direction of attack**. |
| **Threat COA** (inside a model) | `{ id, name, rank: mostLikely \| mostDangerous \| other, statement: { who, what, when, where, why, how }, endState, template }` | Starts as a copy of the model's formation, then the play is drawn on it. |

**Placement (template → SITTEMP).** You choose an anchor point on the map and a bearing for the
direction of attack. Each template point at (x, y) metres goes to the geodesic destination from the
anchor: distance √(x² + y²), bearing + atan2(x, y). Every distance and angle is preserved. The
result is a new COA: units (with HVT tags), lines and areas, a range ring for each 360° system, a
**sector** for each arc system, and the COA statement as the description. It keeps
`source: { threatModelId, threatCoaId, anchor, bearing }` so it can be placed again.

**Architecture notes**
- The template canvas re-uses Leaflet with a flat, metre-based coordinate system (`L.CRS.Simple`,
  where 1 unit = 1 m), a metric grid and a scale bar. The draw tool, graphics layer, markers and
  handles work unchanged, because they already speak lat/lng and Leaflet maps that onto metres.
- New core messages (same rules as today: envelopes, revisions, events): `system.*`,
  `threat-model.*`, `threat-coa.*`, and `threat-coa.place`, which goes through the COA aggregate,
  so the new COA is checked like any other.
- Storage: `serve.ps1`'s file API becomes general over collections (`/api/coas`,
  `/api/threat-models`, `/api/systems`). Browser storage gets the same, with its own key prefixes.
  The PowerShell tests must be run on a PowerShell machine.
- Map COAs gain an optional unit `hvt` flag (storage v3, import format v1 additive) and a new graphic
  kind `sector` `{ center, radius, minRadius?, bearing, arc }`.

**Stories**

**T-1 Systems list ✅ (3).** Done: `DocumentRepository` port with three adapters and the `/api/docs/<collection>/<id>` file API (both contracts pass against the real `serve.ps1`), `domain/system.js`, `system.create` / `system.update` / `system.delete` / `system.list`, and the **Systems** panel section (km in the form, metres stored; the editor follows changes elsewhere; synced across windows). It sits in the main panel until T-2 adds the Threat models workspace. Add, edit and delete systems (name, role, max/min range, arc). A
`system.*` core with storage in both adapters, and a small panel view.

**T-2 Threat model and template canvas (8).** *T-2a ✅: `domain/threat-model.js` (templates in metres, ids assigned by the core, systems and SIDCs checked) and `threat-model.create` / `update` / `set-template` / `delete` / `list` / `get`. *T-2b ✅: the **Map | Threat models** switch in the header (remembered per browser). The threat workspace has the Threat models, Template and Systems sections and the template canvas: Leaflet `CRS.Simple`, 1 unit = 1 m, with a metric grid, reference point, direction of attack, scale bar, frontage and depth, and Fit. Units are draggable and placed by click or typed x/y, with facing, systems and HVT badges. Coverage is drawn to scale (`domain/template-geometry.js`: rings, sectors along the facing, minimum-range bands), and template lines and areas are drawn with the existing draw tool. Checked in the real app on `serve.ps1`.* Create, rename and delete threat models. A second
workspace (switch **Map | Threat models** in the header) shows the template canvas: a metric grid,
a scale bar and the reference point. Place units (presets or SIDC) by click or by typed x/y in
metres, drag them, set facing, attach systems and tag HVTs. Draw lines and areas in metres. Units'
systems are drawn as rings or sectors to scale. Frontage and depth of the formation are shown live.

**T-3 Threat COAs and statements ✅ (5).** Done: `threat-coa.add` (the play is a copy of the formation with the same unit ids), `threat-coa.update` (name, rank, the six statement parts, end state) and `threat-coa.remove`, and `set-template` with a COA as target. There can be only one most likely and one most dangerous COA; the message names the holder. The **Threat COAs** section lists Formation and the COAs (MLCOA/MDCOA badges) and has the statement editor. Selecting a play shows it on the canvas: units with an end position have a faded start, a dashed arrow and a solid end, both draggable, with coverage at the end. The template editor edits whichever play is shown (end x/y, Pick end on canvas, No movement). Add threat COAs to a model (copied from its formation).
Each has a name, rank (most likely, most dangerous, other), a statement form (who, what, when,
where, why, how), an end state, and its own play (moves, axes, objectives) on the canvas. A side
list switches between the formation and each COA.

**T-4 Sectors of fire ✅ (3).** Done: graphic kind `sector` `{ center, radius, minRadius?, bearing, arc }` in the core, storage (a Point with properties), the import format and schema, and the JSON and GeoJSON exports. On the map it is drawn with two clicks (centre, then where it points at its range; the arc comes from the form), and it has a centre handle and a rim handle (range and direction). It has editor fields and appears on slides. `domain/geodesy.js` (destination, bearing, distance, geodesic sector outline) also replaced the slide layout's own copy of the ring maths. Template sectors stay with systems. A new graphic kind `sector` on the map and in the template: drawn
and edited (centre, radius, optional minimum range, bearing, width), on slides, in import and export.

**T-5 Place on map ✅ (5).** Done: `domain/placement.js` (`templateToMap`, `placePlay`) and the `threat-coa.place` command create a new COA named "… (SITTEMP)" with the COA statement as its description and a `source` link (model, play, anchor, bearing, positions), emitting `coa.placed`. **Place on map…** in the Threat COAs panel switches to the map and shows a faded preview, built by the same `placePlay`, zoomed to fit: drag ✛ to move it, drag ↻ or type a bearing to turn it, and choose start, end, or end with move arrows. **Place** creates and selects the COA; **Cancel** or Escape goes back. Systems become rings (360°) or sectors along bearing + facing. Still open: "Place again" from the stored `source`, and the `hvt` flag is dropped until T-6. Original plan: Pick an anchor (click or type) and a bearing, preview the whole template
on the map with ranges, move and rotate it as one piece, then **Place** to create the SITTEMP COA
(D24). Distances are preserved, which a test checks with geodesic measurement. "Place again" from the
COA re-uses its stored anchor and bearing.

**T-6 HVT tags on the map (2).** The unit `hvt` flag: a highlight on the map and slides, an "HVT"
marker in the legend, and carried through storage, import, export and undo.

**T-7 Template slide ✅ (2).** Done: **Slide (PNG)** in the Threat COAs panel makes a slide of the play shown (`adapters/export/template-slide.js`, painted like map slides): the same banners, title strip (model · COA (MLCOA)) and DTG; the play to scale on a metric grid (reference point, faded starts, move arrows, ends, weapon ranges in role colours, lines, HVT badges), "↑ Direction of attack", a scale bar, frontage and depth; and beside it the COA statement (or the model's description for the formation) and a unit list with weapons. Labels never overlap each other or the boxes. It uses the project's marking and slide shape. Originally: A PNG of the doctrinal template or a threat COA: the play on the metric
grid with a scale bar, ranges and sectors, HVTs marked, and the COA statement beside it. Uses the
same banners and DTG as map slides.

**Order:** T-1 → T-2 → T-4 → T-3 → T-5 → T-6 → T-7. The open questions below are settled while building T-2.

**Decided before T-2:** D25 sets the canvas range at platoon to brigade: about 200 m to 60 km
across, with grid steps from 50 m to 10 km. D26 has a threat COA's play show each unit's **start
and, optionally, end position**, joined by an arrow. When placing on the map you choose start, end,
or end with a ghosted start.

**T-2 is split:** T-2a covers the threat model core and storage. Templates are edited by replacing
the whole template (`threat-model.set-template`); new items get ids from the core. T-2b covers the
workspace switch and the canvas.

### Milestone 10: Data model v2 (planned 2026-11-23, decisions D27–D31)

From the architecture review after T-5. Design and reasons: `docs/DATA-MODEL-V2.md`. Order: one
storage port ✅ → Project manifest ✅ → rich units and unit templates (absorbs T-6) → one drawing with a
georeference (placement sets it) → T-7 on the single renderer.

**M10-1 One storage port ✅.** `DocumentRepository` is the application's only storage port; the COA
and settings ports and their six adapters are gone. Handlers use `coaStore` and `settingsStore`
(`src/application/stores/coa-store.js`) over it, which keep the COA-shaped results and errors. COAs
stay GeoJSON and settings stay where they were (same files, same browser keys), so existing data needs
no migration; the COA and settings contracts now run through every document adapter and the real
`serve.ps1`. `pickStorage` replaced `pickCoaRepository`.

**M10-2 Projects ✅.** A project (D27) holds its own COAs, settings, systems and threat models. The
app runs inside one project, chosen by `main.js` (the last one this browser opened); opening another
reloads the page, like opening another ArcGIS Pro project. Everything saved before is the **Default**
project, unchanged: its collections keep their plain names, and other projects' collections are
`<collection>--<projectId>` (ids are short, e.g. `p50e89b9a187`), which the frozen `serve.ps1` (D32)
already stores as `data/<collection>--<id>/…`. Messages: `project.list/get/create/rename/delete`,
`project.export` (one `coa-builder/project` JSON file) and `project.import` (a new project, ids kept, a
taken name gets "(2)"). UI: a Project section (both workspaces) and the project name in the header.
Settings stay a document of their own rather than living in the project manifest. Also fixed: the
browser test helper `waitFor` never awaited async conditions, so 49 waits checked nothing; they now
do, and all pass.

**M10-3a Rich units ✅ (absorbs T-6).** Units carry `weapons`, `hvt`, `facing` and `details` (D28),
on map COAs and in templates, checked by `domain/weapon.js`. Through storage (GeoJSON schema v3),
the import format and schema (JSON and GeoJSON; CSV keeps `facing` and `hvt`), data export, project
files, undo, duplicate and copy. Templates hold weapons instead of system ids (old ones are read
with the systems copied in); placing a play copies each unit's weapons, HVT tag and details, with the
facing turned into a true bearing, instead of adding ring and sector graphics. The map and slides
draw every unit's ranges from its weapons and badge HVTs (legend "(HVT)"); the unit editors have an
HVT box, facing, a weapons list (copy from the systems list or type one) and details. Next, M10-3b:
unit templates replace the Systems panel.

**M10-3b Unit templates ✅.** A unit template (D29) is a ready-made unit: name, symbol, label, facing,
HVT tag, weapons and details, stored per project. `unit-template.create/update/delete/list`, an
export query and `unit-template.import` for the documented file (`docs/UNIT-TEMPLATES.md`), which is
how unit data from reference sources is brought in by hand or by another tool. The Unit templates
section (both workspaces) replaces the Systems section; both unit editors can start a unit from a
template, and their weapons lists copy from the templates' weapons. `unit-template.from-systems`
turns the old systems list into templates when the user asks. Projects export and import their
templates.

**M10-4a Linked SITTEMPs ✅ (D30, D33).** A COA placed from a threat play stays linked to it: placed
units and drawings carry `link: { key }`, `source` holds the georeference, the model revision it
follows and the keys the user deleted. `coa.update-from-template` takes the play as it is now (new
units appear, removed ones go, linked units follow symbols, weapons, HVT and details);
`coa.re-place` moves or turns the COA as one piece (the placement preview in "Moving" mode, from
the Units section's **Move or turn…**); `symbol.snap-to-template` puts a unit moved on the map back.
The Units section shows where the COA was placed from and flags a play that changed since; moved
units are marked off template on the map. Storage schema v4.

**M10-4b One drawing renderer ✅.** `src/adapters/ui/views/drawing.js` draws for the map's graphics
layer, the template canvas and the placement preview: two spaces (`MAP_SPACE` lat/lng with geodesic
sectors, `TEMPLATE_SPACE` metres), `shapeLayer` (lines, areas, rings, sectors), `addLabel` (one
label placement rule), `weaponRanges` (every unit's ranges) and one symbol icon cache, plus the HVT
badge. Weapon ranges take their role's colour everywhere (domain `WEAPON_ROLE_COLORS`), slides
included. Also: the template canvas no longer has a box over the drawing (Fit is a button; attack,
frontage and depth sit beside the scale bar).

### Later epics (out of scope here)

- **Snapping** (asked for, 2026-11-23): optional snapping on the map and the template canvas (to the grid, to other points, and to angles such as 45°), for cleaner lines and formations.
- **Text on phase lines** (asked for, 2026-11-23): an extra line of text above a phase line (or any line), for a time or H+x, as well as its name. It would show on the map, the canvas and slides.

- **Presentation formats beyond PNG:** SVG, then native `.pptx` with editable text and the description in the speaker notes (decision D10).
- **Control measures (tactical graphics):** full 2525 or APP-6 graphic symbology. It needs its own renderer because milsymbol only draws point symbols.
- **COA comparison:** criteria with weights, scores per COA, and a decision matrix exported as a slide.
- **Timing / phases:** COA phases with order and time windows, and symbols shown per phase (decision D7, design open).
- **SIDC picker:** a full catalogue browser.

## 10. Composition root sketch (`src/main.js`)

```js
import { createApplication } from './application/create-application.js';
import { MilsymbolRenderer } from './adapters/rendering/milsymbol-renderer.js';
import { SystemClock } from './adapters/system/system-clock.js';
import { CryptoIdGenerator } from './adapters/system/crypto-id-generator.js';
import { pickStorage } from './adapters/persistence/pick-storage.js'; // files via serve.ps1, else browser storage, else memory
import { createAppClient } from './adapters/ui/app-client.js';
import { mountUi } from './adapters/ui/mount-ui.js';

const clock = new SystemClock();
const app = createApplication({
  clock,
  ids: new CryptoIdGenerator(globalThis.crypto),
  documentRepository: (await pickStorage({ fetch: globalThis.fetch, getStorage: () => globalThis.localStorage })).documentRepository,
  symbolRenderer: new MilsymbolRenderer(globalThis.ms),     // vendor global, injected here only
});

mountUi({ client: createAppClient(app), L: globalThis.L, root: document.getElementById('app') });
```

---

## 11. Risks and open questions

| # | Item | Mitigation / decision needed |
|---|---|---|
| R1 | **Map tiles need the internet** (OSM's tile usage policy also limits heavy use). Many military uses are offline or air-gapped. | Default to a plain graticule or blank base layer that works offline, with an optional online tile layer. Decide whether local MBTiles or a tile folder is a follow-on epic. |
| R2 | **Classification handling:** COA content may be sensitive. | Local-only storage, no network calls except optional tiles, and a configurable classification banner (stretch). Confirm requirements. |
| R3 | **localStorage limit** (about 5 MB). | Each COA is stored under its own key, and quota errors are surfaced. The repository port allows an IndexedDB adapter later without touching the core. |
| R4 | Which standard is the default: 2525D/E numeric or 2525C letter SIDCs? | Accept both (milsymbol renders both). Decide the default for new symbols; numeric 2525D is recommended. |
| R5 | `crypto.randomUUID` requires a secure context. | `IdGenerator` port with a fallback. Serving from `localhost` counts as secure. |
| R6 | ES modules don't run from `file://`. | `serve.ps1` (PowerShell only) or `npm run serve` (Python). |
| R7 | **`serve.ps1` can only be tested where PowerShell exists.** Node tests start it when `pwsh` is available (PowerShell 7.4 is used here). Windows PowerShell 5.1 is untested. | Its HTTP API is specified once, and a Node fake of it runs the repository contract. The same contract runs against the real `serve.ps1` whenever `pwsh` is available (on your machine, or here once PowerShell is allowed). |
| R8 | `HttpListener` permissions on Windows | Listening on `http://localhost:<port>/` normally needs no admin rights, but `http://+:<port>/` does. Verify on the target machines. |
| R9 | Text documents with military grid references | MGRS → lat/lng conversion is needed for document import. It's pure maths with no library, but needs careful tests. |

## 12. Decisions log

| # | Decision | Date |
|---|---|---|
| D1 | v1 COAs are **unit point symbols only**. Lines come next (simple `LineString`s), then full control-measure symbology. | 2026-11-22 |
| D2 | SIDC entry offers **both** presets and free typing, with a live preview. | 2026-11-22 |
| D3 | Base map: offline lat/lng grid by default, OpenStreetMap as an optional layer. | 2026-11-22 |
| D4 | Import COAs from **text documents** (parse → draft → review → import). | 2026-11-22 |
| D5 | Build the GUI before persistence so the app can be tried by hand early. UI tests use a dependency-free in-browser runner. | 2026-11-22 |
| D6 | Primary storage is **GeoJSON files** written by a **PowerShell server** (`serve.ps1`), for machines with only PowerShell and a browser. Browser storage is the fallback, and CSV is an import/export format. | 2026-11-22 |
| D7 | COAs need **timing** (phases). Model to be designed: see the open question in the session notes. | 2026-11-22 |
| D8 | A malformed SIDC is `VALIDATION_FAILED` on `sidc`. `INVALID_SIDC` means a well-formed SIDC the renderer doesn't recognise. | 2026-11-22 |
| D9 | Layout v2: every tool in **one left panel** of collapsible sections. The COA section has four levels: collapsed, active, active + **3** recent, and all (scroll). | 2026-11-23 |
| D10 | Presentation export is **PNG only** for now. SVG and native `.pptx` come later. | 2026-11-23 |
| D11 | Slide contents: **title, DTG, legend**, and a **classification bar** that is always present and defaults to **green `UNCLASSIFIED`**. The tool isn't for classified data, but marking is explicit by practice. | 2026-11-23 |
| D12 | Aspect ratios: **16:9, 4:3, 5:4** (military products often default to 4:3 or 5:4). | 2026-11-23 |
| D13 | **One shared export frame** by default, so COA slides line up, with an optional **per-COA override**. | 2026-11-23 |
| D14 | Order: layout v2 → presentation export (units only) → lines later. | 2026-11-23 |
| D15 | First graphics: lines (phase line, boundary, axis of advance, route, generic), areas (objective, assembly area, engagement area, generic) and range rings. No full 2525 graphic symbology yet. | 2026-11-23 |
| D16 | Colour comes from the side (friendly blue, hostile red, neutral green, unknown amber), with an optional per-graphic colour override. | 2026-11-23 |
| D17 | Drawing is by clicking points (double-click or Enter finishes, Esc cancels); points can be dragged, inserted and deleted afterwards. | 2026-11-23 |
| D18 | Graphics travel in the same import file (`coas[].graphics`, format v1, additive), in JSON and GeoJSON exports, and on PNG slides. | 2026-11-23 |
| D19 | Undo/redo history is **per COA**: Ctrl+Z only affects the selected COA. | 2026-11-23 |
| D20 | `serve.ps1` is a **personal, single-user** server; COAs are shared by exporting files. Sync (H-2) is for several tabs or windows of one person: plain polling, no multi-user merging. | 2026-11-23 |
| D21 | The pre-map step (threat models, doctrinal templates, threat COA statements) covers the **threat side only**; friendly COA development stays as it is. | 2026-11-23 |
| D22 | Unit weapon and sensor ranges come from a reusable **systems list** entered by the user (nothing built in). | 2026-11-23 |
| D23 | An HVT is a **tag** on a unit (highlighted on template, map and slides); no HVT list or HPT workflow yet. | 2026-11-23 |
| D24 | Placing a threat COA's template on the map creates a **new COA** (a SITTEMP) linked back to its threat model and COA. | 2026-11-23 |
| D25 | Template canvas range: platoon to brigade (about 200 m to 60 km across; grid 50 m to 10 km). | 2026-11-23 |
| D26 | A threat COA's play shows each unit's start and optional end position, joined by an arrow (like a football play). At placement: start, end, or end with a ghosted start. | 2026-11-23 |
| D27 | A **Project** (like an ArcGIS Pro `.aprx`) holds settings and lists its COAs, threat models and unit templates, which stay separate documents. Sharing is by project export. See `docs/DATA-MODEL-V2.md`. | 2026-11-23 |
| D28 | Units carry their own **weapons** (a list of ranges and arcs), HVT tag and checked reference **details**; values, not references. | 2026-11-23 |
| D29 | The systems list becomes **unit templates**, copied into a unit when used; filled by the user or a documented import (no live link to ODIN or similar). Supersedes D22. | 2026-11-23 |
| D30 | A threat play and its SITTEMP are **one drawing**: template metres plus an optional georeference (anchor, bearing); a unit moved to fit terrain gets a map override. Map COAs use the same drawing shape. Supersedes D24's copy. | 2026-11-23 |
| D31 | **One storage port** (`DocumentRepository`) for everything; COAs keep GeoJSON files through a converter. | 2026-11-23 |
| D32 | `serve.ps1` is **frozen**: kept working and tested, not extended. New storage needs (projects) must work through its existing API. | 2026-11-23 |
| D33 | D30 is built as a **linked SITTEMP**: a placed COA stays a map COA (so the map, slides, export and undo work unchanged) whose units and drawings are linked to the play and whose `source` is the georeference. The play is the source of truth: updating or moving re-places it and merges. A unit moved on the map is kept ("off template", with snap back); any other edit makes an item the user's own. | 2026-11-24 |
