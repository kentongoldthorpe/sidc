# Project file — `coa-builder/project` version 1

A whole project in one JSON file: what **Export project** writes and **Import project…** reads
(the `project.export` query and `project.import` command). It is how work moves between people
and machines (D20, D27), and the most complete export the app makes.

| File | What it is |
|---|---|
| `docs/project/project.schema.json` | JSON Schema (draft 2020-12) for the top level and the main records |
| `docs/DATA-DICTIONARY.md` | Every record and field, with types and units |

```json
{
  "format": "coa-builder/project",
  "version": 1,
  "header": { "classification": "UNCLASSIFIED", "classificationColor": "#007a33", "project": "Exercise IRON",
              "exportedAt": "2026-11-24T21:05:00.000Z", "dtg": "242105ZNOV26", "application": "COA Builder 0.2.0",
              "format": "coa-builder/project", "formatVersion": 1 },
  "name": "Exercise IRON",
  "exportedAt": "2026-11-24T21:05:00.000Z",
  "settings": { "frame": null, "marking": { "text": "UNCLASSIFIED", "color": "#007a33" } },
  "coas": [ … ],
  "threatModels": [ … ],
  "unitTemplates": [ … ],
  "weatherForecasts": [ … ],
  "weatherCriteria": [ … ],
  "systems": [ … ]
}
```

| Field | Required | What it holds |
|---|---|---|
| `format` | yes | `"coa-builder/project"` |
| `version` | yes | `1`; a newer version is refused with `UNSUPPORTED_VERSION` |
| `header` | no | The export header with the **classification marking** (data dictionary). Accepted, not stored |
| `name` | yes | The project's name; when already used, the imported project is named "name (2)" |
| `exportedAt` | no | When it was written |
| `settings` | no | Slide frame and classification marking |
| `coas` | no | Map COAs as stored, ids kept (placed SITTEMPs keep their link to their threat play) |
| `threatModels` | no | Formations and threat COAs, in metres |
| `unitTemplates` | no | Ready-made units |
| `weatherForecasts` | no | Forecasts with their periods and light data |
| `weatherCriteria` | no | Critical values for the weather effects matrix |
| `systems` | no | The systems list from before unit templates, kept so old threat models read |

**Import** makes a **new** project and keeps every id, so references inside the file (a placed COA's
threat model, a unit's weapons copied from a system) still work. It is all or nothing: every
problem is listed by path (`coas[2].symbols[0].sidc`, `weatherForecasts[0]`), and nothing is stored
when there is one.

Any field not listed above is an error, so a misspelt section is not silently lost.
