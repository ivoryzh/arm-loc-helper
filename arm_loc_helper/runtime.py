"""Safe pick-and-place for a robot arm, from a deck laid out in Arm Location Helper.

A deck (a plain dict, exported by the editor) lists every location as the TCP poses of its slots,
the offset from each slot to its approach point, the safe points the arm travels between, and the
safe point each location is entered from. ArmController only ever moves like this:

    safe point --joint moves along the safe network--> the location's safe point
      --joint move--> the slot's approach point --slow straight line--> the slot
      --gripper-- and back out along the same line to the approach point

so every path between two locations is one somebody laid out on purpose. A top-down location
(a vial tray, a balance pan) has its approach point straight above the slot; a side-load location
(a rack you slide a slide or plate into along the bench) has it out along the insertion axis.

Poses are URScript poses, [x, y, z, rx, ry, rz] in metres and radians (rx, ry, rz an axis-angle
vector), in the robot's base frame, for the TCP the deck names. A Universal Robots arm is driven
through ur_rtde (`pip install ur_rtde`); with no host, a simulated driver records and prints the
moves instead, so the same controller runs in a notebook, a test, or IvoryOS without a robot.

Only the standard library is needed (ur_rtde is imported for a real robot only). The editor copies
this file, as it is, into every controller it exports, so an exported controller is one file.
"""
import math
import socket
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

Pose = List[float]
Joints = List[float]

DEFAULT_MOTION = {
    "joint_speed": 0.6,      # rad/s, movej between safe points and to approach points
    "joint_accel": 0.8,      # rad/s^2
    "linear_speed": 0.15,    # m/s, movel at full speed
    "linear_accel": 0.5,     # m/s^2
    "approach_speed": 0.04,  # m/s, the last straight line into a slot and back out
}

# A joint position this close (rad, every joint) or a TCP this close (m, and degrees for the
# orientation) to a known point counts as being at that point.
AT_JOINTS = 0.01
AT_METRES = 0.005
AT_DEGREES = 2.0


class MotionError(RuntimeError):
    """A move was refused or did not finish: out of reach, a safety limit, a protective stop."""


class GraspError(RuntimeError):
    """The gripper closed on nothing where something should have been."""


def _floats(v: Sequence[float], n: int, what: str) -> List[float]:
    if v is None or len(v) != n:
        raise ValueError(f"{what} needs {n} numbers, got {v!r}")
    return [float(x) for x in v]


def _fmt(v: Sequence[float]) -> str:
    return "[" + ", ".join(f"{x:.4f}" for x in v) + "]"


def _rotation(rv: Sequence[float]) -> List[List[float]]:
    """Rotation matrix of an axis-angle vector."""
    theta = math.sqrt(rv[0] * rv[0] + rv[1] * rv[1] + rv[2] * rv[2])
    if theta < 1e-12:
        return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    kx, ky, kz = rv[0] / theta, rv[1] / theta, rv[2] / theta
    c, s = math.cos(theta), math.sin(theta)
    v = 1 - c
    return [
        [kx * kx * v + c, kx * ky * v - kz * s, kx * kz * v + ky * s],
        [kx * ky * v + kz * s, ky * ky * v + c, ky * kz * v - kx * s],
        [kx * kz * v - ky * s, ky * kz * v + kx * s, kz * kz * v + c],
    ]


def angle_between(a: Sequence[float], b: Sequence[float]) -> float:
    """Degrees between the orientations of two poses (or two axis-angle vectors)."""
    ra, rb = _rotation(a[-3:]), _rotation(b[-3:])
    # trace(Ra^T Rb) = 1 + 2 cos(angle)
    trace = sum(ra[i][j] * rb[i][j] for i in range(3) for j in range(3))
    return math.degrees(math.acos(max(-1.0, min(1.0, (trace - 1) / 2))))


def distance(a: Sequence[float], b: Sequence[float]) -> float:
    """Metres between the positions of two poses. Plain sqrt so it matches the editor bit for bit."""
    dx, dy, dz = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return math.sqrt(dx * dx + dy * dy + dz * dz)


