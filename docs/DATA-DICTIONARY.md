# Data dictionary

Every record COA Builder keeps, with its fields, types and units, and the files that carry it to
other systems (Epic 5). Automated tests check each table below against the fields the code
accepts, so this page cannot drift from the app.

**Conventions everywhere**

- **Positions** on the map are WGS 84 decimal degrees `{ lat, lng }` (−90…90, −180…<180). In
  GeoJSON they are `[longitude, latitude]` (RFC 7946).
- **Template positions** are metres `{ x, y }` from the template's reference point; `+y` is the
  direction of attack and `+x` is to its right. They have no place on the earth until a play is
  placed (D30), so they travel in JSON, not GeoJSON or KML.
- **Bearings and facings** are degrees clockwise from true north (on the map) or from the direction
  of attack (in a template), 0 to <360.
- **Distances and ranges** are metres; weather uses the units named in its field names
  (`windSpeedKt`, `visibilityKm`, `ceilingFt`).
- **Times** are ISO 8601 UTC (`2026-11-24T21:05:00.000Z`); weather dates are `YYYY-MM-DD` with
  periods `0000-1200` / `1200-2400`, light times `HHMM`; slides and headers also give the DTG
  (`242105ZNOV26`).
- **Symbol codes** (`sidc`) are MIL-STD-2525D/E or APP-6D/E (20 or 30 digits) or 2525C (15
  characters).
- **Ids** are text, unique within their collection; `revision` counts saved changes (optimistic
  concurrency).
- **Every exported file carries a header** (below) with the classification marking.

## Export header

Written into every data file the app exports: JSON and GeoJSON as a `header` object, CSV as its
first line (`# MARKING // project // exported DTG // application // format vN`). Importers accept
it and do not store it.

| Field | Type | Notes |
|---|---|---|
| `classification` | text | The project's classification marking, as on slides |
| `classificationColor` | `#rrggbb` | The marking's banner colour |
| `project` | text | The project the data came from |
| `exportedAt` | ISO time | When the file was written |
| `dtg` | text | The same moment as a DTG |
| `application` | text | `COA Builder <version>` |
| `format` | text | The file format, e.g. `coa-builder/import`, `geojson`, `csv` |
| `formatVersion` | integer | The version of that format |

## Project

Carried in: the project file (`docs/PROJECT-FORMAT.md`).

| Field | Type | Notes |
|---|---|---|
| `id` | text | `default`, or `p` and up to 11 lower-case letters or digits |
| `name` | text | 1–120 characters |
| `revision` | integer | 0 for the Default project until it is renamed |
| `createdAt` | ISO time | |
| `updatedAt` | ISO time | |

## Settings

One per project. Carried in: the project file.

| Field | Type | Notes |
|---|---|---|
| `revision` | integer | |
| `frame` | object or null | The shared slide frame `{ aspect: 16:9 \| 4:3 \| 5:4, center: { lat, lng }, width (degrees of longitude) }` |
| `marking` | object | `{ text (≤ 80), color: #rrggbb }`: the classification banner |

## COA

A course of action on the map, including situation templates placed from a threat play.
Carried in: COA JSON (`docs/IMPORT-FORMAT.md`), GeoJSON v2 (`docs/GEOJSON-EXPORT.md`), KML and KMZ
(`docs/KML-EXPORT.md`), TAK data packages and NVG (`docs/TAK-AND-NVG-EXPORT.md`), CSV (units), the weapons CSV, PNG slides, storage files (GeoJSON schema
v4), the project file.

| Field | Type | Notes |
|---|---|---|
| `id` | text | |
| `name` | text | 1–120 characters |
| `description` | text | ≤ 2000 characters; a placed SITTEMP holds the COA statement here |
| `createdAt` | ISO time | |
| `updatedAt` | ISO time | |
| `revision` | integer | |
| `frame` | object | Optional: this COA's own slide frame |
| `source` | object | Only on a placed COA: `{ threatModelId, play, anchor: { lat, lng }, bearing, positions: start \| end \| endWithMoves, modelRevision, excluded: [link keys] }` (D30) |
| `symbols` | list | Units (below) |
| `graphics` | list | Lines, areas, rings and sectors (below) |

## Unit

