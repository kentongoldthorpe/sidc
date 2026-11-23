# Changelog

## 0.2.0 — 2026-11-23

First packaged release (`npm run package`).

**COAs and units**
- Create, rename, duplicate and delete COAs; the list shows the active COA, recent ones, or all.
- Units from presets (affiliation, unit type, echelon, HQ) or a typed SIDC with a live preview;
  place by typing coordinates, Pick on map, or dragging; modifiers; copy and delete several at once;
  50% transparent units.

**Lines, areas and range rings**
- Phase lines, boundaries, axes of advance, routes and lines; objectives, assembly and engagement
  areas and areas; range rings. Colour by side with an optional own colour; hostile dashed.
- Draw by clicking, or type the points; edit by dragging, inserting and removing points.

**Export and import**
- PNG slides (16:9, 4:3, 5:4) with classification banners, title, DTG, legend and full-bleed map;
  one shared frame with per-COA overrides; export all COAs.
- Data files: JSON (complete), GeoJSON (GIS), CSV (spreadsheets). Import COAs from any of them, or
  from the documented import format (`docs/IMPORT-FORMAT.md`) other systems can write.

**Safety and convenience**
- Undo / Redo per COA (Ctrl+Z, Ctrl+Shift+Z); a deleted COA can be brought back.
- Windows of the same app stay in step; a banner says when a change could not be saved;
  Back up all COAs.
- Keyboard: Delete, arrow-key nudges, Esc. Accessibility and contrast checks in the tests.
- Content-Security-Policy; labels from files are always shown as text.
- Large COAs (1000 units, 200 lines) stay quick.

**Storage**
- GeoJSON files through `serve.ps1` (PowerShell only), or browser storage. Storage format version 2
  (older files are upgraded when read).

## 0.1.0

Development snapshots before the first package.
