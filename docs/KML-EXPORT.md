# KML and KMZ export

What **Export → Data file → KML** and **KMZ** write: KML 2.2 (OGC) for Google Earth, TAK and the
many C2 and mapping viewers that read it. Both are built from the same features as the GeoJSON
export (`docs/GEOJSON-EXPORT.md`), so they hold the same things. They are for other systems:
COA Builder does not import KML.

| | KML (`.kml`) | KMZ (`.kmz`) |
|---|---|---|
| What it is | One XML file | A zip: `doc.kml` first, then `icons/<symbol code>.png` |
| Unit icons | A coloured pin (side colour) | Each unit's **MIL-STD-2525 symbol** as a PNG |
| Use when | A tool wants plain KML, or icons do not matter | You want the symbols to show (Google Earth, TAK) |

## What is in it

- **The classification marking** is the first thing in the document's name
  (`SECRET // Exercise IRON // COA 1`), its one-line snippet and its description, and every header
  field (marking, project, export time and DTG, application, format) is in the document's
  ExtendedData. Keep it with anything you derive from the file.
- **One folder per COA**, with up to three folders inside: **Units**, **Lines and areas**,
  **Weapon ranges**.
- **Units** are placemarks named by their label (or symbol code), with `[HVT]` after the name of a
  high-value target. Every field is in ExtendedData: `sidc`, `label`, modifiers, `facing`, `hvt`,
  details, and each weapon (`weapon1_name`, `weapon1_max_m`, …), exactly as in GeoJSON.
- **Lines** are tessellated LineStrings (they follow the ground in Google Earth). **Areas, range
  rings, sectors and weapon ranges** are Polygons; rings and sectors keep their parameters
  (`centerLat`, `centerLng`, `radius`, `minRadius`, `bearing`, `arc`) in ExtendedData.
- **Styles** follow the app: the side's colour or the chosen colour for lines and areas, the
  weapon role's colour for ranges, filled lightly. Styles are shared, so the file stays small.
- All text is escaped, so labels and notes from other files cannot break the document.

KML has no place for a threat template in metres: templates leave as JSON (Epic 5 X-4); placed
SITTEMPs are ordinary COAs and export here.
