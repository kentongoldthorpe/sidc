// Plain COA documents for driven-port contract tests (no domain code involved).
export const aCoa = ({
  id = 'coa-1', name = 'COA 1', description = '', revision = 1,
  createdAt = '2026-11-22T20:40:00.000Z', updatedAt = createdAt, symbols = [],
} = {}) => ({ id, name, description, createdAt, updatedAt, revision, symbols });

export const aSymbol = ({ id = 'sym-1', sidc = '10031000001211000000', lat = 34.05, lng = -117.6, label = 'A/1-5' } = {}) =>
  ({ id, sidc, position: { lat, lng }, label, modifiers: {} });
