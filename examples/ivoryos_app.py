#!/usr/bin/env python3
"""The exported demo controller as an IvoryOS instrument, with the editor as a tab.

    pip install "arm-loc-helper[edge]"
    python examples/ivoryos_app.py

`arm` is simulated (no host): every method is in the workflow designer, the locations and safe
points as dropdowns. Give it host="192.168.1.10" (and pip install ur_rtde) for the real arm.
"""
import ivoryos_edge

from arm_loc_helper.next_plugin import plugin
from demo_deck_arm import DemoDeckArm

arm = DemoDeckArm()

if __name__ == "__main__":
    ivoryos_edge.run(__name__, plugins=[plugin])
