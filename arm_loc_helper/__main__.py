"""`python -m arm_loc_helper`: open the editor in a browser, served from this package (no Node needed)."""
import argparse
import functools
import http.server
import os
import sys
import threading
import webbrowser

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(prog="python -m arm_loc_helper", description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="address to listen on (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="port (default 8765, 0 for any free one)")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser")
    args = parser.parse_args(argv)
    if not os.path.exists(os.path.join(STATIC, "index.html")):
        sys.exit(f"The page is not built ({STATIC} has no index.html): run `npm install && npm run build` in a clone.")
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=STATIC)
    with http.server.ThreadingHTTPServer((args.host, args.port), handler) as httpd:
        url = f"http://{args.host}:{httpd.server_address[1]}/"
        print(f"Arm Location Helper: {url}  (Ctrl+C to stop)")
        if not args.no_browser:
            threading.Timer(0.5, webbrowser.open, (url,)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