A unit on a map COA (also called a symbol). Carried in: COA JSON, GeoJSON v2 (a Point with flat
fields: `weapon1_name` …), KML/KMZ, a CoT marker in a TAK package, an NVG point, CSV (one row; weapons and details need JSON or GeoJSON), the weapons CSV
(one row per weapon), storage, slides.

| Field | Type | Notes |
|---|---|---|
| `id` | text | |
| `sidc` | text | Symbol code |
| `position` | `{ lat, lng }` | |
| `label` | text | ≤ 30 characters, the unique designation |
| `modifiers` | object | Text modifiers (below) |
| `facing` | degrees | Optional: the way the unit faces; its weapons' arcs point this way |
| `hvt` | boolean | Optional: high-value target (D23) |
| `weapons` | list | Optional: up to 20 weapons (below), drawn as range rings or sectors (D28) |
| `details` | object | Optional: reference details (below) |
| `link` | object | Only on a placed unit: `{ key: "unit:<template unit id>", moved?: true }` (D30) |

### Modifiers

| Field | Type | Notes |
|---|---|---|
| `higherFormation` | text | ≤ 50 |
| `additionalInformation` | text | ≤ 50 |
| `staffComments` | text | ≤ 50 |
| `dtg` | text | ≤ 50, shown as written |
| `quantity` | text | up to 9 digits |
| `direction` | degrees | direction of movement, 0 to <360 |

### Weapon

A value copied into each unit (and template unit, and unit template), not a reference.

| Field | Type | Notes |
|---|---|---|
| `name` | text | 1–60 |
| `role` | text | `direct`, `indirect`, `airDefence`, `sensor` or `other`; sets the colour |
| `maxRange` | metres | > 0, ≤ 5 000 000 |
| `minRange` | metres | optional, < `maxRange` |
| `arc` | degrees | > 0, ≤ 360 (360 = all round), centred on the unit's facing |

### Details

| Field | Type | Notes |
|---|---|---|
| `strength` | text | ≤ 50 |
| `equipment` | list | up to 50 `{ name (1–60), count (0–100 000) }` |
| `reference` | text | ≤ 200: where the data came from; respect its markings |
| `notes` | text | ≤ 1000 |

## Graphic

A line, area, range ring or sector on a map COA. Carried in: COA JSON, GeoJSON v2 (LineString or
Polygon; rings and sectors as geodesic polygons with their parameters), KML/KMZ, TAK drawings, NVG,
storage, slides.

| Field | Type | Notes |
|---|---|---|
| `id` | text | |
| `kind` | text | lines `phaseLine`, `boundary`, `axisOfAdvance`, `route`, `line`; areas `objective`, `assemblyArea`, `engagementArea`, `area`; `rangeRing`; `sector` |
| `side` | text | `friendly`, `hostile`, `neutral`, `unknown`: the colour |
| `label` | text | ≤ 40 |
| `annotation` | text | lines only, optional, ≤ 40: a second line of text above the line, e.g. a time or `H+2` |
| `color` | `#rrggbb` | optional, overrides the side's colour |
| `points` | list of `{ lat, lng }` | lines (2–500) and areas (3–500) |
| `center` | `{ lat, lng }` | rings and sectors |
| `radius` | metres | rings and sectors |
| `minRadius` | metres | sectors, optional |
| `bearing` | degrees | sectors: the centre line |
| `arc` | degrees | sectors: the width |
| `link` | object | only on a placed drawing: `{ key: "graphic:<id>" \| "move:<unit id>" }` |

## Threat model

A threat's doctrinal template and its COAs (IPB step 3–4). Carried in: the threat model file
(`docs/THREAT-MODEL-FORMAT.md`), the project file, template slides (PNG); a play placed on the map
is a COA and goes out as one.

| Field | Type | Notes |
|---|---|---|
| `id` | text | |
| `revision` | integer | |
| `name` | text | ≤ 120 |
| `description` | text | ≤ 4000: doctrine and tactics |
| `createdAt` | ISO time | |
| `updatedAt` | ISO time | |
| `formation` | template | `{ units: [template unit], graphics: [template graphic] }` in metres |
| `coas` | list | Threat COAs (below) |

### Threat COA

