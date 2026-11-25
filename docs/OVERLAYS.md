# Overlays at map scale

Print a COA at the paper map's scale to lay over the map and the original acetate (Epic 6 E6-4,
decision D46; the overlay check in `docs/ANALOG-DIGITAL-WORKFLOW.md`, read-back step 3).

**Export → Overlay at map scale (print)**: choose the scale (**1:25 000**, **1:50 000** or
**1:100 000**), the paper (Letter or A4), the orientation, and whether to draw **weapon ranges**. The
panel says how many sheets the COA needs and how much ground each covers (at 1:50 000 a Letter
landscape sheet is 12.9 × 7.3 km). Then **Print…**, or **Save (HTML)** to print elsewhere.

## Print at Actual size

Printed at any size but 100 %, an overlay does not fit the map. Every sheet has a **check bar that
must measure exactly 100 mm** (5 km at 1:50 000): measure it before using the sheet. In the print
dialog choose *Actual size* or *Scale 100 %*, not *Fit to page*. The overlay is laid out to fit the
printable area with room to spare, so a browser never needs to shrink it.

## What is on a sheet

- **The grid.** The overlay is drawn in **UTM**, in the grid zone of the COA's centre, as military
  maps are, so its 1 km grid is square and straight like the map's. A **cross at every 1 km grid
  crossing**, the grid numbers along all four edges (`23`, `06`), and the full reference of the cross
  nearest the bottom-left corner (`18S UJ 19 04`). Lay the crosses on the map's grid lines.
- **The COA.** Units as their MIL-STD-2525 symbols (9 mm wide at every scale) with their names and
  `(HVT)`; lines, areas, range rings and sectors in their colours (hostile dashed), with their names and
  the text above lines; weapon ranges when asked for.
- **The marking** at the top and bottom, the COA's name, the scale, the grid zone, the **version**
  (`docs/CHANGE-SHEETS.md`), the project and the DTG.
- **Sheets.** A COA larger than one sheet is tiled over several, each covering the next piece of
  ground with no overlap: *Sheet 2 of 4 (row 1 of 2 north to south, column 2 of 2 west to east)*.

## Limits

- A COA that crosses a grid zone boundary is drawn in the zone of its centre; paper maps near a zone
  edge carry the neighbouring zone's grid the same way. Grids there are the overlay's zone.
- Positions are WGS 84. Maps on another datum (older series) are offset by up to a few hundred metres;
  the grid crosses then do not lie exactly on the map's lines.
- Printers differ by a fraction of a millimetre; the check bar shows it.