# --------------------------------------------------------------------------------------- drivers
# A driver moves the arm. Anything with these methods works, so another robot (or another UR
# library) only needs its own small class:
#     move_joints(q, speed, accel)            joint move to joint positions
#     move_joints_to_pose(pose, speed, accel) joint move to a TCP pose (the robot's own IK)
#     move_linear(pose, speed, accel)         straight-line TCP move
#     actual_q() / actual_pose()              where the arm is (None when unknown)
#     reachable(pose)                         True / False, or None when it cannot tell
#     close()


class SimDriver:
    """No robot: keeps every move in `history` and, with `echo`, prints it."""

    name = "simulation"

    def __init__(self, q: Optional[Sequence[float]] = None, pose: Optional[Sequence[float]] = None,
                 echo: Optional[Callable[[str], None]] = None):
        self.q: Optional[Joints] = list(q) if q is not None else None
        self.pose: Optional[Pose] = list(pose) if pose is not None else None
        self.history: List[Tuple[str, List[float]]] = []
        self._echo = echo

    def _record(self, kind: str, target: Sequence[float], speed: float, accel: float) -> None:
        self.history.append((kind, list(target)))
        if self._echo:
            self._echo(f"  {kind}({_fmt(target)}, v={speed:g}, a={accel:g})")

    def move_joints(self, q: Sequence[float], speed: float, accel: float) -> None:
        self._record("movej", q, speed, accel)
        self.q, self.pose = list(q), None

    def move_joints_to_pose(self, pose: Sequence[float], speed: float, accel: float) -> None:
        self._record("movej_pose", pose, speed, accel)
        self.q, self.pose = None, list(pose)

    def move_linear(self, pose: Sequence[float], speed: float, accel: float) -> None:
        self._record("movel", pose, speed, accel)
        self.q, self.pose = None, list(pose)

    def actual_q(self) -> Optional[Joints]:
        return self.q

    def actual_pose(self) -> Optional[Pose]:
        return self.pose

    def reachable(self, pose: Sequence[float]) -> Optional[bool]:
        return None

    def close(self) -> None:
        pass


class URDriver:
    """A Universal Robots arm (CB3 or e-series) through ur_rtde.

    The robot must be in remote control (e-series) with no program running: ur_rtde uploads its
    own control script. The deck's TCP (flange -> TCP) and payload are set on the robot when this
    connects, so a pose means the same here as in the editor and on the pendant.
    """

    name = "ur_rtde"

    def __init__(self, host: str, tcp: Optional[Sequence[float]] = None, payload: Optional[float] = None):
        try:
            import rtde_control
            import rtde_receive
        except ImportError as e:  # pragma: no cover - depends on the environment
            raise ImportError("Driving a real robot needs ur_rtde: pip install ur_rtde") from e
        self.host = host
        self.control = rtde_control.RTDEControlInterface(host)
        self.receive = rtde_receive.RTDEReceiveInterface(host)
        if tcp is not None:
            self.control.setTcp(_floats(tcp, 6, "tcp"))
        if payload is not None:
            self.control.setPayload(float(payload))

    @staticmethod
    def _ok(result: Any, what: str) -> None:
        if result is False:
            raise MotionError(f"the robot did not finish {what}: a protective stop, a safety limit or an "
                              "unreachable pose. Check the pendant before going on.")

    def move_joints(self, q: Sequence[float], speed: float, accel: float) -> None:
        self._ok(self.control.moveJ(list(q), speed, accel), "a joint move")

    def move_joints_to_pose(self, pose: Sequence[float], speed: float, accel: float) -> None:
        self._ok(self.control.moveJ_IK(list(pose), speed, accel), "a joint move to a pose")

    def move_linear(self, pose: Sequence[float], speed: float, accel: float) -> None:
        self._ok(self.control.moveL(list(pose), speed, accel), "a linear move")

    def actual_q(self) -> Optional[Joints]:
        return list(self.receive.getActualQ())

    def actual_pose(self) -> Optional[Pose]:
        return list(self.receive.getActualTCPPose())

    def reachable(self, pose: Sequence[float]) -> Optional[bool]:
        c = self.control
        if hasattr(c, "isPoseWithinSafetyLimits") and not c.isPoseWithinSafetyLimits(list(pose)):
            return False
        if hasattr(c, "getInverseKinematicsHasSolution"):
            return bool(c.getInverseKinematicsHasSolution(list(pose)))
        return None

    def close(self) -> None:
        try:
            self.control.stopScript()
        finally:
            self.control.disconnect()
            self.receive.disconnect()


