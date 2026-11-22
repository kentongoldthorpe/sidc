// Driven port: SymbolRenderer. Turns a SIDC (+ label and modifiers) into SVG and says whether
// the SIDC names a symbol the renderer knows. Synchronous and side-effect free.
/**
 * @typedef {Object} RenderedSymbol
 * @property {string} svg              starts with "<svg"
 * @property {boolean} valid           false if any part of the SIDC is unrecognised
 * @property {string[]} warnings       human-readable reasons when not valid ([] when valid)
 * @property {{x:number, y:number}} anchor  the point to pin to the map position, in SVG pixels
 * @property {number} width
 * @property {number} height
 *
 * @typedef {Object} SymbolRenderer
 * @property {(sidc: string, options: { label?: string, modifiers?: Object, size?: number }) => RenderedSymbol} render
 *   Never throws for any string; returns plain JSON data.
 */
export {};
