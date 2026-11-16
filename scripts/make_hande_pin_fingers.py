#!/usr/bin/env python3
"""Split a CAD export of the Hand-E pin fingers into the two meshes the editor draws.

The export (a binary STL in millimetres) holds both fingers closed, each with its grip pad and two
hollow bosses that take the pins: x runs from the fingertips (0) back to the face that bolts to the
gripper's rack (46.5), the fingers part along z about z = 3.5, and the bosses point along -y.

Each finger comes out in the frame of its link in public/robotiq_hande_pins.urdf, in metres: origin
on the rack's face in the middle of the gripper, z out along the gripper, x the way the finger
slides. The left finger is the one on +x.

    python3 scripts/make_hande_pin_fingers.py "HAND-E Finger.stl"
"""
import struct
import sys
from collections import defaultdict
from pathlib import Path

LENGTH = 46.5   # mm, fingertips to the mounting face
MIDDLE = 3.5    # mm, the plane the fingers close on
OUT = Path(__file__).resolve().parent.parent / "public"


def read(path):
    data = Path(path).read_bytes()
    (count,) = struct.unpack("<I", data[80:84])
    if len(data) != 84 + 50 * count:
        raise SystemExit(f"{path}: not a binary STL")
    return [struct.unpack("<9f", data[96 + 50 * i: 132 + 50 * i]) for i in range(count)]


def bodies(triangles):
    """Triangles grouped into connected bodies (vertices welded to a micrometre)."""
    parent = {}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def corners(t):
        return [tuple(round(c, 3) for c in t[i:i + 3]) for i in (0, 3, 6)]

    for t in triangles:
        a, b, c = corners(t)
        for k in (a, b, c):
            parent.setdefault(k, k)
        for k in (b, c):
            ra, rb = find(a), find(k)
            if ra != rb:
                parent[rb] = ra
    groups = defaultdict(list)
    for t in triangles:
        groups[find(corners(t)[0])].append(t)
    return list(groups.values())


def to_link(t):
    """A triangle from the export's frame (mm) to the finger link's (m)."""
    out = []
    for i in (0, 3, 6):
        x, y, z = t[i:i + 3]
        out += [(z - MIDDLE) / 1000, y / 1000, (LENGTH - x) / 1000]
    return out


def write(path, triangles):
    with open(path, "wb") as f:
        f.write(b"Hand-E pin finger, metres, finger link frame".ljust(80))
        f.write(struct.pack("<I", len(triangles)))
        for t in triangles:
            a, b, c = t[0:3], t[3:6], t[6:9]
            u = [b[i] - a[i] for i in range(3)]
            v = [c[i] - a[i] for i in range(3)]
            n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
            size = sum(k * k for k in n) ** 0.5 or 1.0
            f.write(struct.pack("<12fH", *(k / size for k in n), *t, 0))


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    sides = {"left": [], "right": []}
    for body in bodies(read(sys.argv[1])):
        zs = [t[i] for t in body for i in (2, 5, 8)]
        sides["left" if sum(zs) / len(zs) > MIDDLE else "right"] += [to_link(t) for t in body]
    for side, triangles in sides.items():
        path = OUT / f"hande_pin_finger_{side}.stl"
        write(path, triangles)
        xs = [t[i] for t in triangles for i in (0, 3, 6)]
        print(f"{path.name}: {len(triangles)} triangles, x {min(xs) * 1000:.2f} to {max(xs) * 1000:.2f} mm")


if __name__ == "__main__":
    main()
