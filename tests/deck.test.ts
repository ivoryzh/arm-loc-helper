import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject } from '../src/lib/checks';
import { CATALOG, approachMatrix, className, makeComponent, slotMatrix, slug, tiltFromSkill, type Project } from '../src/lib/deck';
import { demoProject } from '../src/lib/demo';
import { generatePython, pyLiteral } from '../src/lib/generator';
import { multiply, rotX, rotY, toAxisAngle } from '../src/lib/mat4';
import { buildTrajectory } from '../src/lib/motion';
import { parseScript } from '../src/lib/parser';
import { plan, type Action, type ArmState } from '../src/lib/planner';
import { exportDeck, safePointJoints } from '../src/lib/runtimeDeck';

const RUNTIME = readFileSync(new URL('../arm_loc_helper/runtime.py', import.meta.url), 'utf8');

describe('the deck model', () => {
  it('puts tray slots row by row along the turned component', () => {
    const p = demoProject();
    const tray = { ...p.components.find((c) => c.id === 'vial_tray')!, yaw: 90 };
    const s5 = slotMatrix(tray, 5); // row 1, col 1
    expect(s5[3]).toBeCloseTo(tray.x - tray.rowPitch, 9);
    expect(s5[7]).toBeCloseTo(tray.y + tray.colPitch, 9);
    expect(s5[10]).toBeCloseTo(-1, 9); // tool z straight down
    expect(approachMatrix(tray, 5)[11]).toBeCloseTo(tray.z + tray.approach, 9);
  });

  it('loads a side rack along its insertion axis and backs out along it', () => {
    const rack = demoProject().components.find((c) => c.id === 'slide_rack')!; // yaw 180: insertion along -x
    const s = slotMatrix(rack, 2), a = approachMatrix(rack, 2);
    expect([s[2], s[6], s[10]].map((v) => +v.toFixed(9))).toEqual([-1, 0, 0]); // tool z along -x
    expect(s[11]).toBeCloseTo(rack.z + 2 * rack.rowPitch, 9); // levels go up
    expect(a[3] - s[3]).toBeCloseTo(rack.approach, 9); // out toward +x, at the same height
    expect(a[11]).toBeCloseTo(s[11], 9);
  });

  it('names things as Python can', () => {
    expect(slug('Vial tray #2')).toBe('vial_tray_2');
    expect(slug('96 well plate')).toBe('_96_well_plate');
    expect(className('colour-match deck')).toBe('ColourMatchDeckArm');
    expect(pyLiteral({ a: [1, 2.5], b: true, c: null, d: 'x"y' })).toBe('{\n    "a": [1, 2.5],\n    "b": True,\n    "c": None,\n    "d": "x\\"y",\n}');
  });
});

describe('checks', () => {
  it('finds nothing wrong with the demo deck', () => {
    const errors = checkProject(demoProject()).filter((f) => f.level !== 'tip');
    expect(errors, errors.map((f) => f.title).join('\n')).toEqual([]);
  });

  it('flags a tilted taught pose and snaps it back', () => {
    const p = demoProject();
    const tray = p.components[0];
    tray.taught = toAxisAngle(multiply(rotY(0.05), rotX(Math.PI))); // tool down, tipped 2.9 deg
    tray.taughtFrom = 'Waypoint_1';
    expect(tiltFromSkill(tray)).toBeGreaterThan(2);
    const f = checkProject(p).find((x) => x.target === 'vial_tray' && /off vertical/.test(x.title))!;
    expect(f.level).toBe('warning');
    const fixed = f.fix!.apply(p);
    expect(fixed.components[0].taught).toBeUndefined();
  });

  it('flags slots out of reach and safe points cut off from home', () => {
    const p = demoProject();
    p.components[0].x = 1.2;
    p.safePoints[2].links = [];
    p.safePoints[0].links = ['left'];
    const titles = checkProject(p).filter((f) => f.level === 'error').map((f) => f.title);
    expect(titles).toContain('Vial tray: out of reach');
    expect(titles).toContain('Right is cut off from home');
  });

  it('places a dropped component and enters it from the nearest safe point', () => {
    const p = demoProject();
    const c = makeComponent(CATALOG[0], p, -0.3, 0.25);
    expect(c.id).toBe('vial_tray_2');
    expect(c.safePoint).toBe('right');
  });
});

describe('the motion preview', () => {
  it('plays every transfer on the demo deck without leaving reach or flipping the wrist', () => {
    const p = demoProject();
    const deck = exportDeck(p);
    const start = safePointJoints(p.safePoints[0], p)!;
    const locs = Object.keys(deck.locations);
    for (const a of locs) for (const b of locs) {
      if (a === b) continue;
      const last = deck.locations[b].slots.length - 1;
      const steps = plan(deck, 'transfer', { kind: 'safe', name: 'home' }, a, deck.locations[a].slots.length - 1, b, last);
      const t = buildTrajectory(p, steps, start);
      expect(t.error, `${a} -> ${b}: ${t.error?.message}`).toBeNull();
      expect(t.total).toBeGreaterThan(1);
    }
  });
});

