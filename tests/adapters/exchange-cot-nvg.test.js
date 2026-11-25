// Epic 5 X-5: Cursor-on-Target (a TAK data package) and NATO Vector Graphics 2.0.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cotType, takColor, cotEvents, buildTakPackage } from '../../src/adapters/exchange/cot.js';
import { writeNvg, nvgSymbol } from '../../src/adapters/exchange/nvg.js';
import { coaFeatures } from '../../src/adapters/exchange/features.js';

const HEADER = { classification: 'SECRET//NOFORN', classificationColor: '#c8102e', project: 'Exercise <IRON>', exportedAt: '2026-11-25T08:00:00.000Z', dtg: '250800ZNOV26', application: 'COA Builder 0.2.0', format: 'cot-data-package', formatVersion: 1 };
const COA = {
  id: 'c1', name: 'COA 1 & 2', symbols: [
    { id: 'u1', sidc: '10061000001211000000', position: { lat: 34, lng: -118 }, label: 'AD <Bty>', modifiers: { direction: 45, higherFormation: '1 MRB' }, hvt: true, facing: 90,
      weapons: [{ name: 'SA-15', role: 'airDefence', maxRange: 6000, arc: 360 }, { name: 'Gun', role: 'direct', maxRange: 2500, arc: 60 }], details: { strength: '4 TELAR' } },
    { id: 'u2', sidc: 'SFGPUCI----D---', position: { lat: 34.05, lng: -117.95 }, label: '', modifiers: {} },
  ],
  graphics: [
    { id: 'g1', kind: 'phaseLine', side: 'friendly', label: 'PL GOLD', points: [{ lat: 34, lng: -118 }, { lat: 34.1, lng: -117.9 }] },
    { id: 'g2', kind: 'objective', side: 'friendly', label: 'OBJ -- X', points: [{ lat: 34, lng: -118 }, { lat: 34.1, lng: -118 }, { lat: 34.1, lng: -117.9 }] },
  ],
};
const parses = (t, text) => {
  const py = spawnSync('python3', ['-c', 'import sys, xml.dom.minidom; xml.dom.minidom.parseString(sys.stdin.read().encode()); print("ok")'], { input: text, encoding: 'utf8' });
  if (py.error) { t.skip('python3 not found'); return; }
  assert.equal(py.stdout.trim(), 'ok', py.stderr);
};

describe('cotType: 2525 symbol codes as CoT types', () => {
  it('takes the whole function from a 2525C code', () => {
    assert.equal(cotType('SHGPUCI----D---'), 'a-h-G-U-C-I');
    assert.equal(cotType('sfgpucaa---'.padEnd(15, '-')), 'a-f-G-U-C-A-A');
    assert.equal(cotType('SNAPMF---------'), 'a-n-A-M-F');
    assert.equal(cotType('SUSP-----------'), 'a-u-S');
  });
  it('takes affiliation, dimension and unit / equipment / installation from a 2525D/E code', () => {
    assert.equal(cotType('10061000001211000000'), 'a-h-G-U');
    assert.equal(cotType('10031500001101000000'), 'a-f-G-E');
    assert.equal(cotType('10032000001201000000'), 'a-f-G-I');
    assert.equal(cotType('10040100001101000000'), 'a-n-A');
    assert.equal(cotType('10053000001201000000'), 'a-s-S');
    assert.equal(cotType('10013500001101000000'), 'a-u-U');
    assert.equal(cotType('100610000012110000000000000000'), 'a-h-G-U');
  });
  it('falls back to an unknown ground track', () => assert.equal(cotType('nonsense'), 'a-u-G'));
});

describe('takColor', () => {
  it('is the signed ARGB integer TAK writes', () => {
    assert.equal(takColor('#ff0000'), -65536);
    assert.equal(takColor('#0000ff', 0), 255);
    assert.equal(takColor('#ffffff', 1), -1);
  });
});

describe('cotEvents', () => {
  const events = cotEvents([COA], { header: HEADER });
  const byUid = Object.fromEntries(events.map((e) => [e.uid, e.xml]));

  it('writes one event per unit, line, area and weapon range, with stable uids', () => {
    assert.deepEqual(events.map((e) => e.uid), ['coa-builder.c1.u1', 'coa-builder.c1.u2', 'coa-builder.c1.g1', 'coa-builder.c1.g2', 'coa-builder.c1.u1_weapon_0', 'coa-builder.c1.u1_weapon_1']);
  });

  it('writes units as markers: type, position, callsign with HVT, the 2525 code, course and remarks starting with the marking', (t) => {
    const u = byUid['coa-builder.c1.u1'];
    assert.match(u, /<event version="2.0" uid="coa-builder.c1.u1" type="a-h-G-U" how="h-e" time="2026-11-25T08:00:00.000Z" start="2026-11-25T08:00:00.000Z" stale="2026-12-02T08:00:00.000Z">/);
    assert.match(u, /<point lat="34" lon="-118" hae="9999999.0" ce="9999999.0" le="9999999.0"\/>/);
    assert.match(u, /<contact callsign="AD &lt;Bty&gt; \[HVT\]"\/><__milsym id="10061000001211000000"\/><track course="45" speed="0.0"\/>/);
    assert.match(u, /<remarks>SECRET\/\/NOFORN \| COA: COA 1 &amp; 2 \| HVT \| Higher: 1 MRB \| Strength: 4 TELAR \| Weapons: SA-15 \(airDefence, 6000 m\); Gun \(direct, 2500 m, 60°\) \| Facing: 90°<\/remarks>/);
    assert.match(u, /<archive\/><\/detail><\/event>\n$/);
    assert.match(byUid['coa-builder.c1.u2'], /type="a-f-G-U-C-I"[\s\S]*<contact callsign="SFGPUCI----D---"\/>/);
    for (const e of events) parses(t, e.xml);
  });

  it('writes lines as open drawings and areas as closed ones, coloured, labelled and marked', () => {
    const line = byUid['coa-builder.c1.g1'];
    assert.match(line, /type="u-d-f"/);
    assert.match(line, /<link point="34,-118"\/><link point="34.1,-117.9"\/><strokeColor value="-\d+"\/><strokeWeight value="3.0"\/><contact callsign="PL GOLD"\/><labels_on value="true"\/>/);
    assert.doesNotMatch(line, /fillColor/);
    const area = byUid['coa-builder.c1.g2'];
    const links = [...area.matchAll(/<link point="([^"]+)"\/>/g)].map((m) => m[1]);
    assert.equal(links.length, 4);
    assert.equal(links[0], links[3], 'closed: the first point repeated');
    assert.match(area, /<fillColor value="-?\d+"\/>/);
    assert.match(area, /<remarks>SECRET\/\/NOFORN \| COA: COA 1 &amp; 2 \| objective<\/remarks>/);
    assert.match(byUid['coa-builder.c1.u1_weapon_1'], /<contact callsign="Gun \(AD &lt;Bty&gt;\)"\/>[\s\S]*weapon range, direct/);
  });

  it('can be given another stale time', () => {
    assert.match(cotEvents([COA], { header: HEADER, staleHours: 2 })[0].xml, /stale="2026-11-25T10:00:00.000Z"/);
  });
});

