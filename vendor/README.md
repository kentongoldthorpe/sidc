# Vendored libraries

These are copied verbatim from each library's published npm package (`dist/`), so the app
has no build step and no runtime network dependency. Do not edit them; to upgrade, replace the
files and update this table (the test suite checks the versions here match the bundles).

| Library | Version | Files | Source | License |
|---|---|---|---|---|
| Leaflet | 1.9.4 | `leaflet/leaflet.js`, `leaflet/leaflet.css`, `leaflet/images/*` | https://www.npmjs.com/package/leaflet (https://github.com/Leaflet/Leaflet) | BSD-2-Clause (`leaflet/LICENSE`) |
| milsymbol | 3.0.5 | `milsymbol/milsymbol.js` | https://www.npmjs.com/package/milsymbol (https://github.com/spatialillusions/milsymbol) | MIT (`milsymbol/LICENSE`) |

SHA-256 checksums:

```
db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a  leaflet/leaflet.js
a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6  leaflet/leaflet.css
bcd2e1be63e75935ca318037523e01379e07d0c0b5c22cb82465ccaef59f058c  milsymbol/milsymbol.js
```

`vendor/package.json` sets `"type": "commonjs"` so Node can `require()` these UMD bundles from
tests, while the project root is `"type": "module"`. In the browser they are loaded with classic
`<script>` tags and expose the globals `L` and `ms`, which only `src/main.js` reads.
