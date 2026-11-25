# Versions and updating a COA from a file

How a COA goes back and forth between paper and the app without being re-entered, and without
copies drifting apart (Epic 6 E6-3, decision D44; the workflow is in
`docs/ANALOG-DIGITAL-WORKFLOW.md`).

## The version fingerprint

Every COA has a **version fingerprint**, a short code such as `K7Q3-MD2A`, computed from its
content: its name, description, units and lines (not the order they are listed in, and not
internal ids). The same content always gives the same code; any change, even a 1 m move, gives a
new one.

It is shown under the COA list (**Version K7Q3-MD2A**), beside the DTG on every slide, and in every
exported file: in the header's `versions` list (JSON, GeoJSON, KML) or as a line under the marking
in a CSV:

```csv
# UNCLASSIFIED // Exercise IRON // exported 251400ZNOV26 // COA Builder 0.2.0 // csv v1
# version COA 1 - Envelopment: K7Q3-MD2A
coa,sidc,lat,lng,mgrs,label,…
```

**Write it on every paper copy.** A change sheet names the version it changes, so the app can tell
whether the COA has changed since the paper was printed. Typed from paper, `O` is read as `0`, `I`
and `L` as `1`, and case, spaces and the hyphen do not matter (the code never uses I, L, O or U).

## Update from file…

Under the COA list, **Update from file…** reads a file into the selected COA:

- a **change sheet** (below): only the rows that change;
- an **edited export**: a CSV, GeoJSON or JSON file the app wrote, changed in a spreadsheet or GIS.

Before anything is saved, a preview lists every change: what is added, what is removed, and what
changes, with grids before and after and how far each unit moves. **A move of 5 km or more is
flagged ⚠**: it is usually a transposed grid digit. Items that would not change are counted, not
listed.

Then:

- **Made from version**: filled from the file when it says, or type the version written on the
  sheet. If it matches the COA's version now, the preview says so (✓). If the COA has changed since,
  the preview says so plainly, and **Apply** needs a tick: *I have checked every change against the
  COA as it is now*.
- **How**: *Change only what the file lists* (the usual), or *Match the file*, which
  also removes named items of a kind the file holds that it does not list. A CSV holds units only,
  so it never removes lines. Items without a name are never removed: they cannot be matched.
- **Entered by** and **Read back by** (optional) are recorded with the update.
- **Apply** saves the changes as one new revision. **Undo** puts the COA back.

Every update is recorded on the COA (`transfers`, up to the last 50): when, from which file, the
version it was made from, the version before and after, how many items were added, changed and
removed, and who entered and read it back. The latest is shown under the version.

## How items are matched

By **name**: a unit's label, a line's or area's label, ignoring upper and lower case. So:

- Give every item a name before printing (rule 3 of the workflow), and keep names unique within a
  COA: if two units share a name, a sheet naming it is refused until they are renamed.
- An item in the file with no name is added as a new item.
- Only the fields a row gives are changed. An empty cell, or a field left out, leaves that field as
  it is. To change a modifier, give it; to clear one, change it in the app.

## Change sheets

A change sheet is a CSV with an `action` column. Only `label` (the item's name) is required; give
the other columns a row needs.

```csv
# version: K7Q3-MD2A
label,action,mgrs,sidc,newLabel
2 MRC,change,18S UJ 2420 0710,,
1 MRC,remove,,,
Recon,add,18S UJ 2380 0700,10031000001205000000,
AD,change,,,AD Bty
```

| Column | Required | Meaning |
|---|---|---|
| `label` | yes | The item's name, as written on the paper |
| `action` | yes (the column); a cell may be empty | `add`, `change` or `remove`; empty: add if the name is new, else change |
| `mgrs` or `lat` and `lng` | to move, or to add | The new position. Both may be given, and must agree |
| `sidc` | to add | The symbol |
| `newLabel` | no | A new name (a rename) |
| any unit field | no | `higherFormation`, `staffComments`, `direction`, `facing`, `hvt`, … as in `docs/IMPORT-FORMAT.md` |
| `coa` | no | Ignored: the sheet is for the COA being updated |

`# version: K7Q3-MD2A` (or `# version <COA name>: K7Q3-MD2A`) before the header row states the
version the sheet was made from. Without it, type the version in the preview.

**Lines and areas** are changed from a GeoJSON or JSON file (the import format, with `action` and
`newLabel` on any graphic). A change sheet CSV holds units only.

**Every problem is listed** by row and column (for example `row 3, column mgrs: needs the same
number of digits…` or `row 2, column label: "Ghost" is not in the COA`), and nothing is saved
until the file has none.

## For other systems

The same is two messages (`docs/ARCHITECTURE.md`): `coa.diff` returns the preview; and
`coa.update-from-file` applies it, refusing with `VERSION_MISMATCH` when the file was made from
another version unless `acceptVersionMismatch` is true. `export.header` with `coaIds` gives the
versions to write into a file.
