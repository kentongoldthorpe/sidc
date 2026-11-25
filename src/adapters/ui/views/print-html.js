// Print a document (worksheets, overlays) through a hidden frame, so the app's page is not replaced
// and nothing is opened in a new window. Resolves when printing is done (or after a minute, for a
// browser that never says so).
export function printHtml(html, doc = document) {
  return new Promise((resolve) => {
    const frame = doc.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;';
    frame.addEventListener('load', () => {
      const win = frame.contentWindow;
      let finished = false;
      const done = () => { if (finished) return; finished = true; frame.remove(); resolve(); };
      win.addEventListener('afterprint', done, { once: true });
      win.focus();
      win.print();
      setTimeout(done, 60_000);
    }, { once: true });
    frame.srcdoc = html;
    doc.body.append(frame);
  });
}
