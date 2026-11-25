# COA import format — `coa-builder/import` version 1

This is the contract for **any system that produces COAs for COA Builder**, for example a tool
that reads orders or text documents and pulls out units and their locations. That system writes
one JSON document. COA Builder imports it either from the **Import COAs…** button (COAs section)
or as the `coa.import` command message (see [Sending it as a message](#sending-it-as-a-message)).

| File | What it is |
|---|---|
| `docs/import/coa-import.schema.json` | JSON Schema (draft 2020-12) for validating documents before you send them |
| `docs/import/examples/minimal.json` | The smallest valid document: one COA with one unit |
| `docs/import/examples/two-coas-full.json` | Nearly every field in use: two COAs, a frame, unit modifiers, 2525D and 2525C codes |
| `docs/import/examples/units.csv` | The same idea as CSV, one row per unit ([CSV](#csv)) |
| `docs/import/examples/units.geojson` | The same idea as GeoJSON points ([GeoJSON](#geojson)) |
| `docs/KML-EXPORT.md` | What the KML and KMZ exports contain (export only) |
| `docs/TAK-AND-NVG-EXPORT.md` | What the TAK data package (Cursor-on-Target) and NVG exports contain (export only) |
| `docs/GEOJSON-EXPORT.md` | What the app's GeoJSON export (v2) and weapons CSV contain |
| `docs/WEATHER-IMPORT.md` | Weather: forecast and light-data CSV files for the Weather workspace |
| `docs/UNIT-TEMPLATES.md` | A separate file format for **unit templates** (ready-made units with weapons and details) |

Automated tests import every example and check that the schema lists exactly the fields the app
accepts, so this page, the schema and the app cannot drift apart.

## The document

```json
{
  "format": "coa-builder/import",
  "version": 1,
  "source": "OPORD 24-03 annex C",
  "coas": [
    {
      "name": "COA 1 - Envelopment",
      "description": "Main effort envelops from the north.",
      "frame": { "aspect": "16:9", "center": { "lat": 34.10, "lng": -118.20 }, "width": 0.6 },
      "units": [
        { "sidc": "10031000161211000000", "lat": 34.21, "lng": -118.35,
          "label": "1-22 IN", "higherFormation": "1 BCT", "direction": 135 }
      ]
    }
  ]
}
```

### Top level

| Field | Required | Type | Rules |
|---|---|---|---|
| `format` | yes | string | Exactly `"coa-builder/import"` |
| `version` | yes | integer | `1`. A higher number is refused with `UNSUPPORTED_VERSION` (see Errors) |
| `header` | no | object | Written by COA Builder's own exports: the classification marking, project, export time and DTG, application and format. Accepted and not stored |
| `source` | no | string | At most 200 characters. Free text naming the producer or source file. Not stored |
| `coas` | yes | array | 1 to 100 COAs |

### A COA

| Field | Required | Type | Rules |
|---|---|---|---|
| `name` | yes | string | 1–120 characters after trimming; not blank. Names do not need to be unique |
| `description` | no | string | At most 2000 characters. Default `""` |
| `frame` | no | object | Slide frame for PNG export (below). Leave it out to use the shared frame |
| `units` | no | array | 0 to 1000 units. Default `[]` |
| `graphics` | no | array | 0 to 500 lines, areas and range rings ([below](#lines-areas-and-range-rings)). Default `[]` |

### A unit

| Field | Required | Type | Rules |
|---|---|---|---|
| `sidc` | yes | string | 20 or 30 digits (MIL-STD-2525D/E, APP-6D/E) **or** 15 characters `A–Z 0–9 - *` (2525C). Case does not matter (it is upper-cased). It must be a symbol the renderer recognises |
| `lat` | yes, or `mgrs` | number | Latitude, decimal degrees WGS84, −90 to 90 |
| `lng` | yes, or `mgrs` | number | Longitude, decimal degrees WGS84. Any value; it is wrapped into −180 to <180 |
| `mgrs` | instead of `lat` and `lng` | string | An MGRS grid, e.g. `"18S UJ 2348 0648"` (spaces optional, 0 to 5 digits per axis, the same number for both). The unit goes at the **centre of the square** it names. With `lat` and `lng` as well, the two must agree (the point is in that square), or the file is refused: a grid copied wrongly is caught here |
| `label` | no | string | Unique designation, at most 30 characters (e.g. `"1-22 IN"`) |
| `higherFormation` | no | string | At most 50 characters (e.g. `"1 BCT"`) |
| `additionalInformation` | no | string | At most 50 characters |
| `staffComments` | no | string | At most 50 characters |
| `dtg` | no | string | At most 50 characters, shown as written (e.g. `"241200ZMAR24"`) |
| `quantity` | no | string | Up to 9 digits **as text** (e.g. `"18"`). Meant for equipment symbols: on a unit it is drawn where the echelon mark goes |
| `direction` | no | number | Direction of movement in degrees true, 0 to <360 |
| `facing` | no | number | The direction the unit faces, degrees true, 0 to <360. Its weapons' arcs point this way (default north) |
| `hvt` | no | boolean | `true` tags the unit as a high-value target. Default `false` |
| `weapons` | no | array | Up to 20 weapons or sensors ([below](#weapons-and-details)), drawn as range rings or sectors of fire |
| `details` | no | object | Reference information ([below](#weapons-and-details)) |

Modifiers are **flat** fields on the unit, not a nested object. Text is trimmed, and an empty
modifier (`""`) is the same as leaving it out.

### Weapons and details

A unit carries its own weapons, so a COA keeps its ranges wherever it goes.

| Weapon field | Required | Type | Rules |
|---|---|---|---|
| `name` | yes | string | 1–60 characters, e.g. `"125 mm gun"` |
| `role` | yes | string | `"direct"`, `"indirect"`, `"airDefence"`, `"sensor"` or `"other"` (sets the colour) |
| `maxRange` | yes | number | Metres, more than 0, at most 5 000 000 |
| `minRange` | no | number | Metres, less than `maxRange` |
| `arc` | no | number | Width in degrees, more than 0, at most 360 (default 360: all round), centred on the unit's `facing` |

| Details field | Type | Rules |
|---|---|---|
| `strength` | string | At most 50 characters, e.g. `"10 T-72B3"` |
| `equipment` | array | Up to 50 `{ "name", "count" }`: name 1–60 characters, count a whole number 0–100 000 |
| `reference` | string | At most 200 characters: where the data came from (publication, date). Respect its distribution markings |
| `notes` | string | At most 1000 characters |

```json
{ "sidc": "10061000001205000000", "lat": 34.2, "lng": -118.3, "label": "1 TK COY", "facing": 45, "hvt": true,
  "weapons": [ { "name": "125 mm gun", "role": "direct", "maxRange": 2500, "arc": 60 } ],
  "details": { "strength": "10 T-72B3", "equipment": [ { "name": "T-72B3", "count": 10 } ] } }
```

### A frame

| Field | Type | Rules |
|---|---|---|
| `aspect` | string | `"16:9"`, `"4:3"` or `"5:4"` |
| `center` | `{ lat, lng }` | Centre of the slide's map, decimal degrees |
| `width` | number | Width of the map in **degrees of longitude**, more than 0 and at most 360. The height follows from the aspect |

### Lines, areas and range rings

Each entry of a COA's `graphics` list is one of three shapes. Its `kind` decides which.

| Shape | `kind` | Geometry |
|---|---|---|
| Line | `phaseLine`, `boundary`, `axisOfAdvance` (arrow at the last point), `route`, `line` | `points`: 2 to 500 `{ "lat", "lng" }` or `{ "mgrs" }`, in order |
| Area | `objective`, `assemblyArea`, `engagementArea`, `area` | `points`: 3 to 500 `{ "lat", "lng" }` or `{ "mgrs" }`. Don't repeat the first point at the end; the area is closed automatically |
| Range ring | `rangeRing` | `center`: `{ "lat", "lng" }` or `{ "mgrs" }`, and `radius`: metres, more than 0, at most 5 000 000 |
| Sector of fire | `sector` | `center` and `radius` as for a ring, plus `bearing` (the centre line, degrees clockwise from true north, 0 to less than 360), `arc` (width in degrees, more than 0, at most 360), and optionally `minRadius` (minimum range in metres, less than `radius`) |

| Field | Required | Type | Rules |
|---|---|---|---|
| `kind` | yes | string | One of the kinds above |
| `side` | no | string | `"friendly"` (default), `"hostile"`, `"neutral"` or `"unknown"`. Sets the colour: friendly blue, hostile red, neutral green, unknown amber |
| `color` | no | string | `"#rrggbb"`: overrides the side's colour, e.g. `"#000000"` for black |
| `label` | no | string | At most 40 characters, e.g. `"PL GOLD"`, `"OBJ IRON"`, `"AXIS LION"` |
| `annotation` | no | string | Lines only, at most 40 characters: a second line of text shown above the line, e.g. a time or `"H+2"` |
| `points` | lines and areas | array | See the table above. A field that doesn't belong to the shape, such as `radius` on a line, is an error |
| `center`, `radius` | range rings | object, number | See the table above |

```json
"graphics": [
  { "kind": "phaseLine", "label": "PL GOLD", "annotation": "H+2", "points": [ { "lat": 34.15, "lng": -118.40 }, { "lat": 34.15, "lng": -118.00 } ] },
  { "kind": "objective", "label": "OBJ IRON", "side": "hostile",
    "points": [ { "lat": 34.06, "lng": -118.08 }, { "lat": 34.10, "lng": -118.08 }, { "lat": 34.10, "lng": -118.02 } ] },
  { "kind": "rangeRing", "label": "155 mm", "center": { "lat": 34.03, "lng": -118.30 }, "radius": 22000 }
]
```

A line that crosses the 180° meridian is kept continuous: from `179` to `-179` it goes 2° east, not
358° west.

**Any field not listed on this page is an error.** That is deliberate: a misspelt field such as
`"lon"` or `"latitude"` would otherwise be silently lost.

## Rules for producers

- **Coordinates are decimal degrees, WGS84.** Convert MGRS, UTM or DMS before writing the
  document. For example, `34°03'08"N 118°14'37"W` becomes `"lat": 34.0522, "lng": -118.2436`, and
  west and south are negative.
- **Put `lat` and `lng` as numbers**, not strings: write `34.05`, not `"34.05"`.
- **SIDCs come from the standard.** If your system only knows a unit's type in words (such as
  "friendly mechanised infantry battalion"), map it to a code yourself. The app checks every code
  and refuses ones it cannot draw. It does not guess.
- **`quantity` is text and `direction` is a number.** This follows the symbol standard.
- **Import never overwrites.** Each import creates new COAs with new ids, even when the names are
  the same as existing COAs. Importing the same file twice gives two copies.
- **All or nothing.** If any field anywhere is wrong, nothing is imported and the reply lists
  every problem. Your system can fix the problems and send the document again.
- **Encoding is UTF-8 JSON.** Use the `.json` file extension when importing through the button.

## What comes back

### Success

```json
{ "ok": true, "value": { "coas": [ { "id": "coa_…", "name": "COA 1 - Envelopment", "revision": 1, "symbols": [ … ], … } ] } }
```

The reply lists one COA per COA in the document, in the same order and with ids assigned. One
`coa.imported { coa }` event is published for each COA.

### Errors

Every error has the shape `{ "ok": false, "error": { "code", "message", "details" } }`.

| Code | When | `details` |
|---|---|---|
| `IMPORT_INVALID` | Any field is missing, wrong or unknown | `{ "problems": [ { "field", "reason" } ] }`, listing every problem |
| `UNSUPPORTED_VERSION` | `version` is newer than 1 | `{ "found": 2, "supported": [1] }` |
| `VALIDATION_FAILED` | The command message itself is wrong (e.g. no `document`) | `{ "problems": [ … ] }` |

`field` is a path into the document, so the producer can point straight at the bad value:

```json
{ "code": "IMPORT_INVALID", "message": "The import document has problems",
  "details": { "problems": [
    { "field": "coas[0].units[2].sidc", "reason": "must be 20 or 30 digits (2525D/E) or 15 characters A-Z 0-9 - * (2525C)" },
    { "field": "coas[1].units[0].lat",  "reason": "must be a number from -90 to 90" },
    { "field": "coas[1].units[0].lon",  "reason": "unknown field" }
  ] } }
```

## Sending it as a message

In the app, the import is the `coa.import` command, and the **Import COAs…** button sends exactly
this. A system that runs in the same page, such as a script or a future integration adapter, sends
the same envelope through the app client or message bus:

```json
{ "kind": "command", "type": "coa.import", "v": 1, "id": "<unique id>",
  "payload": { "document": { "format": "coa-builder/import", "version": 1, "coas": [ … ] } } }
```

## Other file types the button accepts

The JSON document above is the complete format. **Import COAs…** also takes two simpler files,
which hold units only: no descriptions or frames, and no COAs without units. Units are grouped into
COAs by COA name, in file order. The same field rules apply, and problems are reported in the file's
own terms (`row 3, column sidc` or `features[2].properties.sidc`). All of these formats are what
**Export → Data file** writes, so anything exported can be imported again.

### CSV

```csv
coa,sidc,lat,lng,label,higherFormation,direction
COA 1 - Envelopment,10031000161211000000,34.21,-118.35,1-22 IN,1 BCT,135
"COA 2 - Penetration, centre",10031000161211000000,34.08,-118.26,1-22 IN,,
```

- Lines starting with `#` before the header row are comments: the app's own exports put the
  classification marking there.
- The first row (after any `#` lines) is the header. It must contain `coa`, `sidc`, and `lat` and `lng` or `mgrs`
  (an MGRS grid per row, as in the unit table above; with all three, each row's grid and lat/lng must agree). The other columns
  are optional, in any order, and named exactly like the unit fields: `label`, `higherFormation`,
  `additionalInformation`, `staffComments`, `dtg`, `quantity`, `direction`, `facing`, `hvt` (`true`
  or `false`). Weapons and details need JSON or GeoJSON. Any other column is an error.
- Standard CSV quoting (RFC 4180): put quotes around a cell that contains a comma, a quote or a line
  break, and write a quote inside one as `""`. CRLF or LF line ends; a UTF-8 byte-order mark is
  allowed. Blank lines are skipped, and an empty cell means "not given".
- Exported CSV puts an apostrophe in front of text that starts with `= + - @` so spreadsheets
  don't run it as a formula. Import removes that apostrophe.
- **Spreadsheet warning:** Excel shows a 20- or 30-digit SIDC as a rounded number such as
  `1.0031E+19` and saves it that way, which destroys the code. Import such a column as **Text**, or
  produce CSV with a program rather than by re-saving it from Excel. A damaged SIDC is refused,
  never guessed.

### GeoJSON

A `FeatureCollection` (RFC 7946: `coordinates` are `[longitude, latitude]`). Every feature's
`properties` hold `coa` (the COA name, required).

- **Units** are `Point` features with `sidc` (required) and any of the optional unit fields.
- **Lines, areas and range rings** have `kind` in their properties, plus `side`, `label`,
  `annotation` (lines) and `color` as above. A line is a `LineString`, an area a `Polygon` (the first ring; the closing
  point is optional), and a range ring a `Point` at its centre with `radius` in metres.

Feature `id`s are ignored. CSV files hold units only.

COA Builder's own **GeoJSON v2** export (`docs/GEOJSON-EXPORT.md`: flat weapon fields, rings and
sectors as polygons, weapon ranges) imports too: its `layer`, style and weapon-range features are
read back into units and graphics.

COA Builder's own storage files (one `FeatureCollection` per COA with a `coa` member, as `serve.ps1`
keeps in its data folder) are also accepted. They keep their description and frame.

## Versioning

Additions that old documents still satisfy, such as a new optional field, keep version 1. A change
that would make an old document mean something different, or be refused, becomes version 2. The
app will then keep reading version 1.
