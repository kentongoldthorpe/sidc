// Colour helpers shared by the marking preview and the slide.

/** Black or white text, whichever reads better on the background colour `hex` (#rrggbb). */
export function textColorOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#000000' : '#ffffff';
}
