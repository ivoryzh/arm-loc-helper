"""The editor served the way ivoryos-next serves a plugin, and the standalone server."""
import importlib.util
import pathlib
import threading
import urllib.request

import pytest

STATIC = pathlib.Path(__file__).resolve().parent.parent / "arm_loc_helper" / "static"
built = pytest.mark.skipif(not (STATIC / "index.html").exists(), reason="page not built (npm run build)")


@built
@pytest.mark.skipif(importlib.util.find_spec("ivoryos_edge") is None, reason="ivoryos-next edge server not installed")
def test_ivoryos_next_serves_the_built_page():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from ivoryos_edge.plugins import start_plugin

    from arm_loc_helper.next_plugin import plugin

    app = FastAPI()
    assert start_plugin(app, plugin, {}) is None
    with TestClient(app) as client:
        page = client.get("/plugins/arm_loc_helper/")
        assert page.status_code == 200
        assert "Arm Location Helper" in page.text and 'type="module"' in page.text
        # every asset path is relative, so it resolves under the plugin's mount point
        assert 'src="/' not in page.text and 'href="/' not in page.text
        for urdf in ("ur3", "ur3e", "ur5", "ur5e", "ur10", "ur10e"):
            assert client.get(f"/plugins/arm_loc_helper/{urdf}.urdf").status_code == 200


@built
def test_python_m_arm_loc_helper_serves_the_page(monkeypatch):
    import http.server

    from arm_loc_helper import __main__ as main

    started = threading.Event()
    servers = []
    real = http.server.ThreadingHTTPServer

    class Recording(real):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            servers.append(self)
            started.set()

    monkeypatch.setattr(http.server, "ThreadingHTTPServer", Recording)
    t = threading.Thread(target=main.main, args=(["--port", "0", "--no-browser"],), daemon=True)
    t.start()
    assert started.wait(5)
    port = servers[0].server_address[1]
    html = urllib.request.urlopen(f"http://127.0.0.1:{port}/").read().decode()
    assert "Arm Location Helper" in html
    servers[0].shutdown()
