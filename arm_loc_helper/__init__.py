"""Arm Location Helper: lay out a robot deck in 3D, then drive the arm only along its safe paths.

The editor (the page in `static/`, `python -m arm_loc_helper` to open it) exports one Python file per
deck; `runtime` is the code inside that file, importable here as well:

    from arm_loc_helper.runtime import ArmController
    arm = ArmController(json.load(open("deck.json")))     # simulation; host="..." for a UR arm
"""
from .runtime import (  # noqa: F401
    ArmController,
    DigitalOutputGripper,
    GraspError,
    MotionError,
    RobotiqGripper,
    SimDriver,
    SimGripper,
    URDriver,
)

__version__ = "0.1.0"
