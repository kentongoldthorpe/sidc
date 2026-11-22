// SymbolRenderer adapter over milsymbol (Spatial Illusions). The library is injected:
// main.js passes the browser global `ms`; tests pass the vendored bundle loaded in Node.

/** milsymbol option names for our label and modifiers. */
const OPTION_NAMES = Object.freeze({
  label: 'uniqueDesignation',
  higherFormation: 'higherFormation',
  additionalInformation: 'additionalInformation',
  staffComments: 'staffComments',
  dtg: 'dtg',
  quantity: 'quantity',
  direction: 'direction',
});

/** Turns milsymbol's isValid(true) report into readable warnings. */
function warningsFrom(report) {
  const warnings = [];
  if (!report.affiliation || report.affiliation === 'undefined') warnings.push('Affiliation (standard identity) not recognised');
  if (report.dimension === '') warnings.push('Symbol set / battle dimension not recognised');
  if (report.icon === false) warnings.push('Symbol icon (entity) not recognised');
  if (report.mobility === false) warnings.push('Mobility indicator not recognised');
  if (report.drawInstructions === false) warnings.push('Symbol could not be drawn');
  return warnings;
}

const round = (n) => Math.round(n * 100) / 100;

/** @implements {import('../../application/ports/symbol-renderer.js').SymbolRenderer} */
export class MilsymbolRenderer {
  #ms;

  constructor(ms) {
    if (typeof ms?.Symbol !== 'function') throw new TypeError('MilsymbolRenderer: the milsymbol library (ms) is required');
    this.#ms = ms;
  }

  render(sidc, { label = '', modifiers = {}, size = 40 } = {}) {
    const options = { size };
    for (const [key, value] of Object.entries({ label, ...modifiers })) {
      if (key in OPTION_NAMES && value !== '') options[OPTION_NAMES[key]] = value;
    }
    const symbol = new this.#ms.Symbol(String(sidc), options);
    const warnings = warningsFrom(symbol.isValid(true));
    // milsymbol accepts an unknown symbol set as "valid" but draws a dot; we do not.
    const valid = symbol.isValid() === true && warnings.length === 0;
    const { width, height } = symbol.getSize();
    const anchor = symbol.getAnchor();
    return {
      svg: symbol.asSVG(),
      valid,
      warnings: valid ? [] : (warnings.length ? warnings : ['Symbol not recognised']),
      anchor: { x: round(anchor.x), y: round(anchor.y) },
      width: round(width),
      height: round(height),
    };
  }
}
