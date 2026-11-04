"""Write public/ur5e.urdf and public/ur10e.urdf from public/ur3e.urdf.

The three are the same ros-industrial ur_description model with different numbers: the joint
origins (config/<model>/default_kinematics.yaml), the mesh offsets (physical_parameters.yaml and
visual_parameters.yaml) and the mesh folder. The inertial blocks are dropped: the editor only
draws the arm, and the UR3e's masses would be wrong for the others.

    python scripts/make_e_series_urdf.py
"""
import pathlib
import re

PUBLIC = pathlib.Path(__file__).resolve().parent.parent / "public"

# (UR3e text, per-model value); each must appear in ur3e.urdf exactly `count` times
UR3E = {
    "mesh": ("meshes/ur3e/", None, 14),
    "name": ('<robot name="ur3e_robot">', None, 1),
    "shoulder_offset": ('xyz="0 0 0.120"', 'xyz="0 0 {}"', 2),
    "elbow_offset": ('xyz="0 0 0.027"', 'xyz="0 0 {}"', 2),
    "wrist_1_visual": ('xyz="0 0 -0.104"', 'xyz="0 0 {}"', 2),
    "wrist_2_visual": ('xyz="0 0 -0.08535"', 'xyz="0 0 {}"', 2),
    "wrist_3_visual": ('xyz="0 0 -0.0921"', 'xyz="0 0 {}"', 2),
    "d1": ('xyz="0 0 0.15185"', 'xyz="0 0 {}"', 1),
    "a2": ('xyz="-0.24355 0 0"', 'xyz="{} 0 0"', 1),
    "a3_d4": ('xyz="-0.2132 0 0.13105"', 'xyz="{} 0 {}"', 1),
    "d5": ('xyz="0 -0.08535 -1.750557762378351e-11"', 'xyz="0 {} 0"', 1),
    "d6": ('xyz="0 0.0921 -1.8890025766262e-11"', 'xyz="0 {} 0"', 1),
}

MODELS = {
    "ur5e": {"shoulder_offset": 0.138, "elbow_offset": 0.007, "wrist_1_visual": -0.127, "wrist_2_visual": -0.0997,
             "wrist_3_visual": -0.0989, "d1": 0.1625, "a2": -0.425, "a3_d4": (-0.3922, 0.1333), "d5": -0.0997, "d6": 0.0996},
    "ur10e": {"shoulder_offset": 0.1762, "elbow_offset": 0.0393, "wrist_1_visual": -0.135, "wrist_2_visual": -0.12,
              "wrist_3_visual": -0.1168, "d1": 0.1807, "a2": -0.6127, "a3_d4": (-0.57155, 0.17415), "d5": -0.11985, "d6": 0.11655},
}


def main() -> None:
    src = (PUBLIC / "ur3e.urdf").read_text()
    src = re.sub(r"\s*<inertial>.*?</inertial>", "", src, flags=re.S)
    for model, values in MODELS.items():
        out = src
        for key, (old, fmt, count) in UR3E.items():
            n = out.count(old)
            if n != count:
                raise SystemExit(f"{key}: expected {count} of {old!r} in ur3e.urdf, found {n}")
            if key == "mesh":
                new = f"meshes/{model}/"
            elif key == "name":
                new = f'<robot name="{model}_robot">'
            else:
                v = values[key]
                new = fmt.format(*(v if isinstance(v, tuple) else (v,)))
            out = out.replace(old, new)
        out = out.replace("<!-- =================================================================================== -->",
                          f"<!-- {model}: generated from ur3e.urdf by scripts/make_e_series_urdf.py -->", 1)
        (PUBLIC / f"{model}.urdf").write_text(out)
        print(f"wrote public/{model}.urdf")


if __name__ == "__main__":
    main()
