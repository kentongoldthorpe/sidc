// Builds common 2525D land-unit SIDCs from a few choices, and reads them back.
//   10 0 <affiliation> 10 0 <hq> <echelon> <entity:6> 0000
// Each unit type below was checked against milsymbol (valid, and the expected icon).

export const AFFILIATIONS = Object.freeze([['3', 'Friendly'], ['6', 'Hostile'], ['4', 'Neutral'], ['1', 'Unknown']]);

export const UNIT_TYPES = Object.freeze([
  ['121100', 'Infantry'], ['121102', 'Mechanized infantry'], ['120500', 'Armor'], ['121300', 'Reconnaissance'],
  ['130300', 'Field artillery'], ['130100', 'Air defense'], ['120400', 'Anti-tank'], ['140700', 'Engineer'],
  ['120100', 'Aviation'], ['111000', 'Signal'], ['161300', 'Medical'], ['163400', 'Supply'],
]);

export const ECHELONS = Object.freeze([
  ['00', 'None'], ['11', 'Team / crew'], ['12', 'Squad'], ['13', 'Section'], ['14', 'Platoon'], ['15', 'Company'],
  ['16', 'Battalion'], ['17', 'Regiment / group'], ['18', 'Brigade'], ['21', 'Division'], ['22', 'Corps'], ['23', 'Army'],
]);

const has = (list, code) => list.some(([c]) => c === code);

/** @param {{ affiliation: string, unitType: string, echelon: string, hq: boolean }} parts */
export const composeSidc = ({ affiliation, unitType, echelon, hq }) => `100${affiliation}100${hq ? '2' : '0'}${echelon}${unitType}0000`;

/** The builder parts for a SIDC it could have built, else null (a custom SIDC). */
export function readSidc(sidc) {
  const m = /^100([1346])100([02])(\d\d)(\d{6})0000$/.exec(String(sidc).trim());
  if (!m) return null;
  const [, affiliation, hqDigit, echelon, unitType] = m;
  if (!has(UNIT_TYPES, unitType) || !has(ECHELONS, echelon)) return null;
  return { affiliation, unitType, echelon, hq: hqDigit === '2' };
}
