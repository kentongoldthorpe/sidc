# Unit template file — `coa-builder/unit-templates` version 1

A unit template is a ready-made unit: its symbol, label, facing, HVT tag, weapons and reference
details (decision D29). Adding a unit from a template **copies** these values into the unit, so
changing or deleting the template later never changes units already drawn. Templates belong to a
project.

This file is how templates move between projects and people, and how a separate tool or a person
brings in unit data from reference sources (for example an organisation guide or ODIN). COA
Builder does not connect to those sources. **Respect the distribution and classification
markings of whatever you transcribe**; record where it came from in `details.reference`.

**Export templates** (Unit templates section) writes this file; **Import templates…** reads it, or
send it as the `unit-template.import` command `{ "document": … }`.

```json
{
  "format": "coa-builder/unit-templates",
  "version": 1,
  "source": "Unit guide, 2025 edition",
  "templates": [
    {
      "name": "BMP-2 Coy",
      "sidc": "10061000001211020000",
      "label": "MRC",
      "weapons": [
        { "name": "30 mm cannon", "role": "direct", "maxRange": 2000 },
        { "name": "AT-5 ATGM", "role": "direct", "maxRange": 4000, "arc": 90 }
      ],
      "details": { "strength": "10 BMP-2", "equipment": [ { "name": "BMP-2", "count": 10 } ], "reference": "Unit guide, 2025" }
    }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `format` | yes | Exactly `"coa-builder/unit-templates"` |
| `version` | yes | `1`. A higher number is refused with `UNSUPPORTED_VERSION` |
| `header` | no | The export header with the classification marking (`docs/DATA-DICTIONARY.md`). Written by Export templates; accepted and not stored |
| `source` | no | At most 200 characters. Not stored |
| `templates` | yes | 1 to 500 templates |

| Template field | Required | Rules |
|---|---|---|
| `name` | yes | 1–60 characters; what the template is called in pickers |
| `sidc` | yes | A symbol code, as in the COA import format, that the app can draw |
| `label` | no | At most 30 characters; the unit's label (default `""`) |
| `facing` | no | Degrees true, 0 to <360 |
| `hvt` | no | `true` or `false` |
| `weapons` | no | Up to 20 weapons, exactly as in [the COA import format](IMPORT-FORMAT.md#weapons-and-details) |
| `details` | no | Strength, equipment, reference, notes, exactly as in the COA import format |

Any other field is an error. Import is all or nothing: if anything is wrong, nothing is added and
the reply lists every problem by path, e.g. `templates[2].weapons[0].maxRange`. Each import adds new
templates with new ids, even when the names are already used.
