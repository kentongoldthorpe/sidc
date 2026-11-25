# Weather import and export — CSV files for forecasts and light data

COA Builder has no weather feed yet (decision D37). Weather comes in through two CSV files, or is
typed into the form in the **Weather** workspace. Both end up as the same `weather.import` message,
so a future feed can send that message instead.

| File | What it is |
|---|---|
| `docs/weather/examples/forecast.csv` | A forecast: one row per period, metric units |
| `docs/weather/examples/forecast-us-units.csv` | The same idea in °F, mph, statute miles and oktas, with military dates |
| `docs/weather/examples/light.csv` | Light data: one row per day |

Automated tests import every example, so this page and the app cannot drift apart.

## Periods

Each day has **two periods**, as in the IPB weather slice (D35):

| `period` | Means | Also accepted |
|---|---|---|
| `0000-1200` | Midnight to noon | `AM`, `1`, `0000`, `00-12` |
| `1200-2400` | Noon to midnight | `PM`, `2`, `1200`, `12-24`, `1200Z-2400Z` |

Times are in the forecast's time zone, Z (UTC) unless you set another on the forecast.

## Forecast file

The header row names the columns, in any order. `date` and `period` are required; every other
column is optional, and an empty cell means "no data" (the effects matrix shows **unknown** where a
critical value needs it). **Units are part of the column name**: give each value in one unit only.

| Column | Value | Notes |
|---|---|---|
| `date` | `2026-11-25` or `25NOV26` / `25 NOV 2026` | |
| `period` | see above | |
| `temp_max_c` / `temp_max_f` | maximum temperature | °F is converted to °C |
| `temp_min_c` / `temp_min_f` | minimum temperature | not above the maximum |
| `wind_kt` / `wind_mph` / `wind_kmh` | sustained wind | converted to knots |
| `gust_kt` / `gust_mph` / `gust_kmh` | gusts | not below the wind speed |
| `wind_dir` | direction the wind comes from, degrees true | 0 to <360 |
| `vis_km` / `vis_m` / `vis_sm` | visibility | statute miles and metres are converted to km |
| `ceiling_ft` / `ceiling_m` | lowest broken or overcast layer | `UNL` (or `CLR`, `SKC`, `none`) means no ceiling |
| `cloud_pct` / `cloud_oktas` | total cloud cover | oktas × 12.5 = % |
| `precip` | `none`, `drizzle`, `rain`, `snow`, `sleet`, `freezing rain`, `hail`, `thunderstorm` | `showers` counts as rain; `TS`/`TSRA` as thunderstorm; `FZRA` as freezing rain |
| `precip_mm` / `precip_in` | amount in the period | inches are converted to mm |
| `humidity_pct` | relative humidity | |
| `notes` | free text, at most 200 characters | |

```csv
date,period,temp_max_c,temp_min_c,wind_kt,gust_kt,wind_dir,vis_km,ceiling_ft,cloud_pct,precip,precip_mm,humidity_pct,notes
2026-11-25,0000-1200,9,2,8,12,270,10,UNL,20,none,0,70,
2026-11-25,1200-2400,13,6,18,28,250,6,2500,60,rain,4,85,Front arrives late afternoon
```

## Light-data file

One row per day. Times are `HHMM` (`0629`) or `HH:MM` (`06:29`); leave a cell empty (or `--`) when
there is no event that day (for example no moonrise).

| Column | Value |
|---|---|
| `date` | as above |
| `bmnt` | begin morning nautical twilight |
| `sunrise`, `sunset` | |
| `eent` | end evening nautical twilight |
| `moonrise`, `moonset` | |
| `illum_pct` | moon illumination, 0 to 100 (used for night-vision critical values) |

```csv
date,bmnt,sunrise,sunset,eent,moonrise,moonset,illum_pct
2026-11-25,0601,0629,1648,1716,1302,0012,38
```

## How importing works

- Choose the forecast, then **Import CSV…**. The app tells the two kinds of file apart by their
  columns.
- **Merge** (the default) adds the file's periods and days, replacing any already there for the
  same date and period. **Replace** starts the forecast again from the file.
- **All or nothing.** If anything is wrong, nothing is imported and every problem is listed by row
  and column, for example `row 5, column wind_mph: must be a number from 0 to 250 kt`.
- Lines starting with `#` before the header row are comments (the app's own exports put the
  classification marking there).
- Standard CSV quoting (RFC 4180); a UTF-8 byte-order mark is allowed. Spreadsheet formula guards
  (a leading apostrophe) are removed.

## Exporting

Choose the forecast, then one of the **Export** buttons (Epic 5 X-4). Every file starts with the
export header: the classification marking, project, time and DTG, application and format (CSV: a
first line starting with `#`, which the importer skips as a comment).

| Button | File | Notes |
|---|---|---|
| **Slide (PNG)** | the weather brief slide: effects matrix, forecast and light data, three days per slide | With the classification banners and the project's slide shape; more days make more slides |
| **Forecast CSV** | the forecast file above, metric columns | Imports again unchanged: no ceiling is written `UNL` |
| **Light data CSV** | the light-data file above | Imports again unchanged |
| **Effects matrix CSV** | one row per operation or system, one column per period | `G`, `A`, `R` or `?` (unknown), then a `reasons` column |
| **All as JSON** | `coa-builder/weather` version 1: `{ format, version, header, forecast, criteria, matrix }` | The forecast with its critical values and the matrix they give; fields as in `docs/DATA-DICTIONARY.md` |

```csv
# UNCLASSIFIED // Default // exported 250800ZNOV26 // COA Builder 0.2.0 // coa-builder/weather-csv v1
operation_or_system,group,example,2026-11-25 0000-1200,2026-11-25 1200-2400,reasons
Rotary wing,Aviation,false,G,R,2026-11-25 1200-2400: Wind 42 kt ≥ 40 kt
```

The same JSON document is the `weather.export` query `{ forecastId }`, for a tool that talks to the
app's messages rather than files.

## Critical values and the effects matrix

The effects matrix rates each operation or system **green**, **amber** or **red** in each period by
comparing the forecast with its critical values; the worst value decides, and the reasons are
shown. A rule is **at or below** its value for visibility, ceiling, minimum temperature and
illumination, and **at or above** it for the others. Missing data shows as **unknown**.

The **starter set** (Add example values) is there to show how the matrix works. Its numbers are
**examples, not doctrine**: check each against your unit's references and the systems you actually
have, then edit them. An edited example is no longer marked as one.
