# Threat model file — `coa-builder/threat-model` version 1

One threat model in one file: its doctrinal template (the **formation**) and its threat COAs, each
with its own play. It is how a threat model moves between projects and people, and how another
tool brings one in. The JSON Schema is `docs/threat-model/threat-model.schema.json`; every field is
described in `docs/DATA-DICTIONARY.md` (Threat model, Threat COA, Template unit).

**Export model** (Threat models → Selected model) writes this file; **Import model…** reads it as
a new threat model, or send it as the `threat-model.import` command `{ "document": … }`. A name
already used in the project gets "(2)". Ids of units and COAs are kept, so plays still match the
formation.

**Positions are metres, not coordinates.** A template has no place on the earth: `x` is metres to
the right of the direction of attack, `y` metres along it, from the template's reference point.
To give another system a threat play **on the ground**, place the play on the map (Threat COAs →
Place on map) and export that SITTEMP as GeoJSON, KML or KMZ like any other COA
(`docs/GEOJSON-EXPORT.md`, `docs/KML-EXPORT.md`).

```json
{
  "format": "coa-builder/threat-model",
  "version": 1,
  "header": {
    "classification": "UNCLASSIFIED",
    "project": "Default",
    "exportedAt": "2026-11-25T08:00:00.000Z",
    "format": "coa-builder/threat-model",
    "formatVersion": 1
  },
  "model": {
    "name": "MRB in the attack",
    "description": "Forward detachment leads; main body follows 10 km behind.",
    "formation": {
      "units": [
        { "id": "u1", "sidc": "10061000001211000000", "label": "1 MRC", "x": -900, "y": 0, "facing": 0,
          "hvt": false, "weapons": [ { "name": "30 mm cannon", "role": "direct", "maxRange": 2000, "arc": 90 } ] },
        { "id": "u2", "sidc": "10061000001301000000", "label": "AD", "x": 0, "y": -2500, "hvt": true,
          "weapons": [ { "name": "SA-15", "role": "airDefence", "maxRange": 12000 } ], "details": { "strength": "4 TELAR" } }
      ],
      "graphics": [
        { "id": "g1", "kind": "axisOfAdvance", "label": "AXIS", "points": [ { "x": 0, "y": -2000 }, { "x": 0, "y": 7000 } ] }
      ]
    },
    "coas": [
      {
        "id": "c1",
        "name": "Envelop from the west",
        "rank": "mostLikely",
        "statement": { "who": "MRB(-)", "what": "attacks", "when": "at BMNT", "where": "west of the river",
          "why": "to seize the crossings", "how": "fixing in the east, enveloping in the west" },
        "endState": "Crossings held",
        "template": {
          "units": [ { "id": "u1", "sidc": "10061000001211000000", "label": "1 MRC", "x": -900, "y": 0, "end": { "x": -2500, "y": 6000 } } ],
          "graphics": []
        }
      }
    ]
  }
}
```

## Rules

- `format` and `version` are required; a later `version` is refused with `UNSUPPORTED_VERSION`.
- `header` is the export header (classification marking, project, time, DTG, application,
  format). It is accepted and not stored: **check the marking before you pass a file on**.
- `model.name` is required (1–120 characters); `description` is optional (≤ 4000).
- `model.formation` holds `units` and `graphics`, at most 500 of each; every COA's `template` is the
  same shape. A unit in a play may have `end` (where it moves to, D26).
- `rank` is `mostLikely`, `mostDangerous` or `other`; at most one of each of the first two.
- **All or nothing.** If anything is wrong, nothing is stored and every problem is listed by path,
  for example `model.coas[0].rank: must be one of mostLikely, mostDangerous, other`. Fields the
  format does not have are problems too, so a misspelt field is never silently dropped.
