# Data model v2: projects, rich units, one drawing (decision record, 2026-11-23)

Status: **accepted, not built yet** (Milestone 10). Decisions D27–D31 in the epic's decisions log.

## Why

After Epic 3 T-5 the same idea is modelled twice. A map COA has `symbols` in lat/lng; a threat play
has `units` in metres. Each has its own checking (`parseCoaContent`, `parseTemplate`), its own edit
commands (about 15 fine-grained commands for COAs, one whole-replace `set-template` for plays), its
own screen drawing (map view, template canvas, placement preview) and only COAs have undo. Units
point to a separate systems list by id, so a COA exported on its own loses its ranges. Placing a
play copies it into a new COA, and the two then drift apart. Storage has three ports (COAs,
settings, documents), each with three adapters.

## The model

```
Project   { id, name, settings: { marking, frame }, order }        ← like an ArcGIS Pro .aprx: a manifest
  coas/            Coa                                              ← items are separate documents
  threat-models/   ThreatModel
  unit-templates/  UnitTemplate                                     ← replaces the systems list

Drawing   { units: Unit[], graphics: Graphic[], georef?: Georef }  ← one shape for COAs and plays
Georef    { anchor: { lat, lng }, bearing }                         ← how template metres sit on the map
Unit      { id, sidc, label, modifiers,
            at,               native position: { lat, lng } on a map COA, { x, y } metres in a template
            mapAt?,           only in a georeferenced template: a terrain adjustment off the template
            end?,             a move's end position, in the same space as `at`
            facing?, hvt?,
            weapons?: Weapon[],                                     ← ranges live in the unit (D28)
            details?: { strength?, equipment?: [{ name, count }], reference?, notes? } }
Weapon    { name, role, maxRange, minRange?, arc }
UnitTemplate { id, name, unit: Unit without id/at }                 ← stamps new units (D29)
```

### D27: a Project holds everything, as a manifest

A project names an operation or exercise. It holds the settings that today are global (classification
marking, shared slide frame) and lists its items, which stay **separate documents** so that two
windows editing different COAs never clash on one revision number. On disk:
`data/projects/<projectId>/project.json` plus one folder per collection. Exporting a project gives
one self-contained file (COAs, threat models, unit templates, settings), which is how work is
shared (D20). The app reopens the last project, so with one project it behaves as today. Existing
data moves into a project called "Default" on first start.

### D28: units carry their own weapons, HVT tag and details

A unit holds a list of weapons (a tank company has a main gun, ATGMs and perhaps a MANPADS team),
not a single range. Ranges are values in the unit, not references, so nothing dangles after an
export, and a placed COA keeps its weapons as data instead of rings drawn once at placement.
`details` holds reference information (strength, equipment and counts, source, notes), typed and
checked by the core; anything not in the list is refused, as in the import format.

### D29: systems become unit templates, copied when used

A unit template is a ready-made unit (symbol code, label pattern, weapons, details), like an ArcGIS
feature template. Adding a unit from it **copies** its values; editing the template later does not
change units already drawn (an explicit "update from template" can come later). The library is
filled by the user or imported from a documented JSON file (below); nothing is built in (D22).

### D30: one drawing for map COAs and threat plays, with an optional georeference

A threat COA and its SITTEMP are **one record**, not a play and a copy. A play is a drawing in
template metres. Placing it on the map sets its `georef` (anchor and bearing); map positions are
calculated, so moving or turning the whole play only changes the georeference. When the analyst
fits a unit to the terrain, that unit gets `mapAt`, an override that is shown as "off template" with
a way back. This is the "second coordinate set", kept only where it differs, so the two sets can
never disagree silently, and the deviation from doctrine stays visible.

A friendly map COA is the same drawing in lat/lng without a georeference. One set of edit commands
takes a drawing reference (`{ coaId }` or `{ modelId, play }`), so both get undo. One drawing layer,
given a "position to screen" function, draws the map, the template canvas and the preview. Placement
becomes a coordinate change; `threat-coa.place` sets `georef` instead of creating a copy.

### D31: one storage port

`DocumentRepository` (collections of `{ id, revision }` documents) replaces the COA and settings
ports. COAs keep their GeoJSON files through a per-collection converter. A project is a path prefix.

## Unit reference data from other systems (ODIN and similar)

Sources such as ODIN (the Army's OE data portal, behind CAC) hold unit organisations and equipment
data. COA Builder will **not** connect to them: the app has no login, and its server is a personal
file server (D20). Instead, the unit-template import is a documented JSON format, like the COA
import format, so a person or a separate tool can transcribe or convert the data they are allowed to
use. Each template keeps a `reference` (source and date). Producers must respect the data's
distribution and classification markings; the app's classification banner is the user's to set.

## Order of work (Milestone 10)

1. One storage port (mechanical, low risk). ✅ Done: COAs and settings keep their files and keys.
2. Project manifest, settings into the project, project export and import, migration to "Default".
3. Rich units: `weapons`, `hvt` (this was T-6), `details`; unit templates replace systems, with their
   import format.
4. One drawing: shared unit and graphic shape and commands, georeference and `mapAt`, one drawing
   layer. Placement becomes setting a georeference.
5. T-7 template slide on the single renderer.

Each step lands with every test green; the file format gets a version and a migration at steps 2–4.
