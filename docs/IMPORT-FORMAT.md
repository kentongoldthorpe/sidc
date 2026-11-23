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
| `source` | no | string | At most 200 characters. Free text naming the producer or source file. Not stored |
| `coas` | yes | array | 1 to 100 COAs |

### A COA

| Field | Required | Type | Rules |
|---|---|---|---|
| `name` | yes | string | 1–120 characters after trimming; not blank. Names do not need to be unique |
| `description` | no | string | At most 2000 characters. Default `""` |
| `frame` | no | object | Slide frame for PNG export (below). Leave it out to use the shared frame |
| `units` | no | array | 0 to 1000 units. Default `[]` |

### A unit

| Field | Required | Type | Rules |
|---|---|---|---|
| `sidc` | yes | string | 20 or 30 digits (MIL-STD-2525D/E, APP-6D/E) **or** 15 characters `A–Z 0–9 - *` (2525C). Case does not matter (it is upper-cased). It must be a symbol the renderer recognises |
| `lat` | yes | number | Latitude, decimal degrees WGS84, −90 to 90 |
| `lng` | yes | number | Longitude, decimal degrees WGS84. Any value; it is wrapped into −180 to <180 |
| `label` | no | string | Unique designation, at most 30 characters (e.g. `"1-22 IN"`) |
| `higherFormation` | no | string | At most 50 characters (e.g. `"1 BCT"`) |
| `additionalInformation` | no | string | At most 50 characters |
| `staffComments` | no | string | At most 50 characters |
| `dtg` | no | string | At most 50 characters, shown as written (e.g. `"241200ZMAR24"`) |
| `quantity` | no | string | Up to 9 digits **as text** (e.g. `"18"`). Meant for equipment symbols: on a unit it is drawn where the echelon mark goes |
| `direction` | no | number | Direction of movement in degrees true, 0 to <360 |

Modifiers are **flat** fields on the unit, not a nested object. Text is trimmed, and an empty
modifier (`""`) is the same as leaving it out.

### A frame

| Field | Type | Rules |
|---|---|---|
| `aspect` | string | `"16:9"`, `"4:3"` or `"5:4"` |
| `center` | `{ lat, lng }` | Centre of the slide's map, decimal degrees |
| `width` | number | Width of the map in **degrees of longitude**, more than 0 and at most 360. The height follows from the aspect |

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

## The app's own COA files

The **Import COAs…** button also accepts the GeoJSON files COA Builder writes (one
`FeatureCollection` per COA, the format `serve.ps1` stores in its data folder). They are converted
to this format before import, so they also arrive as new copies. Do not produce GeoJSON from other
systems: use this format, which is documented, versioned and simpler.

## Versioning

Additions that old documents still satisfy, such as a new optional field, keep version 1. A change
that would make an old document mean something different, or be refused, becomes version 2. The
app will then keep reading version 1.
