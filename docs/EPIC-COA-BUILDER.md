# EPIC: COA Builder — Course of Action editor for military symbols (SIDC)

| Field | Value |
|---|---|
| Epic ID | COA-1 |
| Status | In progress: Milestone 0, COA-1.6 and COA-1.7 done |
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
- Tactical graphics (lines and areas such as phase lines or boundaries). Point symbols only.
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
| `CoaRepository` | `list() → Result<CoaSummary[]>`, `get(id) → Result<Coa>`, `save(coa, { expectedRevision }) → Result<Coa>`, `remove(id, { expectedRevision }) → Result<void>` | `InMemoryCoaRepository`, `LocalStorageCoaRepository` (one key per COA plus an index key, envelope-wrapped, schema-versioned) |
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

**COA-1.8 Slice: `coa.duplicate`, `coa.delete` (3)**
- AC: Duplicating gives a new id, a default name of `"<name> (copy)"`, revision 1 and new symbol ids, and publishes `coa.duplicated`. `coa.get` of the source is unchanged.
- AC: Deleting with the right revision publishes `coa.deleted`, after which `coa.get` is `NOT_FOUND`. A stale revision gives `CONFLICT`.

**COA-1.9 Slice: `symbol.add` (5)**
- AC: Replies `{coaId, revision, symbol}`, publishes `symbol.added`, and `coa.get` shows the symbol.
- AC (table-driven, all through replies): SIDCs with 20 or 30 digits or the 15-character letter form are accepted and normalised (trimmed, upper-case). Other lengths, characters or blanks give `INVALID_SIDC`. Lat outside ±90, NaN or non-numbers give `VALIDATION_FAILED (position.lat)`. Lng is normalised (190 → −170). A label over 30 characters or modifiers outside the allow-list give `VALIDATION_FAILED`.
- AC: Stale revision gives `CONFLICT`. Unknown COA gives `NOT_FOUND`.

**COA-1.10 Slice: `symbol.update`, `symbol.move`, `symbol.remove` (5)**
- AC: Each replies with the new revision and publishes its event (`symbol.moved` includes `from` and `to`). Order of the other symbols is preserved.
- AC: Unknown `symbolId` gives `NOT_FOUND {coaId, symbolId}`. Stale revision gives `CONFLICT`. Validation is as in 1.9.

**COA-1.11 Slice: `symbol.preview` + `SymbolRenderer` port (3)**
(Takes over the original 1.18.)
- AC: `symbol.preview {sidc, label?, modifiers?, size?}` replies `{svg, valid, warnings, anchor, width, height}` for any SIDC string, including invalid ones.
- AC: `symbol.add` and `symbol.update` use the renderer for semantic validity. A well-formed SIDC that milsymbol rejects gives `INVALID_SIDC {sidc, warnings}`.
- AC: The `SymbolRenderer` contract passes for `StubRenderer` and for `MilsymbolRenderer` (real vendored milsymbol in Node: friendly infantry, hostile armor, invalid SIDC).

### Milestone 3: Persistence

**COA-1.15 `LocalStorageCoaRepository` (5)**
- AC: Passes the CoaRepository contract suite using an injected `FakeStorage`.
- AC: Data is stored as persistence envelopes (`format`, `schemaVersion`, `savedAt`, `data`) under `coa-builder:coa:<id>`, plus a `coa-builder:index` key.
- AC: A storage `QuotaExceededError` becomes `STORAGE_QUOTA_EXCEEDED`. A missing or blocked storage becomes `STORAGE_UNAVAILABLE`. Corrupt JSON for one COA does not hide the others; that COA is reported in `list()` warnings.

**COA-1.16 Schema migrations (2)**
- AC: `migrate(doc)` upgrades step by step to the current version, using pure functions that are each unit-tested. A newer version than supported returns `UNSUPPORTED_VERSION`, and the data is left unchanged.

**COA-1.17 Cross-tab awareness (3, stretch)**
- AC: A `storage` event from another tab is turned into a `coa.externally-changed` event, and the UI offers a reload. Saving a stale revision still yields `CONFLICT`.

### Milestone 4: Symbol rendering
Moved into COA-1.11.

