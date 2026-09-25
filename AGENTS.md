# arm-loc-helper — Agent Guidelines

## What this is

A standalone, client-side-only Vite/React/Three.js tool ("URScript Visualizer"): drop in a Universal Robot `.script` file, it regex-parses named waypoints (`global VAR = p[x,y,z,rx,ry,rz]`) and the `movej/movel/movep` sequence, renders the UR3/5/10 arm and its path live in 3D (via `urdf-loader`, meshes pulled from a CDN — the repo only ships the tiny `.urdf` text files), lets you flag any waypoint as a grid (rows × cols × dx/dy spacing, for well-plate/vial-rack style indexed access), and generates + downloads a Python `ArmManager` class (`move_to_<name>()` / `move_to_<name>_grid(index)` methods). No backend — `server/` is dead scaffolding (an unused `ws` dependency, no actual server file); everything runs in the browser.

## It ships two ways — both from the exact same build

1. **Standalone**, deployed to Vercel at a domain root (`vercel.json`'s SPA rewrite).
2. **Embedded as an IvoryOS Core plugin** — see `/Users/ivoryzhang/PycharmProjects/ivoryos-nextgen` (a separate repo; Core's `AGENTS.md` section 10 documents the plugin contract in full). Build (`npm run build`), then copy `dist/` into Core's `example/plugins/arm_loc_helper/` — Core auto-discovers it on startup and shows it in an iframe.

**Why one build works for both**: `vite.config.ts` sets `base: './'` (relative asset paths), so the same `dist/` resolves correctly whether it's served from a domain root or mounted under a subpath like `/plugins/arm_loc_helper/`. **This is the one constraint that matters for any future change**: never hardcode an absolute runtime path (`fetch('/foo.json')`, `'/ur5.urdf'`, etc.) anywhere in `src/` — it bypasses Vite's `base` rewriting entirely and breaks the plugin deployment while looking fine standalone (since standalone happens to be served from `/` where an absolute path is indistinguishable from a relative one). Use `` `${import.meta.env.BASE_URL}foo.json` `` instead — see `src/components/3d/RobotArm.tsx`'s `modelUrl` construction for the existing pattern; this was a real bug found and fixed when the plugin integration was first wired up.

## Local development

```bash
npm install
npm run dev       # dev server
npm run build     # tsc -b && vite build -> dist/
npm run preview   # serve dist/ locally to sanity-check a production build
```

No test suite exists yet.