describe('the .script parser', () => {
  it('pairs Polyscope waypoints, reads the TCP and the move order', () => {
    const src = `def Program():
  set_tcp(p[0.0,0.0,0.155,0.0,0.0,0.0])
  global Waypoint_1_p=p[.32, .2, .1, 0.0, 3.1416, 0.0]
  global Waypoint_1_q=[0.71, -1.6, 1.9, -1.87, -1.57, 0.0]
  global home_q = [0, -1.57, 1.57, -1.57, -1.57, 0]
  global flags = [True, False]
  movej(home_q, a=1.4, v=1.05)
  movej(get_inverse_kin(Waypoint_1_p, qnear=Waypoint_1_q), a=1.39, v=1.04)
  movel(Waypoint_1_p, a=1.2, v=0.25)
end`;
    const { waypoints, script } = parseScript(src);
    expect(waypoints.map((w) => w.name)).toEqual(['Waypoint_1', 'home']);
    expect(waypoints[0].pose).toEqual([0.32, 0.2, 0.1, 0, 3.1416, 0]);
    expect(waypoints[0].q?.[0]).toBe(0.71);
    expect(waypoints[1].pose).toBeUndefined();
    expect(script.tcp).toEqual([0, 0, 0.155, 0, 0, 0]);
    expect(script.sequence).toEqual([
      { move: 'movej', target: 'home' }, { move: 'movej', target: 'Waypoint_1' }, { move: 'movel', target: 'Waypoint_1' },
    ]);
  });
});

// --- the exported Python, run for real ------------------------------------------------------------

const python = ['python3', 'python'].find((cmd) => spawnSync(cmd, ['--version']).status === 0);

describe.skipIf(!python)('the exported controller', () => {
  const p: Project = demoProject();
  const source = generatePython(p, RUNTIME, 'demo_deck_arm');
  const dir = mkdtempSync(join(tmpdir(), 'arm-loc-'));
  writeFileSync(join(dir, 'demo_deck_arm.py'), source);

  type Case = { action: Action; args: [string?, number?, string?, number?]; from: string | [string, number, boolean] };
  const cases: Case[] = [
    { action: 'pick', args: ['vial_tray', 7], from: 'home' },
    { action: 'transfer', args: ['vial_tray', 3, 'slide_rack', 2], from: 'home' },
    { action: 'transfer', args: ['slide_rack', 0, 'capper', 0], from: 'left' },
    { action: 'place', args: ['vial_tray', 1], from: ['vial_tray', 5, true] },
    { action: 'home', args: [], from: ['slide_rack', 1, false] },
    { action: 'safe_point', args: ['right'], from: ['balance', 0, true] },
    { action: 'move_to', args: ['balance', 0], from: 'right' },
  ];

  const run = (code: string) => {
    const r = spawnSync(python!, ['-c', code], { cwd: dir, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout;
  };

  it('compiles and runs its own dry run', () => {
    const out = run('import runpy; runpy.run_path("demo_deck_arm.py", run_name="__main__")');
    expect(out).toMatch(/transfer\('vial_tray', 'balance', 0, 0\)/);
    expect(out).toMatch(/home\(\)/);
  });

  it('plans exactly the moves the editor previews', () => {
    const py = `
import json
from demo_deck_arm import DemoDeckArm
arm = DemoDeckArm()
out = []
for c in json.loads(${JSON.stringify(JSON.stringify(cases))}):
    f = c["from"]
    arm._at = ("safe", f) if isinstance(f, str) else ("loc", f[0], f[1], f[2])
    a = c["args"]
    out.append(arm.plan(c["action"], *a))
print(json.dumps(out))`;
    const fromPython = JSON.parse(run(py)) as { kind: string; name: string; target: number[] | null; slow: boolean }[][];
    const deck = exportDeck(p);
    cases.forEach((c, i) => {
      const from: ArmState = typeof c.from === 'string' ? { kind: 'safe', name: c.from } : { kind: 'loc', name: c.from[0], index: c.from[1], down: c.from[2] };
      const ts = plan(deck, c.action, from, ...c.args).map(({ after: _after, ...s }) => s);
      expect(fromPython[i].map((s) => `${s.kind} ${s.name}`), c.action).toEqual(ts.map((s) => `${s.kind} ${s.name}`));
      fromPython[i].forEach((s, k) => {
        expect(s.slow).toBe(ts[k].slow);
        if (s.target) s.target.forEach((v, j) => expect(v).toBeCloseTo(ts[k].target![j], 12));
      });
    });
  });

  it('types its methods for IvoryOS: locations as a Literal, one pick and place per location', () => {
    expect(source).toMatch(/^LocationName = Literal\["vial_tray", "balance", "capper", "slide_rack"\]$/m);
    expect(source).toMatch(/def pick_from_vial_tray\(self, index: int = 0\) -> None:/);
    expect(source).toMatch(/def place_on_balance\(self\) -> None:/);
    expect(source).toMatch(/def place_in_slide_rack\(self, index: int = 0\) -> None:/);
    expect(source).not.toMatch(/hplc/); // an obstacle has no slots
  });
});
