#!/usr/bin/env python3
"""COA Builder development server (Python 3 standard library only).

Like serve.ps1: listens on localhost only, sends `Cache-Control: no-store` so a plain reload always
loads current modules (python3 -m http.server lets browsers cache them, which can mix old and new
code after `git pull`), and never serves dot-files such as .git.

    python3 serve.py              # http://localhost:8080/
    python3 serve.py --port 8081
"""
import argparse
import functools
import http.server
import os
import sys
import urllib.parse


# Same policy as index.html and serve.ps1 (tests/csp.test.js checks they agree).
CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript', '.mjs': 'text/javascript', '.geojson': 'application/geo+json', '.json': 'application/json',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', CSP)
        super().end_headers()

    def send_head(self):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if any(part.startswith('.') for part in path.replace('\\', '/').split('/') if part):
            self.send_error(404, 'Not found')
            return None
        return super().send_head()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--port', type=int, default=8080)
    args = parser.parse_args()
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(Handler, directory=root)
    try:
        server = http.server.ThreadingHTTPServer(('localhost', args.port), handler)
    except OSError as error:
        sys.exit(f'serve.py: could not listen on http://localhost:{args.port}/ ({error}). Try --port 8081.')
    print(f'COA Builder: serving {root} at http://localhost:{args.port}/  (Ctrl+C to stop)', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
