"""The runtime every exported controller carries: routing through safe points, the approach /
slot / approach routine, the bookkeeping that refuses unsafe calls, and the ur_rtde and Robotiq
drivers against fakes of the robot."""
import math
import socket
import sys
import threading
import types

import pytest

from arm_loc_helper.runtime import (
    ArmController,
    GraspError,
    MotionError,
    RobotiqGripper,
    SimDriver,
    URDriver,
    angle_between,
)

DOWN = [0.0, math.pi, 0.0]  # tool pointing straight down


def deck():
    return {
        "name": "test deck",
        "robot": {"model": "UR5e", "tcp": [0, 0, 0.15, 0, 0, 0]},
        "home": "home",
        "safe_points": {
            "home": {"q": [0, -1.57, 1.57, -1.57, -1.57, 0], "pose": [0.0, 0.4, 0.5] + DOWN, "links": ["left", "right"]},
            "left": {"q": [0.8, -1.4, 1.4, -1.57, -1.57, 0], "pose": [0.4, 0.3, 0.45] + DOWN},
            "right": {"pose": [-0.4, 0.3, 0.45] + DOWN},
        },
        "locations": {
            "tray": {"skill": "top_down", "safe_point": "left", "approach": [0, 0, 0.08],
                     "slots": [[0.45, 0.2, 0.05] + DOWN, [0.45, 0.24, 0.05] + DOWN], "grid": {"rows": 1, "cols": 2}},
            "balance": {"skill": "top_down", "safe_point": "left", "approach": [0, 0, 0.1],
                        "slots": [[0.3, 0.45, 0.12] + DOWN]},
            "rack": {"skill": "side_load", "safe_point": "right", "approach": [0.1, 0, 0],
                     "slots": [[-0.5, 0.2, 0.2, 1.2, 1.2, 1.2]]},
        },
    }


def names(steps):
    return [(s["kind"], s["name"]) for s in steps]


def test_pick_goes_through_the_safe_point_and_straight_down():
    arm = ArmController(deck(), echo=None)
    assert arm.where() == "home"
    assert names(arm.plan("pick", "tray", 1)) == [
        ("movej", "left"),
        ("movej_pose", "tray[1] approach"),
        ("gripper", "open"),
        ("movel", "tray[1]"),
        ("gripper", "close"),
        ("movel", "tray[1] approach"),
    ]
    steps = arm.plan("pick", "tray", 1)
    assert steps[1]["target"][:3] == pytest.approx([0.45, 0.24, 0.13])  # 8 cm above the slot
    assert steps[3]["slow"] and steps[5]["slow"] and not steps[1]["slow"]


def test_transfer_routes_along_the_safe_network():
    arm = ArmController(deck(), echo=None)
    steps = arm.plan("transfer", "tray", 0, "rack", 0)
    moves = [n for k, n in names(steps) if k != "gripper"]
    # out of the tray, back to its safe point, across through home (left and right are not linked), into the rack
    assert moves == ["left", "tray[0] approach", "tray[0]", "tray[0] approach",
                     "left", "home", "right", "rack[0] approach", "rack[0]", "rack[0] approach"]
    rack_approach = [s for s in steps if s["name"] == "rack[0] approach"][0]["target"]
    assert rack_approach[:3] == pytest.approx([-0.4, 0.2, 0.2])  # out along the insertion axis, same height
    assert steps[-1]["slow"]


def test_running_moves_the_driver_and_tracks_the_arm():
    arm = ArmController(deck(), echo=None)
    arm.transfer("tray", "balance", source_index=1)
    assert arm.where() == "balance[0] approach"
    assert arm.holding is None
    kinds = [k for k, _ in arm.driver.history]
    assert kinds == ["movej", "movej_pose", "movel", "movel", "movej", "movej_pose", "movel", "movel"]
    # tray and balance share the safe point "left": nothing goes through home in between
    assert arm.driver.history[4] == ("movej", deck()["safe_points"]["left"]["q"])
    arm.home()
    assert arm.where() == "home"