# -------------------------------------------------------------------------------------- grippers
# A gripper needs open() and close(). close() may return False when it closed on nothing
# (a pick then raises GraspError), True when it holds something, or None when it cannot tell.


class SimGripper:
    """No gripper hardware: remembers whether it is open."""

    name = "simulation"

    def __init__(self, echo: Optional[Callable[[str], None]] = None):
        self.is_open = True
        self._echo = echo

    def open(self) -> None:
        self.is_open = True
        if self._echo:
            self._echo("  gripper.open()")

    def close(self) -> Optional[bool]:
        self.is_open = False
        if self._echo:
            self._echo("  gripper.close()")
        return None


class RobotiqGripper:
    """A Robotiq 2F-85/2F-140/Hand-E through the Robotiq URCap's socket on the robot (port 63352).

    Positions are 0 (open) to 255 (closed); `speed` and `force` 0-255.
    """

    name = "robotiq"

    def __init__(self, host: str, port: int = 63352, speed: int = 255, force: int = 100,
                 open_position: int = 0, closed_position: int = 255, timeout: float = 10.0):
        self.speed, self.force, self.timeout = int(speed), int(force), float(timeout)
        self.open_position, self.closed_position = int(open_position), int(closed_position)
        self._sock = socket.create_connection((host, port), timeout=timeout)
        self.activate()

    def _command(self, text: str) -> str:
        self._sock.sendall((text + "\n").encode("ascii"))
        return self._sock.recv(1024).decode("ascii").strip()

    def _set(self, **values: int) -> None:
        reply = self._command("SET " + " ".join(f"{k} {v}" for k, v in values.items()))
        if reply != "ack":
            raise RuntimeError(f"Robotiq gripper refused SET {values}: {reply!r}")

    def _get(self, name: str) -> int:
        reply = self._command(f"GET {name}")
        parts = reply.split()
        if len(parts) != 2 or parts[0] != name:
            raise RuntimeError(f"unexpected reply from the Robotiq gripper to GET {name}: {reply!r}")
        return int(parts[1])

    def _wait(self, done: Callable[[], bool], what: str) -> None:
        deadline = time.monotonic() + self.timeout
        while not done():
            if time.monotonic() > deadline:
                raise TimeoutError(f"Robotiq gripper: timed out waiting for {what}")
            time.sleep(0.02)

    def activate(self) -> None:
        if self._get("STA") == 3:
            return
        self._set(ACT=1)
        self._wait(lambda: self._get("STA") == 3, "activation")

    def move(self, position: int) -> int:
        """Go to `position`; returns the object status (2: stopped on an object while closing)."""
        position = max(0, min(255, int(position)))
        self._set(POS=position, SPE=self.speed, FOR=self.force, GTO=1)
        self._wait(lambda: self._get("PRE") == position, "the move to be accepted")
        status = {"obj": 0}

        def stopped() -> bool:
            status["obj"] = self._get("OBJ")
            return status["obj"] != 0

        self._wait(stopped, "the fingers to stop")
        return status["obj"]

    def open(self) -> None:
        self.move(self.open_position)

    def close(self) -> Optional[bool]:
        return self.move(self.closed_position) == 2

    def disconnect(self) -> None:
        self._sock.close()


