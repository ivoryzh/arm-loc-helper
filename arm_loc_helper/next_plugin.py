"""The editor as a page in ivoryos-next (`pip install "arm-loc-helper[edge]"`).

    import ivoryos_edge
    from arm_loc_helper.next_plugin import plugin

    ivoryos_edge.run(__name__, plugins=[plugin])

The page is static (built from the Vite source with `npm run build`) and needs nothing from the
deck: the controller it exports is what the deck runs, as an ordinary instrument.
"""
from ivoryos_edge.plugins import Plugin

plugin = Plugin("Arm Location Helper", id="arm_loc_helper", page="static", placement="tab", icon="move-3d")
