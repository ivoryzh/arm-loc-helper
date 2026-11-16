#!/usr/bin/env python3
"""Turn a CAD export of the 90° gripper bracket into the mesh the editor draws on the flange.

The export (a binary STL in millimetres) has the face that bolts to the robot's flange in the plane
y = 0, centred on the origin, with the robot on the +y side; and the face the gripper bolts to in
the plane x = 42.5, centred on y = -38.5, with the gripper pointing along +x.

The mesh comes out in metres in the bracket's own frame: origin in the middle of the flange face, z
out of the flange, x the way the gripper points. `BRACKET_90` in src/lib/tools.ts holds the two numbers
that place a gripper on it (42.5 mm out to the gripper's face, its axis 38.5 mm from the flange).

    python3 scripts/make_bracket_mesh.py "90 Degree Bracket.stl"
"""
import struct
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "bracket_90.stl"


def turn(v, scale):
    x, y, z = v
    return (x * scale, z * scale, -y * scale)   # a proper rotation: the facets keep their winding


def main(path):
    data = Path(path).read_bytes()
    (count,) = struct.unpack("<I", data[80:84])
    if len(data) != 84 + 50 * count:
        raise SystemExit(f"{path}: not a binary STL")
    out = bytearray(b"90 degree gripper bracket, bracket frame, metres".ljust(80, b" "))
    out += struct.pack("<I", count)
    lo, hi = [1e9] * 3, [-1e9] * 3
    for i in range(count):
        f = struct.unpack("<12f", data[84 + 50 * i: 132 + 50 * i])
        normal = turn(f[0:3], 1.0)
        corners = [turn(f[3 + 3 * k: 6 + 3 * k], 0.001) for k in range(3)]
        for c in corners:
            for a in range(3):
                lo[a], hi[a] = min(lo[a], c[a]), max(hi[a], c[a])
        out += struct.pack("<12fH", *normal, *corners[0], *corners[1], *corners[2], 0)
    OUT.write_bytes(out)
    size = ", ".join(f"{'xyz'[a]} {lo[a] * 1000:.1f}..{hi[a] * 1000:.1f}" for a in range(3))
    print(f"{OUT.name}: {count} facets, {size} mm")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