class DigitalOutputGripper:
    """A gripper switched by one digital output: a pneumatic gripper's valve, or a tool output."""

    name = "digital_out"

    def __init__(self, host: str, pin: int = 0, tool: bool = False, close_level: bool = True, settle: float = 0.5):
        try:
            import rtde_io
        except ImportError as e:  # pragma: no cover - depends on the environment
            raise ImportError("A digital-output gripper needs ur_rtde: pip install ur_rtde") from e
        self.io = rtde_io.RTDEIOInterface(host)
        self.pin, self.tool, self.close_level, self.settle = int(pin), bool(tool), bool(close_level), float(settle)

    def _set(self, level: bool) -> None:
        if self.tool:
            self.io.setToolDigitalOut(self.pin, level)
        else:
            self.io.setStandardDigitalOut(self.pin, level)
        time.sleep(self.settle)

    def open(self) -> None:
        self._set(not self.close_level)

    def close(self) -> Optional[bool]:
        self._set(self.close_level)
        return None


def make_gripper(config: Optional[Dict[str, Any]], host: Optional[str],
                 echo: Optional[Callable[[str], None]] = None) -> Any:
    """The gripper a deck's `gripper` section describes; a SimGripper when there is no robot."""
    config = config or {}
    kind = config.get("type", "none")
    if host is None or kind == "none":
        return SimGripper(echo)
    if kind == "robotiq":
        return RobotiqGripper(host, speed=config.get("speed", 255), force=config.get("force", 100),
                              open_position=config.get("open_position", 0),
                              closed_position=config.get("closed_position", 255))
    if kind == "digital_out":
        return DigitalOutputGripper(host, pin=config.get("pin", 0), tool=config.get("tool", False),
                                    close_level=config.get("close_level", True), settle=config.get("settle", 0.5))
    raise ValueError(f"unknown gripper type {kind!r} (robotiq, digital_out or none)")


# ------------------------------------------------------------------------------------------- deck


class SafePoint:
    """A point in free space the arm can always go to, and the safe points it can go to from here."""

    def __init__(self, name: str, data: Dict[str, Any]):
        self.name = name
        self.label = data.get("label", name)
        self.q: Optional[Joints] = _floats(data["q"], 6, f"{name}.q") if data.get("q") is not None else None
        self.pose: Optional[Pose] = _floats(data["pose"], 6, f"{name}.pose") if data.get("pose") is not None else None
        if self.q is None and self.pose is None:
            raise ValueError(f"safe point {name} needs q (joints) or pose")
        self.links: List[str] = list(data.get("links", []))


class Location:
    """One place on the deck: its slots (TCP poses), the approach offset, and its safe point."""

    def __init__(self, name: str, data: Dict[str, Any]):
        self.name = name
        self.label = data.get("label", name)
        self.skill = data.get("skill", "top_down")
        self.slots: List[Pose] = [_floats(p, 6, f"{name} slot {i}") for i, p in enumerate(data["slots"])]
        if not self.slots:
            raise ValueError(f"location {name} has no slots")
        self.approach: List[float] = _floats(data.get("approach", [0.0, 0.0, 0.05]), 3, f"{name}.approach")
        self.safe_point: str = data["safe_point"]
        self.grid: Optional[Dict[str, int]] = data.get("grid")

    def slot(self, index: int) -> Pose:
        index = int(index)
        if not 0 <= index < len(self.slots):
            raise IndexError(f"{self.name} has slots 0-{len(self.slots) - 1}, not {index}")
        return list(self.slots[index])

    def approach_pose(self, index: int) -> Pose:
        p = self.slot(index)
        return [p[0] + self.approach[0], p[1] + self.approach[1], p[2] + self.approach[2], p[3], p[4], p[5]]


# Where the arm is: ("safe", name), ("loc", location, index, down) with down=True at the slot
# itself and False at its approach point, or None when nobody knows.
State = Optional[Tuple[Any, ...]]


