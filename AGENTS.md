# arm-loc-helper: Agent Guidelines

## What this is

A deck editor for a robot arm (Universal Robots first), plus the Python runtime its exports run on.
In the browser (Vite + React + react-three-fiber), you place components (trays, stations,
side-load racks, obstacle blocks) and safe points in the robot's base frame, import URScript
waypoints, read the checks, preview calls on the arm, and export one Python file: the runtime
(`arm_loc_helper/runtime.py`, verbatim) + the deck as data + a class with typed methods named after
the deck's locations. That class is the deliverable: a standalone `ur_rtde` controller that
IvoryOS also picks up as an instrument.

## Invariants (break one and the tests should fail; if they do not, add the test)

1. **The preview plans what the robot runs.** `src/lib/planner.ts` mirrors `ArmController._plan` in
   `runtime.py` step for step (same Dijkstra, ties broken by name, same plain-sqrt distances, same
   step names). `tests/deck.test.ts` runs the exported file under Python and compares the plans.
   Change one side and you must change the other.
2. **The runtime is stdlib-only and runs on Python 3.9.** It is copied into every export. No
   `from __future__ import annotations` (IvoryOS reads real annotations) and no `X | Y` types.
   `ur_rtde` is imported only inside `URDriver` / `DigitalOutputGripper`.
3. **Every move goes through the safe network**, except `recover()`, which is explicit and
   documented as such. Unknown position → `MotionError` until `recover()`; a failed move → unknown.
4. **Frames:** everything is in the UR `base` frame (z up, metres; URScript poses with axis-angle
   rotations), for the TCP in `project.robot.tcp`. On screen the URDF's `base_link` is turned π
   about z (`RobotArm.tsx`), and `THREE.Object3D.DEFAULT_UP` is z (`Scene.tsx`).
5. **No absolute runtime paths** in `src/` (`fetch('/x')`, `'/ur5.urdf'`). The same build is served
   from a domain root (Vercel), from `/plugins/arm_loc_helper/` (ivoryos-next) and by
   `python -m arm_loc_helper`. Use `${import.meta.env.BASE_URL}x` (see `RobotArm.tsx`).
6. **The exported class's public surface is what IvoryOS shows.** Keep helpers `_private`;
   location and safe-point parameters are `Literal[...]` so they become dropdowns.

## Layout

- `arm_loc_helper/`: the Python package. `runtime.py` (ArmController, SimDriver, URDriver,
  RobotiqGripper, DigitalOutputGripper), `next_plugin.py` (ivoryos-edge Plugin, `placement="tab"`),
  `__main__.py` (serves `static/`), `static/` (the built page: `npm run build`, committed).
- `src/lib/`: everything that is not drawing. `deck.ts` (model + geometry), `planner.ts`,
  `motion.ts`, `checks.ts`, `kinematics.ts` + `robots.ts`, `runtimeDeck.ts` (export format),
  `generator.ts`, `parser.ts`, `teach.ts`, `storage.ts`, `demo.ts`.
- `src/components/3d/`: the scene; `src/components/ui/`: the panels; `src/state.tsx`: the store
  (undo/redo, selection, and the per-frame `arm` ref the scene reads, kept out of React state).
- `public/*.urdf`: ros-industrial URDFs; `scripts/make_e_series_urdf.py` derives UR5e/UR10e from
  UR3e. The `.glb` files in `public/` are unused (kept out of the package by `.gitignore`).

## Commands

```bash
npm install && npm run dev      # editor
npm test                        # vitest (needs python3 on PATH for the export tests)
npm run build                   # tsc -b && vite build -> arm_loc_helper/static (dist/ when VERCEL=1)
npx oxlint src
uv venv && uv pip install -e ".[test]" && .venv/bin/python -m pytest
```

`tests/test_plugin.py` also checks the page under ivoryos-next when `ivoryos_edge` is installed
(e.g. with the `.venv` of a sibling checkout that has it).
