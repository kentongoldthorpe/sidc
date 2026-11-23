// Plain COA documents for driven-port contract tests (no domain code involved).
export const aCoa = ({
  id = 'coa-1', name = 'COA 1', description = '', revision = 1,
  createdAt = '2026-11-22T20:40:00.000Z', updatedAt = createdAt, symbols = [], graphics = [],
} = {}) => ({ id, name, description, createdAt, updatedAt, revision, symbols, graphics });

export const aSymbol = ({ id = 'sym-1', sidc = '10031000001211000000', lat = 34.05, lng = -117.6, label = 'A/1-5' } = {}) =>
  ({ id, sidc, position: { lat, lng }, label, modifiers: {} });

/** One of each graphic shape: a phase line with a colour override, an area, a range ring. */
export const someGraphics = () => [
  { id: 'gfx-1', kind: 'phaseLine', side: 'friendly', label: 'PL GOLD', color: '#112233', points: [{ lat: 34, lng: -118 }, { lat: 34.2, lng: -117.8 }] },
  { id: 'gfx-2', kind: 'objective', side: 'hostile', label: 'OBJ IRON', points: [{ lat: 34, lng: -118 }, { lat: 34.1, lng: -118 }, { lat: 34.1, lng: -117.9 }] },
  { id: 'gfx-3', kind: 'rangeRing', side: 'friendly', label: '', center: { lat: 34, lng: -118 }, radius: 15000 },
];