def _state_name(state: State) -> str:
    if state is None:
        return "unknown"
    if state[0] == "safe":
        return state[1]
    return f"{state[1]}[{state[2]}]" + ("" if state[3] else " approach")


class ArmController:
    """Moves an arm between the locations of a deck, only along the safe paths the deck lays out.

        arm = ArmController(deck)                         # simulation: prints the moves
        arm = ArmController(deck, host="192.168.1.10")    # a UR arm, through ur_rtde
        arm.transfer("vial_tray", "balance", source_index=3)

    `speed` scales every speed in the deck's `motion` section (0 < speed <= 1).
    """

    def __init__(self, deck: Dict[str, Any], host: Optional[str] = None, driver: Any = None,
                 gripper: Any = None, speed: float = 1.0, echo: Optional[Callable[[str], None]] = print):
        self.deck = deck
        self.name = deck.get("name", "deck")
        self.motion = {**DEFAULT_MOTION, **deck.get("motion", {})}
        self.safe_points: Dict[str, SafePoint] = {n: SafePoint(n, d) for n, d in deck["safe_points"].items()}
        self.locations: Dict[str, Location] = {n: Location(n, d) for n, d in deck.get("locations", {}).items()}
        if not self.safe_points:
            raise ValueError("a deck needs at least one safe point")
        self.home_point: str = deck.get("home") or next(iter(self.safe_points))
        self._links = self._build_links()
        self._check_deck()
        self._echo = echo
        robot = deck.get("robot", {})
        if driver is None:
            if host:
                driver = URDriver(host, tcp=robot.get("tcp"), payload=robot.get("payload"))
            else:
                home = self.safe_points[self.home_point]
                driver = SimDriver(q=home.q, pose=home.pose if home.q is None else None, echo=echo)
        self.driver = driver
        self.gripper = gripper if gripper is not None else make_gripper(deck.get("gripper"), host, echo)
        self.speed = 1.0
        self.set_speed(speed)
        self.holding: Optional[str] = None
        self._at: State = self._locate()

    # --- the deck ---------------------------------------------------------------------------------

    def _build_links(self) -> Dict[str, List[str]]:
        links: Dict[str, set] = {n: set() for n in self.safe_points}
        for n, sp in self.safe_points.items():
            for m in sp.links:
                if m not in self.safe_points:
                    raise ValueError(f"safe point {n} links to {m}, which is not a safe point")
                if m != n:
                    links[n].add(m)
                    links[m].add(n)
        return {n: sorted(v) for n, v in links.items()}

    def _check_deck(self) -> None:
        if self.home_point not in self.safe_points:
            raise ValueError(f"home is {self.home_point}, which is not a safe point")
        for loc in self.locations.values():
            if loc.safe_point not in self.safe_points:
                raise ValueError(f"location {loc.name} is entered from {loc.safe_point}, which is not a safe point")

    def _edge(self, a: str, b: str) -> float:
        pa, pb = self.safe_points[a].pose, self.safe_points[b].pose
        return distance(pa, pb) if pa is not None and pb is not None else 1.0

    def _path(self, start: str, goal: str) -> List[str]:
        """The safe points from `start` to `goal`, both included, shortest by straight-line distance."""
        dist: Dict[str, float] = {start: 0.0}
        prev: Dict[str, str] = {}
        done: set = set()
        while True:
            frontier = [(d, n) for n, d in dist.items() if n not in done]
            if not frontier:
                break
            d, n = min(frontier)
            if n == goal:
                break
            done.add(n)
            for m in self._links[n]:
                nd = d + self._edge(n, m)
                if nd < dist.get(m, math.inf):
                    dist[m] = nd
                    prev[m] = n
        if goal not in dist:
            raise MotionError(f"no safe path from {start} to {goal}: link their safe points in the editor")
        out = [goal]
        while out[-1] != start:
            out.append(prev[out[-1]])
        return out[::-1]

    def _location(self, name: str) -> Location:
        try:
            return self.locations[name]
        except KeyError:
            raise KeyError(f"no location {name!r}; this deck has {', '.join(self.locations) or 'none'}") from None

    def _safe_point(self, name: str) -> SafePoint:
        try:
            return self.safe_points[name]
        except KeyError:
            raise KeyError(f"no safe point {name!r}; this deck has {', '.join(self.safe_points)}") from None

    # --- where the arm is -------------------------------------------------------------------------

    def _locate(self) -> State:
        q, pose = self.driver.actual_q(), self.driver.actual_pose()
        if q is not None:
            for sp in self.safe_points.values():
                if sp.q is not None and max(abs(a - b) for a, b in zip(q, sp.q)) < AT_JOINTS:
                    return ("safe", sp.name)
        if pose is not None:
            def near(p: Sequence[float]) -> bool:
                return distance(pose, p) < AT_METRES and angle_between(pose, p) < AT_DEGREES
            for sp in self.safe_points.values():
                if sp.pose is not None and near(sp.pose):
                    return ("safe", sp.name)
            for loc in self.locations.values():
                for i in range(len(loc.slots)):
                    if near(loc.approach_pose(i)):
                        return ("loc", loc.name, i, False)
                    if near(loc.slot(i)):
                        return ("loc", loc.name, i, True)
        return None

    def where(self) -> str:
        """Where the arm is: a safe point, `location[index]`, `location[index] approach`, or unknown."""
        return _state_name(self._at)

    # --- planning ---------------------------------------------------------------------------------

    def _to_safe(self, state: State, goal: str) -> Tuple[List[Tuple[dict, State]], State]:
        if state is None:
            raise MotionError("the arm is not at a known point (it was moved by hand, or a move failed). "
                              "Jog it clear on the pendant, then call recover() to send it to a safe point.")
        steps: List[Tuple[dict, State]] = []
        if state[0] == "loc":
            loc = self.locations[state[1]]
            if state[3]:
                steps.append(({"kind": "movel", "name": f"{loc.name}[{state[2]}] approach",
                               "target": loc.approach_pose(state[2]), "slow": True}, ("loc", loc.name, state[2], False)))
            state = ("safe", loc.safe_point)
            steps.append((self._safe_step(loc.safe_point), state))
        for name in self._path(state[1], goal)[1:]:
            state = ("safe", name)
            steps.append((self._safe_step(name), state))
        return steps, state

    def _safe_step(self, name: str) -> dict:
        sp = self.safe_points[name]
        if sp.q is not None:
            return {"kind": "movej", "name": name, "target": list(sp.q), "slow": False}
        return {"kind": "movej_pose", "name": name, "target": list(sp.pose), "slow": False}

    def _to_approach(self, state: State, location: str, index: int) -> Tuple[List[Tuple[dict, State]], State]:
        loc = self._location(location)
        approach = loc.approach_pose(index)  # raises on a bad index before anything moves
        index = int(index)
        name = f"{loc.name}[{index}] approach"
        if state is not None and state[0] == "loc" and state[1] == loc.name:
            # another slot of the same location: stay out at the approach distance and slide over
            steps: List[Tuple[dict, State]] = []
            if state[3]:
                steps.append(({"kind": "movel", "name": f"{loc.name}[{state[2]}] approach",
                               "target": loc.approach_pose(state[2]), "slow": True}, ("loc", loc.name, state[2], False)))
            if state[2] != index:
                steps.append(({"kind": "movel", "name": name, "target": approach, "slow": False}, ("loc", loc.name, index, False)))
            return steps, ("loc", loc.name, index, False)
        steps, state = self._to_safe(state, loc.safe_point)
        state = ("loc", loc.name, index, False)
        steps.append(({"kind": "movej_pose", "name": name, "target": approach, "slow": False}, state))
        return steps, state

    def _into(self, location: str, index: int, state: State) -> Tuple[dict, State]:
        loc = self._location(location)
        return ({"kind": "movel", "name": f"{loc.name}[{int(index)}]", "target": loc.slot(index), "slow": True},
                ("loc", loc.name, int(index), True))

    def _out(self, location: str, index: int) -> Tuple[dict, State]:
        loc = self._location(location)
        return ({"kind": "movel", "name": f"{loc.name}[{int(index)}] approach", "target": loc.approach_pose(index), "slow": True},
                ("loc", loc.name, int(index), False))

    def _plan(self, action: str, state: State, location: Optional[str] = None, index: int = 0,
              destination: Optional[str] = None, destination_index: int = 0) -> List[Tuple[dict, State]]:
        if action == "home":
            return self._to_safe(state, self.home_point)[0]
        if action == "safe_point":
            self._safe_point(location or "")
            return self._to_safe(state, location)[0]
        if location is None:
            raise ValueError(f"{action} needs a location")
        if action == "transfer":
            if destination is None:
                raise ValueError("transfer needs a destination")
            first = self._plan("pick", state, location, index)
            return first + self._plan("place", first[-1][1], destination, destination_index)
        steps, state = self._to_approach(state, location, index)
        if action == "move_above":
            return steps
        if action == "move_to":
            return steps + [self._into(location, index, state)]
        if action == "pick":
            return steps + [({"kind": "gripper", "name": "open", "target": None, "slow": False}, state),
                            self._into(location, index, state),
                            ({"kind": "gripper", "name": "close", "target": None, "slow": False}, ("loc", location, int(index), True)),
                            self._out(location, index)]
        if action == "place":
            down = self._into(location, index, state)
            return steps + [down,
                            ({"kind": "gripper", "name": "open", "target": None, "slow": False}, down[1]),
                            self._out(location, index)]
        raise ValueError(f"unknown action {action!r}")

    def plan(self, action: str, location: Optional[str] = None, index: int = 0,
             destination: Optional[str] = None, destination_index: int = 0) -> List[dict]:
        """The moves an action would make from where the arm is now, without moving.

        action: home, safe_point (location = its name), move_above, move_to, pick, place, transfer.
        """
        return [step for step, _ in self._plan(action, self._at, location, index, destination, destination_index)]

    # --- moving -----------------------------------------------------------------------------------

    def _run(self, title: str, steps: List[Tuple[dict, State]]) -> None:
        if self._echo:
            self._echo(f"{self.name}: {title}")
        m, k = self.motion, self.speed
        for step, after in steps:
            kind = step["kind"]
            try:
                if kind == "movej":
                    self.driver.move_joints(step["target"], m["joint_speed"] * k, m["joint_accel"] * k)
                elif kind == "movej_pose":
                    self.driver.move_joints_to_pose(step["target"], m["joint_speed"] * k, m["joint_accel"] * k)
                elif kind == "movel":
                    v = m["approach_speed"] if step["slow"] else m["linear_speed"]
                    self.driver.move_linear(step["target"], v * k, m["linear_accel"] * k)
                elif kind == "gripper":
                    if step["name"] == "open":
                        self.gripper.open()
                        self.holding = None
                    else:
                        held = self.gripper.close()
                        if held is False:
                            self._at = after
                            raise GraspError(f"nothing in the gripper at {_state_name(after)}")
                        self.holding = _state_name(after)
            except MotionError:
                self._at = None  # it stopped somewhere along the way
                raise
            self._at = after

    def _act(self, title: str, action: str, location: Optional[str] = None, index: int = 0,
             destination: Optional[str] = None, destination_index: int = 0) -> None:
        if action in ("pick", "transfer") and self.holding is not None:
            raise GraspError(f"already holding the item from {self.holding}: place it first (or open_gripper())")
        if action == "place" and self.holding is None:
            raise GraspError(f"nothing to place at {location}[{index}]: the gripper is empty")
        self._run(title, self._plan(action, self._at, location, index, destination, destination_index))

    def home(self) -> None:
        """Go to the home safe point along the safe network."""
        self._act("home()", "home")

    def go_to_safe_point(self, name: str) -> None:
        """Go to a safe point along the safe network."""
        self._act(f"go_to_safe_point({name!r})", "safe_point", name)

    def move_above(self, location: str, index: int = 0) -> None:
        """Go to the approach point of a slot (above it, or in front of it for a side-load rack)."""
        self._act(f"move_above({location!r}, {index})", "move_above", location, index)

    def move_to(self, location: str, index: int = 0) -> None:
        """Go into a slot without using the gripper (to press a button, or dock a tool)."""
        self._act(f"move_to({location!r}, {index})", "move_to", location, index)

    def pick(self, location: str, index: int = 0) -> None:
        """Pick up the item in a slot: in through the approach point, grip, and back out."""
        self._act(f"pick({location!r}, {index})", "pick", location, index)

    def place(self, location: str, index: int = 0) -> None:
        """Put the held item into a slot: in through the approach point, release, and back out."""
        self._act(f"place({location!r}, {index})", "place", location, index)

    def transfer(self, source: str, destination: str, source_index: int = 0, destination_index: int = 0) -> None:
        """Pick from one slot and place into another."""
        self._act(f"transfer({source!r}, {destination!r}, {source_index}, {destination_index})",
                  "transfer", source, source_index, destination, destination_index)

    def open_gripper(self) -> None:
        """Open the gripper where the arm is (drops what it holds)."""
        self.gripper.open()
        self.holding = None

    def close_gripper(self) -> None:
        """Close the gripper where the arm is."""
        held = self.gripper.close()
        self.holding = None if held is False else "hand"

    def recover(self, safe_point: Optional[str] = None) -> None:
        """Send the arm straight to a safe point from wherever it is, after a stop or a jog.

        This is the one move that does not follow the safe network: make sure the way is clear.
        With no name it goes to the safe point nearest in joint space (or to home).
        """
        if safe_point is None:
            q = self.driver.actual_q()
            known = [sp for sp in self.safe_points.values() if sp.q is not None]
            if q is not None and known:
                safe_point = min(known, key=lambda sp: max(abs(a - b) for a, b in zip(q, sp.q))).name
            else:
                safe_point = self.home_point
        self._safe_point(safe_point)
        self._run(f"recover({safe_point!r})", [(self._safe_step(safe_point), ("safe", safe_point))])

    def set_speed(self, fraction: float) -> None:
        """Scale every speed in the deck by `fraction` (0 < fraction <= 1)."""
        fraction = float(fraction)
        if not 0 < fraction <= 1:
            raise ValueError("speed is a fraction of the deck's speeds: 0 < speed <= 1")
        self.speed = fraction

    def slot_count(self, location: str) -> int:
        """How many slots a location has."""
        return len(self._location(location).slots)

    def check(self) -> List[str]:
        """Ask the driver whether every slot, approach point and safe point is reachable.

        Returns the problems found (an empty list when all is well). The simulation cannot tell,
        and says so; the editor already checked reach with the arm's kinematics.
        """
        problems: List[str] = []
        unknown = 0
        poses: List[Tuple[str, Pose]] = [(sp.name, sp.pose) for sp in self.safe_points.values() if sp.pose is not None]
        for loc in self.locations.values():
            for i in range(len(loc.slots)):
                poses += [(f"{loc.name}[{i}]", loc.slot(i)), (f"{loc.name}[{i}] approach", loc.approach_pose(i))]
        for name, pose in poses:
            ok = self.driver.reachable(pose)
            if ok is False:
                problems.append(f"{name} is out of reach or outside the safety limits")
            elif ok is None:
                unknown += 1
        if unknown:
            problems.append(f"{unknown} poses not checked: the {getattr(self.driver, 'name', 'driver')} driver cannot tell")
        return problems

    def disconnect(self) -> None:
        """Let go of the robot (and the gripper's socket)."""
        if hasattr(self.gripper, "disconnect"):
            self.gripper.disconnect()
        self.driver.close()