def test_another_slot_of_the_same_location_slides_over_at_the_approach_distance():
    arm = ArmController(deck(), echo=None)
    arm.move_to("tray", 0)
    assert arm.where() == "tray[0]"
    assert names(arm.plan("move_above", "tray", 1)) == [("movel", "tray[0] approach"), ("movel", "tray[1] approach")]


def test_a_safe_point_without_joints_is_reached_by_the_robots_ik():
    arm = ArmController(deck(), echo=None)
    assert names(arm.plan("safe_point", "right")) == [("movej_pose", "right")]


def test_refuses_to_pick_twice_or_place_nothing():
    arm = ArmController(deck(), echo=None)
    with pytest.raises(GraspError, match="empty"):
        arm.place("balance")
    arm.pick("tray", 0)
    with pytest.raises(GraspError, match="already holding"):
        arm.pick("tray", 1)
    arm.place("balance")
    assert arm.holding is None


def test_a_bad_slot_fails_before_anything_moves():
    arm = ArmController(deck(), echo=None)
    with pytest.raises(IndexError, match="slots 0-1"):
        arm.pick("tray", 2)
    with pytest.raises(KeyError, match="no location"):
        arm.pick("fridge")
    assert arm.driver.history == []


def test_no_safe_path_is_an_error():
    d = deck()
    d["safe_points"]["home"]["links"] = ["left"]
    arm = ArmController(d, echo=None)
    with pytest.raises(MotionError, match="no safe path"):
        arm.plan("pick", "rack", 0)


def test_an_unknown_start_needs_an_explicit_recover():
    arm = ArmController(deck(), driver=SimDriver(q=[0.7, -1.2, 1.3, -1.5, -1.5, 0.1]), echo=None)
    assert arm.where() == "unknown"
    with pytest.raises(MotionError, match="recover"):
        arm.pick("tray", 0)
    arm.recover()  # nearest safe point with joints, in joint space
    assert arm.where() == "left"
    arm.pick("tray", 0)


def test_the_arm_is_found_at_an_approach_point():
    arm = ArmController(deck(), driver=SimDriver(pose=[0.45, 0.24, 0.13] + DOWN), echo=None)
    assert arm.where() == "tray[1] approach"


def test_a_failed_move_leaves_the_position_unknown():
    class Stops(SimDriver):
        def move_linear(self, pose, speed, accel):
            raise MotionError("protective stop")

    arm = ArmController(deck(), driver=Stops(q=deck()["safe_points"]["home"]["q"]), echo=None)
    with pytest.raises(MotionError):
        arm.pick("tray", 0)
    assert arm.where() == "unknown"


def test_a_grip_on_nothing_is_reported():
    class Empty:
        def open(self):
            pass

        def close(self):
            return False

    arm = ArmController(deck(), gripper=Empty(), echo=None)
    with pytest.raises(GraspError, match="nothing in the gripper at tray\\[0\\]"):
        arm.pick("tray", 0)
    assert arm.where() == "tray[0]"  # down in the slot: the next call backs out first
    assert arm.plan("home")[0]["name"] == "tray[0] approach"


def test_speed_scales_the_deck_speeds():
    arm = ArmController(deck(), echo=None, speed=0.5)
    seen = []

    class Spy(SimDriver):
        def move_linear(self, pose, speed, accel):
            seen.append(speed)
            super().move_linear(pose, speed, accel)

    arm.driver = Spy(q=deck()["safe_points"]["home"]["q"])
    arm.move_to("balance")
    assert seen == [pytest.approx(0.02)]  # approach_speed 0.04 at half speed
    with pytest.raises(ValueError):
        arm.set_speed(1.5)


def test_bad_decks_are_rejected():
    d = deck()
    d["locations"]["tray"]["safe_point"] = "nowhere"
    with pytest.raises(ValueError, match="nowhere"):
        ArmController(d, echo=None)
    d = deck()
    d["safe_points"]["home"]["links"] = ["attic"]
    with pytest.raises(ValueError, match="attic"):
        ArmController(d, echo=None)


