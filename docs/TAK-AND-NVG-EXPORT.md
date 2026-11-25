# TAK (Cursor-on-Target) and NVG export

What **Export → Data file → TAK** and **NVG** write (Epic 5 X-5, decision D40). Both are built from
the same features as the GeoJSON and KML exports (`docs/GEOJSON-EXPORT.md`), so they hold the same
units, lines, areas and weapon ranges. They are for other systems: COA Builder does not import them.

| | TAK (`.zip`) | NVG (`.nvg`) |
|---|---|---|
| What it is | A TAK **data package**: `MANIFEST/manifest.xml`, then one Cursor-on-Target event per item in `cot/` | One NATO Vector Graphics 2.0 XML document |
| For | ATAK, WinTAK, iTAK, TAK Server | C2 systems that exchange overlays in NVG |
| Units | Markers typed from the symbol code, with the full code in `__milsym` | `<point>` with `symbol="2525d:…"` or `"2525c:…"` |
| Lines | Drawings (`u-d-f`) | `<polyline>` |
| Areas, rings, sectors, weapon ranges | Closed drawings (`u-d-f`, first point repeated) | `<polygon>` |
| Classification marking | First in every event's remarks, and in the package name | In a comment at the top, and leading the outer group's label |

**Check the marking before you pass either file on.** TAK shows the remarks with each item; keep
the marking with anything you derive from them.

## TAK data package

Import it in ATAK with **Import → Local SD** (or send it from TAK Server); WinTAK and iTAK import
data packages the same way.

- **Stable uids.** Every event's uid is `coa-builder.<COA id>.<item id>` (weapon ranges
  `….<unit id>_weapon_<n>`), and the package uid is the same for the same COAs. **Sending a COA
  again updates its items in TAK** instead of adding copies.
- **Times.** `time` and `start` are the export time; `stale` is **7 days** later. Every event has
  `<archive/>` so TAK keeps it across restarts. These are planning graphics, not live tracks:
  `how` is `h-e` (entered by a person).
- **Position.** Lat/lon in WGS 84; height and errors unknown (`9999999.0`), as TAK expects.

### Units

`type` is `a-<affiliation>-<dimension>[-<function>]` from the symbol code:

| Symbol code | CoT type | Example |
|---|---|---|
| 2525C (15 characters) | affiliation, battle dimension and the **whole function id** | `SHGPUCI----D---` → `a-h-G-U-C-I` |
| 2525D/E (20 or 30 digits) | affiliation (standard identity), dimension (symbol set), and `U` unit / `E` equipment / `I` installation on land | `10061000001211000000` → `a-h-G-U` |

The full code also travels as `<__milsym id="…"/>`, so a TAK version that draws 2525D shows the
exact symbol; an older one shows the generic symbol for the type. Affiliations: `f` friend, `a`
assumed friend, `h` hostile, `s` suspect, `n` neutral, `u` unknown, `p` pending. Dimensions: `G`
ground, `A` air, `P` space, `S` sea surface, `U` subsurface, `X` other.

Each unit has `<contact callsign>` (its label, or its symbol code, with `[HVT]` after a high-value
target), `<track course>` when it has a direction of movement, and `<remarks>`:

```text
SECRET // COA: COA 1 | HVT | Higher: 1 MRB | Strength: 4 TELAR | Weapons: SA-15 (airDefence, 6000 m); Gun (direct, 2500 m, 60°) | Facing: 90°
```

### Lines and areas

`u-d-f` drawings with a `<link point="lat,lon"/>` per vertex, `<strokeColor>` and `<fillColor>` as
TAK's signed ARGB integers, `<strokeWeight>`, the label as `<contact callsign>` with
`<labels_on value="true"/>`, and remarks `MARKING | COA: … | <kind>`. Rings, sectors and weapon
ranges are written as their geodesic outlines.

## NVG 2.0

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- SECRET // Exercise IRON: COA 1 // exported 250800ZNOV26 by COA Builder 0.2.0 -->
<nvg xmlns="https://tide.act.nato.int/schemas/2012/10/nvg" version="2.0.2">
  <g label="SECRET // COA 1">
    <g label="COA 1">
      <g label="Units">
        <point x="-118" y="34" symbol="2525d:10061000001211000000" course="45" uri="u1" label="AD [HVT]"><ExtendedData>…</ExtendedData></point>
      </g>
      <g label="Lines and areas">
        <polyline points="-118,34 -117.9,34.1" uri="g1" label="PL GOLD" style="stroke:#1f6fd1;stroke-width:3;fill:none"><ExtendedData>…</ExtendedData></polyline>
      </g>
      <g label="Weapon ranges">…</g>
    </g>
  </g>
</nvg>
```

- Coordinates are WGS 84: `x` longitude, `y` latitude. Polygons are not closed in the file (NVG
  closes them).
- `uri` is the item's id; `label` its label (`[HVT]` after a high-value target). Every field is in
  `<ExtendedData>` as `<SimpleData key="…">`, the same names as GeoJSON (`sidc`, `hvt`,
  `weapon1_max_m`, …).
- Lines and areas carry no symbol code: a control measure's kind (`phaseLine`, `objective`, …) is
  in its ExtendedData. Tactical graphic codes may follow if a C2 system needs them.

**Validation.** The files are well-formed XML and follow the NVG 2.0 element and attribute names,
but they have **not been validated against the official NVG XSD** (not available here). Validate
against the schema your C2 system uses before relying on it, and say if anything needs changing.
