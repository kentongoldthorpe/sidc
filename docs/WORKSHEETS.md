# Worksheets

Printable forms for the analog part of the workflow (Epic 6 E6-2, decision D45;
`docs/ANALOG-DIGITAL-WORKFLOW.md`, rule 1: *think on any surface; record on a form*). Each worksheet
is laid out like the import columns, so typing a filled-in sheet into a spreadsheet is mechanical,
and the spreadsheet goes straight back into the app.

**Export → Worksheets (print)**: choose the worksheet (all three, or one), the paper (Letter or A4,
landscape), and the contents:

- **Pre-filled from this COA**: its units, lines and areas, with blank lines for additions, and its
  **version** (`docs/CHANGE-SHEETS.md`), so changes written on the sheet can be checked against it.
- **Blank**: COA and version left to fill in.

Then **Print…** (the browser's print dialog; *Save as PDF* works too), **Save (HTML)** to print on
another machine (one file, no scripts; opens in any browser), or **CSV template** to download the
spreadsheet(s) to type the sheets into.

## On every page

- The classification marking at the top and bottom (in its colour; printing keeps the colour).
- The worksheet's title and **Page n of m**.
- Project, COA, version and the DTG it was printed.
- One line of instructions.
- Under each column heading, in small type, the **CSV column** it is typed into.
- On the last page, the sign-off: filled in by, entered by, read back by (each with a DTG), and the
  count (*Printed with 16 units. Count now: ___*) for the read-back.

## The worksheets

| Worksheet | One row per | Columns (CSV column) |
|---|---|---|
| **Units** | unit | Name (`label`) · Unit template or symbol code (`template` / `sidc`) · Zone and square, Easting, Northing (together `mgrs`) · Facing ° (`facing`) · HVT (`hvt`: tick with X) · Higher formation (`higherFormation`) · Remarks (`staffComments`) |
| **Lines and areas** | line or area | Name (`label`) · Kind (`kind`, a short code) · Side (`side`: F, H, N, U) · Text above the line (`annotation`) · Points (`points`: grids in order, separated by `;`) · Radius m (`radius`, rings and sectors) |
| **Change sheet** | change | Name (`label`) · Action ☐ add ☐ change ☐ remove (`action`) · new grid (`mgrs`) · New name (`newLabel`) · Template or symbol, to add (`template` / `sidc`) · Other change (type into the app) · Initials · DTG |

**Kind codes:** PL phase line, BDY boundary, AXIS axis of advance, RTE route, LN line, OBJ objective,
AA assembly area, EA engagement area, AREA area, RING range ring, SECT sector. A ring or sector
takes one point, its centre, and a radius.

## Typing a sheet back in

1. **CSV template** gives one spreadsheet per worksheet: the marking line, the version line (when the
   sheet was pre-filled), and the header row. Open it in a spreadsheet and type one row per line of
   the sheet. The unit and line templates have a `coa` column: put the COA's name in it.
2. Write a grid as it is on the sheet, `18S UJ 2348 0648`; the kind and side as their codes; HVT as `X`.
3. A **unit template name** (`BMP-2 Coy`) can stand for the symbol code: the unit takes the template's
   symbol, weapons, HVT tag and details, and anything the row gives wins.
4. Then **Import COAs…** (a new COA) or **Update from file…** (the COA the sheet was printed from:
   it checks the version and previews every change). The units and the lines sheets can be imported
   as two files, or typed into one CSV: a row with a `kind` or `points` is a line or area.
5. Read back against the sheet (the units list shows each unit's 8-digit grid), fill in the sign-off,
   and keep the sheet with its marking.

Every problem is listed by row and column, and nothing is saved until there are none.