def test_angle_between():
    assert angle_between([0, 0, 0] + DOWN, [0, 0, 0, -math.pi, 0, 0]) == pytest.approx(180, abs=1e-6)
    assert angle_between([0, math.pi, 0], [0, math.pi, 0]) == pytest.approx(0, abs=1e-6)
    assert angle_between([0, 0, 0], [0, 0, math.radians(30)]) == pytest.approx(30)


# --- ur_rtde, faked -----------------------------------------------------------------------------


class FakeControl:
    def __init__(self, host):
        self.host, self.calls, self.result = host, [], True

    def __getattr__(self, name):
        def call(*args):
            self.calls.append((name, args))
            return self.result
        return call


class FakeReceive:
    def __init__(self, host):
        self.q = [0, -1.57, 1.57, -1.57, -1.57, 0]

    def getActualQ(self):
        return self.q

    def getActualTCPPose(self):
        return [0.0, 0.4, 0.5] + DOWN

    def disconnect(self):
        pass


@pytest.fixture
def fake_rtde(monkeypatch):
    control = types.ModuleType("rtde_control")
    control.RTDEControlInterface = FakeControl
    receive = types.ModuleType("rtde_receive")
    receive.RTDEReceiveInterface = FakeReceive
    monkeypatch.setitem(sys.modules, "rtde_control", control)
    monkeypatch.setitem(sys.modules, "rtde_receive", receive)


def test_ur_driver_sets_the_tcp_and_sends_each_move(fake_rtde):
    arm = ArmController(deck(), host="10.0.0.2", echo=None)
    assert isinstance(arm.driver, URDriver)
    assert arm.where() == "home"  # from the robot's joints
    c = arm.driver.control
    assert c.calls[0] == ("setTcp", ([0.0, 0.0, 0.15, 0.0, 0.0, 0.0],))
    c.calls.clear()
    arm.move_to("balance")
    assert [n for n, _ in c.calls] == ["moveJ", "moveJ_IK", "moveL"]
    assert c.calls[2][1][1] == pytest.approx(0.04)  # the slow approach speed


def test_ur_driver_turns_a_refused_move_into_motion_error(fake_rtde):
    arm = ArmController(deck(), host="10.0.0.2", echo=None)
    arm.driver.control.result = False
    with pytest.raises(MotionError, match="pendant"):
        arm.move_above("balance")
    assert arm.where() == "unknown"


# --- Robotiq URCap socket, faked ----------------------------------------------------------------


def fake_robotiq(object_on_close: bool):
    """A tiny server speaking the Robotiq URCap socket protocol."""
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    state = {"STA": 0, "PRE": 0, "OBJ": 3, "POS": 0}
    log = []

    def serve():
        conn, _ = server.accept()
        with conn:
            buf = b""
            while True:
                data = conn.recv(1024)
                if not data:
                    return
                buf += data
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    words = line.decode().split()
                    log.append(" ".join(words))
                    if words[0] == "SET":
                        values = dict(zip(words[1::2], map(int, words[2::2])))
                        if values.get("ACT") == 1:
                            state["STA"] = 3
                        if "POS" in values:
                            state["PRE"] = values["POS"]
                            state["OBJ"] = 2 if (values["POS"] > 200 and object_on_close) else 3
                        conn.sendall(b"ack\n")
                    else:
                        conn.sendall(f"{words[1]} {state[words[1]]}\n".encode())

    threading.Thread(target=serve, daemon=True).start()
    return server.getsockname()[1], log


@pytest.mark.parametrize("object_on_close", [True, False])
def test_robotiq_gripper_activates_and_reports_a_grip(object_on_close):
    port, log = fake_robotiq(object_on_close)
    g = RobotiqGripper("127.0.0.1", port=port, timeout=2)
    assert "SET ACT 1" in log
    g.open()
    assert g.close() is object_on_close
    assert "SET POS 255 SPE 255 FOR 100 GTO 1" in log
    g.disconnect()