describe('buildTakPackage', () => {
  it('is a zip with MANIFEST/manifest.xml listing every .cot file, the marking in its name, and a uid stable for the same COAs', (t) => {
    const bytes = buildTakPackage({ coas: [COA], header: HEADER, title: 'COA 1' });
    assert.deepEqual(buildTakPackage({ coas: [COA], header: HEADER, title: 'COA 1' }), bytes);
    const dir = mkdtempSync(join(tmpdir(), 'tak-'));
    try {
      writeFileSync(join(dir, 'p.zip'), bytes);
      const py = spawnSync('python3', ['-c', `
import sys, zipfile, xml.dom.minidom as m
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
names = z.namelist(); print(",".join(names))
man = m.parseString(z.read("MANIFEST/manifest.xml"))
entries = [c.getAttribute("zipEntry") for c in man.getElementsByTagName("Content")]
assert entries == names[1:], (entries, names)
for n in names[1:]: m.parseString(z.read(n))
print([p.getAttribute("value") for p in man.getElementsByTagName("Parameter")][:2])`, join(dir, 'p.zip')], { encoding: 'utf8' });
      if (py.error) { t.skip('python3 not found'); return; }
      assert.equal(py.status, 0, py.stderr);
      const [names, params] = py.stdout.trim().split('\n');
      assert.equal(names.split(',')[0], 'MANIFEST/manifest.xml');
      assert.equal(names.split(',').length, 7);
      assert.match(params, /'coa-builder-[0-9a-f]{8}', 'COA 1 \(SECRET\/\/NOFORN\)'/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('writeNvg', () => {
  const nvg = writeNvg(coaFeatures([COA]), { header: HEADER, title: 'COA 1 & 2' });

  it('is an NVG 2.0 document with the marking in a comment and leading the outer group', (t) => {
    assert.match(nvg, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<!-- SECRET\/\/NOFORN \/\/ Exercise <IRON>: COA 1 & 2 \/\/ exported 250800ZNOV26 by COA Builder 0.2.0 -->\n<nvg xmlns="https:\/\/tide.act.nato.int\/schemas\/2012\/10\/nvg" version="2.0.2">/);
    assert.match(nvg, /<g label="SECRET\/\/NOFORN \/\/ COA 1 &amp; 2">\s*<g label="COA 1 &amp; 2">\s*<g label="Units">/);
    parses(t, nvg);
  });

  it('writes units as points with their symbol code, label, course and every field', () => {
    assert.equal(nvgSymbol('10061000001211000000'), '2525d:10061000001211000000');
    assert.equal(nvgSymbol('sfgpuci----d---'), '2525c:SFGPUCI----D---');
    assert.match(nvg, /<point x="-118" y="34" symbol="2525d:10061000001211000000" course="45" uri="u1" label="AD &lt;Bty&gt; \[HVT\]"><ExtendedData>.*<SimpleData key="hvt">true<\/SimpleData>.*<SimpleData key="weapon2_arc_deg">60<\/SimpleData>.*<\/ExtendedData><\/point>/);
    assert.doesNotMatch(nvg, /key="stroke"/);
  });

  it('writes lines as polylines and areas and ranges as polygons, styled, without repeating the first point', () => {
    assert.match(nvg, /<polyline points="-118,34 -117.9,34.1" uri="g1" label="PL GOLD" style="stroke:#[0-9a-f]{6};stroke-width:3;fill:none">/i);
    assert.match(nvg, /<polygon points="-118,34 -118,34.1 -117.9,34.1" uri="g2" label="OBJ -- X" style="stroke:#[0-9a-f]{6};stroke-width:3;fill:#[0-9a-f]{6};fill-opacity:0.12">/i);
    assert.match(nvg, /<g label="Weapon ranges">\s*<polygon [^>]*label="SA-15 \(AD &lt;Bty&gt;\)"/);
  });

  it('keeps a comment well formed whatever the title holds', (t) => {
    const odd = writeNvg([], { header: { ...HEADER, classification: 'A--B-' }, title: 'x---y' });
    assert.match(odd, /<!-- A- -B-\s+\/\/ Exercise <IRON>: x- - -y/);
    parses(t, odd);
  });
});
