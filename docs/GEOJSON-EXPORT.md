# GeoJSON export — `coa-builder/geojson` version 2

What **Export → Data file → GeoJSON** writes: one RFC 7946 `FeatureCollection` (WGS 84,
`[longitude, latitude]`) for GIS tools (ArcGIS, QGIS, Google Earth via conversion, web maps). Every
shape is real geometry that a GIS draws as it is, and every field is a flat property that fits an
attribute table. COA Builder reads its own v2 files back exactly (**Import COAs…**).

```json
{
  "type": "FeatureCollection",
  "header": { "classification": "UNCLASSIFIED", "project": "Exercise IRON", "dtg": "242105ZNOV26",
              "application": "COA Builder 0.2.0", "format": "coa-builder/geojson", "formatVersion": 2, … },
  "features": [ … ]
}
```

`header` (a foreign member, RFC 7946 §6.1) carries the classification marking; see
`docs/DATA-DICTIONARY.md`. GIS tools ignore it; keep the marking with the data you derive.

## Layers

Each feature's `layer` property says what it is; filter or style on it.

### `unit` — a Point

| Property | Notes |
|---|---|
| `coa` | The COA's name |
| `sidc` | Symbol code: GIS military-symbology renderers key on this field |
| `label`, `higherFormation`, `additionalInformation`, `staffComments`, `dtg`, `quantity`, `direction` | When set |
| `facing` | Degrees true, when set |
| `hvt` | `true` or `false` |
| `strength`, `reference`, `notes` | Details, when set |
| `equipment` | `"SA-15 x4; Radar x1"` |
| `weapon1_name`, `weapon1_role`, `weapon1_max_m`, `weapon1_min_m`, `weapon1_arc_deg`, `weapon2_…` | One numbered set per weapon (ranges in metres, arc in degrees) |
| `template_link`, `off_template` | Only on a unit placed from a threat play |

### `graphic` — a LineString or Polygon

| Property | Notes |
|---|---|
| `coa`, `kind`, `side`, `label`, `color` | As in the import format |
| `centerLat`, `centerLng`, `radius` | Range rings and sectors: their exact parameters (the geometry is a 3°-step geodesic outline) |
| `minRadius`, `bearing`, `arc` | Sectors |

### `weapon` — a Polygon

A unit's weapon range, drawn from the unit (ring, or sector along its facing). For GIS only:
COA Builder skips these on import, since the unit carries its weapons.

| Property | Notes |
|---|---|
| `coa`, `unit_id`, `unit_label`, `unit_sidc`, `hvt` | The unit it belongs to |
| `weapon_name`, `role` | |
| `max_m`, `min_m`, `arc_deg`, `bearing_deg` | Metres and degrees |

## Styles

Every feature also has [simplestyle](https://github.com/mapbox/simplestyle-spec) properties that
many viewers draw directly: `stroke`, `stroke-width`, `stroke-opacity`, `fill`, `fill-opacity` and,
on units, `marker-color`. Colours follow the app: the side's colour (or the chosen colour) for
graphics, the weapon role's colour for ranges. They are ignored on import.

## The weapons CSV

**Export → Data file → Weapons (CSV)** writes one row per weapon per unit, keyed by `unit_id`, to
join to the units in a GIS:

```csv
# UNCLASSIFIED // Exercise IRON // exported 242105ZNOV26 // COA Builder 0.2.0 // coa-builder/weapons-csv v1
coa,unit_id,unit_label,sidc,hvt,lat,lng,facing_deg,weapon,role,max_m,min_m,arc_deg
SITTEMP,sym-…,AD Bty,10061000001211000000,true,34,-118,90,SA-15,airDefence,12000,,360
```

It is for reading only; units with their weapons are imported from JSON or GeoJSON.

## Version 1

Files written before Epic 5 (no `layer` property; rings as a Point with `radius`) still import.