| Field | Type | Notes |
|---|---|---|
| `id` | text | |
| `name` | text | ≤ 120 |
| `rank` | text | `mostLikely`, `mostDangerous` or `other` (one of each of the first two) |
| `statement` | object | `{ who, what, when, where, why, how }`, each ≤ 1000 |
| `endState` | text | ≤ 1000 |
| `template` | template | the COA's play, in metres |

### Template unit

| Field | Type | Notes |
|---|---|---|
| `id` | text | |
| `sidc` | text | |
| `label` | text | ≤ 30 |
| `x` | metres | across the direction of attack |
| `y` | metres | along the direction of attack |
| `facing` | degrees | from the direction of attack |
| `weapons` | list | as for a unit |
| `systems` | list of ids | read only, from before M10-3: copied in as weapons |
| `hvt` | boolean | |
| `details` | object | as for a unit |
| `end` | `{ x, y }` | in a COA's play: where the unit moves to (D26) |

## Unit template

A ready-made unit (D29). Carried in: the unit template file (`docs/UNIT-TEMPLATES.md`), the
project file.

| Field | Type | Notes |
|---|---|---|
| `id` | text | not in the template file |
| `revision` | integer | not in the template file |
| `name` | text | 1–60 |
| `sidc` | text | |
| `label` | text | ≤ 30 |
| `facing` | degrees | optional |
| `hvt` | boolean | optional |
| `weapons` | list | optional |
| `details` | object | optional |

## Forecast

Weather for the project's area of operations (Epic 4). Carried in: the project file; the weather
CSV files, in and out (`docs/WEATHER-IMPORT.md`); the weather JSON (`coa-builder/weather`).

| Field | Type | Notes |
|---|---|---|
| `id` | text | |
| `revision` | integer | |
| `name` | text | ≤ 80 |
| `area` | text | ≤ 120 |
| `timeZone` | text | default `Z` |
| `createdAt` | ISO time | |
| `updatedAt` | ISO time | |
| `periods` | list | Periods (below), in date and period order |
| `light` | list | Light data (below), by date |

### Period

| Field | Type | Notes |
|---|---|---|
| `date` | `YYYY-MM-DD` | |
| `half` | text | `0000-1200` or `1200-2400` |
| `temperatureMaxC` | °C | |
| `temperatureMinC` | °C | not above the maximum |
| `windSpeedKt` | knots | |
| `windGustKt` | knots | not below the wind speed |
| `windDirectionDeg` | degrees | the direction the wind comes from |
| `visibilityKm` | km | |
| `ceilingFt` | feet | 100 000 means no ceiling (UNL) |
| `cloudCoverPct` | % | |
| `precipitation` | text | `none`, `drizzle`, `rain`, `snow`, `sleet`, `freezingRain`, `hail`, `thunderstorm` |
| `precipitationMm` | mm | in the period |
| `humidityPct` | % | |
| `notes` | text | ≤ 200 |

### Light data

| Field | Type | Notes |
|---|---|---|
| `date` | `YYYY-MM-DD` | |
| `bmnt` | `HHMM` | begin morning nautical twilight |
| `sunrise` | `HHMM` | |
| `sunset` | `HHMM` | |
| `eent` | `HHMM` | end evening nautical twilight |
| `moonrise` | `HHMM` | |
| `moonset` | `HHMM` | |
| `illuminationPct` | % | moon illumination |

## Critical values

The values at which weather becomes marginal (amber) or unfavourable (red) for an operation or
system (D36). Carried in: the project file; the weather JSON, with the effects matrix they give
(also as a CSV).

| Field | Type | Notes |
|---|---|---|
| `id` | text | |
| `revision` | integer | |
| `name` | text | ≤ 60 |
| `group` | text | ≤ 40 |
| `example` | boolean | from the starter set and not yet edited |
| `rules` | list | up to 20 rules (below) |

### Rule

| Field | Type | Notes |
|---|---|---|
| `factor` | text | a period factor with a worse direction, `illuminationPct`, or `precipitation` |
| `amber` | number or list | at or below (visibility, ceiling, minimum temperature, illumination) or at or above (others); a list of precipitation types for `precipitation` |
| `red` | number or list | as amber, at least as bad |
