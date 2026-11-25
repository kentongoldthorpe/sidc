// Epic 5 X-3: KML from exchange features, and the ZIP writer KMZ files use.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coaFeatures } from '../../src/adapters/exchange/features.js';
import { writeKml, kmlColor, xml } from '../../src/adapters/exchange/kml.js';
import { writeZip, crc32 } from '../../src/adapters/exchange/zip.js';

const HEADER = { classification: 'SECRET//NOFORN', classificationColor: '#c8102e', project: 'Exercise <IRON>', exportedAt: '2026-11-25T08:00:00.000Z', dtg: '250800ZNOV26', application: 'COA Builder 0.2.0', format: 'kml', formatVersion: 1 };
const COA = {
  id: 'c1', name: 'COA 1 & 2', symbols: [
    { id: 'u1', sidc: '10061000001211000000', position: { lat: 34, lng: -118 }, label: 'AD <Bty>', modifiers: {}, hvt: true, facing: 90, weapons: [{ name: 'SA-15', role: 'airDefence', maxRange: 6000, arc: 360 }] },
  ],
  graphics: [
    { id: 'g1', kind: 'phaseLine', side: 'friendly', label: 'PL GOLD', points: [{ lat: 34, lng: -118 }, { lat: 34.1, lng: -117.9 }] },
    { id: 'g2', kind: 'sector', side: 'hostile', label: 'Fires', center: { lat: 34, lng: -118 }, radius: 3000, minRadius: 500, bearing: 45, arc: 90 },
  ],
};

describe('writeKml', () => {
  const kml = writeKml(coaFeatures([COA]), { header: HEADER, title: 'COAs' });

  it('is a KML 2.2 document whose name and description carry the classification marking', () => {
    assert.match(kml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<kml xmlns="http:\/\/www.opengis.net\/kml\/2.2"><Document>/);
    assert.match(kml, /<name>SECRET\/\/NOFORN \/\/ Exercise &lt;IRON&gt; \/\/ COAs<\/name>/);
    assert.match(kml, /<Snippet maxLines="1">SECRET\/\/NOFORN<\/Snippet>/);
    assert.match(kml, /<Data name="classification"><value>SECRET\/\/NOFORN<\/value><\/Data>/);
  });

  it('has a folder per COA with units, lines and areas, and weapon ranges', () => {
    assert.match(kml, /<Folder><name>COA 1 &amp; 2<\/name><Folder><name>Units<\/name>.*<Folder><name>Lines and areas<\/name>.*<Folder><name>Weapon ranges<\/name>/);
  });

  it('writes units as points named by label with HVT marked, every field in ExtendedData, and text escaped', () => {
    assert.match(kml, /<Placemark id="u1"><name>AD &lt;Bty&gt; \[HVT\]<\/name>/);
    assert.match(kml, /<Data name="sidc"><value>10061000001211000000<\/value><\/Data>/);
    assert.match(kml, /<Data name="weapon1_max_m"><value>6000<\/value><\/Data>/);
    assert.match(kml, /<Point><coordinates>-118,34,0<\/coordinates><\/Point>/);
    assert.doesNotMatch(kml, /<Data name="stroke"/, 'style properties are not data');
  });

  it('writes lines (tessellated) and polygons, styled with KML colours', () => {
    assert.match(kml, /<LineString><tessellate>1<\/tessellate><coordinates>-118,34,0 -117.9,34.1,0<\/coordinates><\/LineString>/);
    assert.equal((kml.match(/<Polygon>/g) ?? []).length, 2, 'the sector and the weapon range');
    assert.match(kml, /<LineStyle><color>ff1b02d0<\/color>/, 'hostile red as aabbggrr');
    assert.match(kml, /<LineStyle><color>e6a03f7b<\/color>/, 'air-defence purple');
  });

  it('uses the unit\'s symbol icon when one is given (KMZ)', () => {
    const withIcons = writeKml(coaFeatures([COA]), { header: HEADER, iconFor: (sidc) => `icons/${sidc}.png` });
    assert.match(withIcons, /<Icon><href>icons\/10061000001211000000.png<\/href><\/Icon>/);
  });

  it('kmlColor and xml', () => {
    assert.equal(kmlColor('#c8102e', 0.5), '802e10c8');
    assert.equal(xml('a & <b> "c"'), 'a &amp; &lt;b&gt; &quot;c&quot;');
  });

  it('is well-formed XML (checked with Python when it is installed)', (t) => {
    const py = spawnSync('python3', ['-c', 'import sys, xml.dom.minidom; xml.dom.minidom.parseString(sys.stdin.read().encode()); print("ok")'], { input: kml, encoding: 'utf8' });
    if (py.error) { t.skip('python3 not found'); return; }
    assert.equal(py.stdout.trim(), 'ok', py.stderr);
  });
});

describe('writeZip', () => {
  it('computes CRC-32', () => assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926));

  it('writes an archive other tools can read (checked with Python when it is installed)', (t) => {
    const zip = writeZip([{ name: 'doc.kml', data: '<kml/>' }, { name: 'icons/ä.png', data: new Uint8Array([1, 2, 3]) }]);
    const dir = mkdtempSync(join(tmpdir(), 'kmz-'));
    try {
      writeFileSync(join(dir, 'a.kmz'), zip);
      const py = spawnSync('python3', ['-c', 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(",".join(z.namelist())); print(z.read("doc.kml").decode())', join(dir, 'a.kmz')], { encoding: 'utf8' });
      if (py.error) { t.skip('python3 not found'); return; }
      assert.equal(py.stdout, 'doc.kml,icons/ä.png\n<kml/>\n', py.stderr);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