### Milestone 5: GUI (driving adapters)

**COA-1.19 App shell and layout (3)**
- AC: A responsive layout with a COA sidebar, a map in the center, and a symbol editor drawer. It works at 375 px wide and in light and dark mode through CSS tokens. Only `main.js` wires the adapters.

**COA-1.20 COA list view: CRUD (5)**
- AC: Lists COAs with name, symbol count, and last updated time. Users can create a COA (inline form), rename it, duplicate it, and delete it (with a confirm dialog naming the COA). Selecting a COA makes it active.
- AC: Every action sends a command envelope. The view re-renders only from events or query replies. Error replies show inline next to the relevant field.
- AC: The presenter (`toCoaListViewModel`) is unit-tested in Node.

**COA-1.21 Symbol list and editor: CRUD (8)**
- AC: The active COA's symbols are listed with a thumbnail, label, and SIDC.
- AC: The add/edit form has a SIDC field with a live preview (via `symbol.preview`, debounced), validity and warnings, label, modifiers, and lat/lng. Deleting asks for confirmation.
- AC: Clicking a symbol in the list highlights it on the map, and the reverse also works.
- AC: Presenters and form validation mapping are unit-tested in Node.

**COA-1.22 Leaflet map view (5)**
- AC: Renders the active COA's symbols as `L.divIcon` or `L.marker` from `SymbolRenderer` output, anchored correctly.
- AC: Dragging a marker sends `symbol.move`. On `CONFLICT` the marker snaps back and shows a message.
- AC: "Place symbol" mode: clicking the map pre-fills lat/lng in the editor.
- AC: The view fits bounds to the COA's symbols when a COA is selected. Switching COAs clears the old layer.

### Milestone 6: Import / export

**COA-1.23 Export COA(s) to JSON (2)**
- AC: `coa.export` writes a `coa-builder/coa` or `coa-builder/bundle` envelope through `FileGateway`. The filename is slugged from the COA name plus a date.

**COA-1.24 Import COA(s) from JSON (5)**
- AC: Runs the file envelope through validation and migration, then the domain's constructors (no trusting input).
- AC: An id collision offers "import as copy" (new ids). `coa.imported` is emitted for each COA.
- AC: Malformed files return `IMPORT_INVALID` with a readable reason, and nothing is partially written.

### Milestone 7: Hardening

**COA-1.25 Undo / redo (5, stretch)**
Implement it from the event log with inverse commands (`symbol.moved` → `symbol.move` back to the old position).

**COA-1.26 Accessibility and keyboard pass (3)**
Focus order, ARIA labels, Escape closes dialogs, Delete removes the selected symbol (with confirmation), and visible focus rings.

**COA-1.27 Release checklist (1)**
Update the README (run, test, deploy to static hosting), record vendored library versions and licenses, and pass the smoke checklist.

**Total:** about 90 points (about 77 without stretch items).

---

## 10. Composition root sketch (`src/main.js`)

```js
import { createMessageBus } from './application/bus/message-bus.js';
import { registerHandlers } from './application/register-handlers.js';
import { LocalStorageCoaRepository } from './adapters/persistence/local-storage-coa-repository.js';
import { MilsymbolRenderer } from './adapters/rendering/milsymbol-renderer.js';
import { BrowserFileGateway } from './adapters/files/browser-file-gateway.js';
import { CryptoIdGenerator } from './adapters/system/crypto-id-generator.js';
import { SystemClock } from './adapters/system/system-clock.js';
import { mountUi } from './adapters/ui/mount-ui.js';

const clock = new SystemClock();
const ids = new CryptoIdGenerator(globalThis.crypto);
const bus = createMessageBus({ clock, ids });

registerHandlers(bus, {
  repo: new LocalStorageCoaRepository(globalThis.localStorage, { clock }),
  renderer: new MilsymbolRenderer(globalThis.ms),   // vendor global, injected here only
  files: new BrowserFileGateway(document),
  clock, ids,
});

mountUi({ bus, L: globalThis.L, root: document.getElementById('app') });
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
| R6 | ES modules don't run from `file://`. | Document `python3 -m http.server`. Optionally ship a single-file build later (out of scope). |
