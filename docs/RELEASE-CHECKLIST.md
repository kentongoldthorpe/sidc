# Release checklist

Do these in order. Tick each line; stop and fix anything that fails.

## 1. Version

- [ ] Bump `version` in `package.json` and `VERSION` in `src/shared/version.js` (a test checks they match).
- [ ] Add a section to `CHANGELOG.md`: what changed, in user terms.

## 2. Automated tests

- [ ] `npm test`: Node tests (core, adapters, architecture, docs, CSP, contrast, release package). Must show `fail 0`.
- [ ] On a machine with PowerShell 7 (`pwsh`): `npm test` again. This also runs the `serve.ps1` and file-API tests, which are skipped without PowerShell.
- [ ] `npm run test:browser`: the browser specs, headless (needs Playwright). Without Playwright: start a server and open `/tests/browser/` in a browser. Must show `fail 0`, with no CSP violations.

## 3. Smoke test by hand (10 minutes)

Start the app with `serve.ps1` (or `serve.cmd`) and open it.

- [ ] The header says files are saved in the data folder.
- [ ] Create a COA. Add a unit from the presets and one by typed SIDC. Drag one, then Ctrl+Z and Ctrl+Shift+Z.
- [ ] Draw a phase line (double-click to finish), an objective, and a range ring with a typed radius. Drag a point; right-click a point.
- [ ] Set the shared frame, then Export PNG. Open the PNG: banners, title, DTG, legend, units and lines are all there.
- [ ] Export → Data file → JSON, Download this COA. Import COAs… with that file: a copy appears.
- [ ] Import `docs/import/examples/two-coas-full.json` and `units.csv`.
- [ ] Open a second tab. A change in one shows in the other ("Updated from another window").
- [ ] Stop `serve.ps1` and change something: the banner says it was not saved. Back up all COAs. Start it again: the banner says saving works.
- [ ] Delete a COA, then Undo in the COA list.
- [ ] Dark mode (OS setting) and a narrow window (under 720 px): the panel is readable and Pick on map / Draw step aside.

## 4. Package

- [ ] `npm run package` → `dist/coa-builder-<version>.zip`.
- [ ] Unzip it on the target machine (or a clean folder) and run `serve.cmd`. The title's tooltip shows the version and build time.
- [ ] Commit, tag `v<version>`, and keep the zip with the release notes.
