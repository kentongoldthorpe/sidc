// Paints a slide display list (see slide-layout.js) onto a canvas, and turns the canvas into a PNG.

/** Load each distinct SVG once. Blob URLs are same-origin, so the canvas stays exportable (not "tainted"). */
async function loadImages(svgs) {
  const images = new Map();
  await Promise.all([...new Set(svgs)].map(async (svg) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const image = new Image();
    image.src = url;
    try { await image.decode(); images.set(svg, image); } catch { /* an unreadable symbol is left out */ } finally { URL.revokeObjectURL(url); }
  }));
  return images;
}

/**
 * @param {{ width: number, height: number, items: object[] }} slide
 * @param {Document} [doc]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function paintSlide(slide, doc = document) {
  const canvas = doc.createElement('canvas');
  canvas.width = slide.width;
  canvas.height = slide.height;
  const ctx = canvas.getContext('2d');
  const images = await loadImages(slide.items.filter((i) => i.kind === 'image').map((i) => i.svg));

  for (const item of slide.items) {
    switch (item.kind) {
      case 'rect':
        ctx.fillStyle = item.fill;
        ctx.fillRect(item.x, item.y, item.w, item.h);
        if (item.stroke) { ctx.strokeStyle = item.stroke; ctx.lineWidth = 1; ctx.strokeRect(item.x + 0.5, item.y + 0.5, item.w - 1, item.h - 1); }
        break;
      case 'line':
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.width;
        ctx.beginPath();
        ctx.moveTo(item.x1, item.y1);
        ctx.lineTo(item.x2, item.y2);
        ctx.stroke();
        break;
      case 'text':
        ctx.fillStyle = item.color;
        ctx.font = `${item.weight} ${item.size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = item.align;
        ctx.textBaseline = 'middle';
        if (item.maxWidth) ctx.fillText(item.text, item.x, item.y, item.maxWidth); else ctx.fillText(item.text, item.x, item.y);
        break;
      case 'image': {
        const image = images.get(item.svg);
        if (image) ctx.drawImage(image, item.x, item.y, item.w, item.h);
        break;
      }
      case 'clip-start':
        ctx.save();
        ctx.beginPath();
        ctx.rect(item.x, item.y, item.w, item.h);
        ctx.clip();
        break;
      case 'clip-end':
        ctx.restore();
        break;
      default:
        throw new TypeError(`paintSlide: unknown item kind "${item.kind}"`);
    }
  }
  return canvas;
}

/** @returns {Promise<Blob>} image/png */
export const canvasToPng = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
});

/** Offer a Blob as a download. */
export async function downloadBlob(blob, fileName, doc = document) {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
