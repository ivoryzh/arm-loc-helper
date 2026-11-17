import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkProject } from '../src/lib/checks';
import { demoProject } from '../src/lib/demo';
import { slotMatrix, tiltFromSkill } from '../src/lib/deck';
import { column, fromPose, invertRigid, multiply, toAxisAngle } from '../src/lib/mat4';
import { exportDeck } from '../src/lib/runtimeDeck';
import { normalizeProject } from '../src/lib/storage';
import { BRACKET_90, CLOSED_GAP, FLANGE_RADIUS, MOUNT_FINGER_AXIS, TOOLS, TOOL_IDS, TOOL_PACKAGES, closedGap, fingerAxisOf, fingerJoint, gripFrame, mountLabel, mountOf, mountTcp, pinMiddle, placeTool } from '../src/lib/tools';

describe('end effectors', () => {
  it('reads a mount back from the TCP it sets', () => {
    for (const id of TOOL_IDS) {
      expect(mountOf(mountTcp(TOOLS[id], 'straight'), TOOLS[id])).toBe('straight');
      expect(mountOf(mountTcp(TOOLS[id], 'right_angle'), TOOLS[id])).toBe('right_angle');
    }
    expect(mountOf([0, 0, 0.175, 0, 0, 0], TOOLS.hand_e)).toBe('custom');
    // a preset that went through the inspector's fields (degrees to two places) is still that preset
    const typed = mountTcp(TOOLS.hand_e, 'right_angle').map((v, i) => (i < 3 ? v : (+((v * 180) / Math.PI).toFixed(2) * Math.PI) / 180));
    expect(mountOf(typed, TOOLS.hand_e)).toBe('right_angle');
  });

  it('lays the gripper across the flange on the 90° bracket', () => {
    const tcp = mountTcp(TOOLS.hand_e, 'right_angle');
    const m = fromPose(tcp);
    expect(column(m, 2).map((v) => +v.toFixed(5) || 0)).toEqual([0, -1, 0]); // tool z along the flange's -y
    expect(column(m, 0).map((v) => +v.toFixed(5) || 0)).toEqual([0, 0, 1]);  // tool x along the flange's axis
    expect(tcp[1]).toBeCloseTo(-(BRACKET_90.reach + TOOLS.hand_e.length), 6);
    const placed = placeTool(tcp, TOOLS.hand_e);
    expect(placed.length).toBe(TOOLS.hand_e.length);
    expect(placed.mount).toMatchObject({ kind: 'bracket' });
    if (placed.mount.kind === 'bracket') {
      expect(placed.mount.turn).toBeCloseTo(-Math.PI / 2, 5);
      expect(placed.mount.reach).toBeCloseTo(BRACKET_90.reach, 6); // the gripper's base, on the bracket's face
      expect(placed.mount.depth).toBeCloseTo(BRACKET_90.depth, 6);
      expect(placed.mount.spacer).toBeCloseTo(0, 6);                // the real bracket, nothing between
    }
    // just the gripper: its TCP is on its own axis, at its fingertips
    expect(placed.tip).toEqual([0, 0, 0]);
    expect(tcp[2]).toBeCloseTo(BRACKET_90.depth, 6);
  });

  it('reaches past the gripper with pins only on the pin fingers', () => {
    const pins = TOOLS.hand_e_pins, tcp = mountTcp(pins, 'right_angle'), FINGER_DROP = pins.rods!.reach;
    expect(tcp[2]).toBeCloseTo(BRACKET_90.depth + FINGER_DROP, 6);
    const placed = placeTool(tcp, pins);
    // the gripper stays on the bracket; its fingertips are back along tool x (the flange's axis) from the TCP
    expect(placed.mount).toMatchObject({ kind: 'bracket' });
    if (placed.mount.kind === 'bracket') {
      expect(placed.mount.depth).toBeCloseTo(BRACKET_90.depth, 6);
      expect(placed.mount.spacer).toBeCloseTo(0, 6);
    }
    // and the TCP is in the middle of the four pins, which are a little back from the fingertips
    expect(pinMiddle(pins.rods!)).toBeCloseTo(0.011, 9);
    expect(-tcp[1]).toBeCloseTo(BRACKET_90.reach + pins.length - 0.011, 6);
    expect(placed.tip[0]).toBeCloseTo(-FINGER_DROP, 6);
    expect(placed.tip[1]).toBeCloseTo(0, 6);
    expect(placed.tip[2]).toBeCloseTo(0.011, 6);
    expect(placeTool([0, 0, pins.length, 0, 0, 0], pins).tip).toEqual([0, 0, 0]);

    // the same TCP on the standard fingers is a gripper hung that much lower, with no pins
    const plain = placeTool(tcp, TOOLS.hand_e);
    expect(plain.tip).toEqual([0, 0, 0]);
    expect(plain.mount).toMatchObject({ kind: 'bracket' });
    if (plain.mount.kind === 'bracket') {
      expect(plain.mount.depth).toBeCloseTo(BRACKET_90.depth + FINGER_DROP, 6);
      expect(plain.mount.spacer).toBeNull(); // deeper than the real bracket: a stand-in is drawn
    }
    for (const id of TOOL_IDS) expect(!!TOOLS[id].rods, id).toBe(id === 'hand_e_pins');
    // the pins are part of the gripper: a fixed length out of the bosses, not stretched to the TCP
    expect(pins.rods!.reach + pins.rods!.past).toBeGreaterThan(pins.rods!.from);
    // turning the gripper on the bracket leaves it on the bracket: only its fingers and pins turn
    expect(placeTool(tcp, pins, 'x')).toEqual(placeTool(tcp, pins, 'y'));
  });

  it('draws a bracket for a 90° TCP taught on a real arm, a few mm off the preset', () => {
    const taught = [0.00629, -0.20662, 0.07706, 1.2092, -1.2092, 1.2092];
    expect(mountOf(taught, TOOLS.hand_e)).toBe('custom');
    const { mount } = placeTool(taught, TOOLS.hand_e);
    expect(mount).toMatchObject({ kind: 'bracket' });
    if (mount.kind === 'bracket') expect(mount.turn).toBeCloseTo(-Math.PI / 2, 4);
    // with the pin fingers it was taught with, the real bracket holds it: its pins reach the TCP, and
    // the 18.6 mm it is further out than the model's pins shows as a coupling on the bracket's face
    const pinned = placeTool(taught, TOOLS.hand_e_pins);
    expect(pinned.mount).toMatchObject({ kind: 'bracket' });
    if (pinned.mount.kind === 'bracket') {
      expect(pinned.mount.depth).toBeCloseTo(BRACKET_90.depth, 6);
      expect(pinned.mount.spacer).toBeCloseTo(0.20662 + 0.011 - TOOLS.hand_e_pins.length - BRACKET_90.reach, 4);
    }
    expect(mountTcp(TOOLS.hand_e_pins, 'right_angle')[2]).toBeCloseTo(taught[2], 3); // the preset's pins reach as far
  });

  it('ships the bracket\'s mesh, sized as the preset assumes', () => {
    const stl = readFileSync(new URL(`../public/${BRACKET_90.mesh}`, import.meta.url));
    const count = stl.readUInt32LE(80);
    expect(stl.length).toBe(84 + 50 * count);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) for (let k = 0; k < 9; k++) {
      const v = stl.readFloatLE(84 + 50 * i + 12 + 4 * k);
      lo[k % 3] = Math.min(lo[k % 3], v);
      hi[k % 3] = Math.max(hi[k % 3], v);
    }
    expect(hi[0]).toBeCloseTo(BRACKET_90.reach, 5);             // the face the gripper bolts to
    expect(lo[0]).toBeCloseTo(-FLANGE_RADIUS, 4);               // round the flange on the other side
    expect([lo[1], hi[1]].map((v) => +v.toFixed(4))).toEqual([-FLANGE_RADIUS, FLANGE_RADIUS]);
    expect(lo[2]).toBeCloseTo(-0.003, 5);                       // its centring boss, into the flange
    expect(hi[2]).toBeGreaterThan(BRACKET_90.depth + 0.025);    // the upright, past the gripper's bolt circle
  });

  it('fills a gap to the flange with a spacer, and anything odd with a strut', () => {
    expect(placeTool([0, 0, TOOLS.hand_e.length, 0, 0, 0], TOOLS.hand_e).mount).toEqual({ kind: 'none' });
    expect(placeTool([0, 0, 0.2, 0, 0, 0], TOOLS.hand_e).mount).toMatchObject({ kind: 'adapter' });
    expect(placeTool([0.1, 0.05, 0.2, 0.4, 0, 0], TOOLS.hand_e).mount.kind).toBe('strut');
    // a TCP shorter than the tool does not shorten it
    expect(placeTool([0, 0, 0.12, 0, 0, 0], TOOLS.hand_e)).toMatchObject({ length: TOOLS.hand_e.length, tip: [0, 0, 0], tilt: 0 });
  });

  it('turns the RG2 and RG6 on their own bracket instead of adding one', () => {
    for (const rg of [TOOLS.rg2, TOOLS.rg6]) {
      const { pivot } = rg.tilt!;
      expect(mountLabel(rg, 'right_angle')).not.toMatch(/bracket \(/);
      expect(mountLabel(TOOLS.hand_e, 'right_angle')).toMatch(/90° bracket/);
      expect(mountLabel(rg, 'straight')).toBe(mountLabel(TOOLS.hand_e, 'straight'));

      // straight: the bracket on the flange, nothing between, no tilt
      expect(placeTool(mountTcp(rg, 'straight'), rg)).toEqual({ length: rg.length, tip: [0, 0, 0], tilt: 0, mount: { kind: 'none' } });

      // tilted 90°: the gripper swings about its pivot to lie along the flange's -y, level with the pivot
      const tcp = mountTcp(rg, 'right_angle');
      expect(tcp.slice(0, 3)).toEqual([0, -(rg.length - pivot), pivot].map((v) => +v.toFixed(6)));
      expect(column(fromPose(tcp), 2).map((v) => +v.toFixed(5) || 0)).toEqual([0, -1, 0]);
      const placed = placeTool(tcp, rg, MOUNT_FINGER_AXIS.right_angle);
      expect(placed.tilt).toBeCloseTo(Math.PI / 2, 4);
      expect(placed.mount).toEqual({ kind: 'none' }); // its bracket lands on the flange: no 90° bracket, no pins
      expect(placed.tip).toEqual([0, 0, 0]);
      expect(placed.length).toBe(rg.length);

      // a tilt between the presets is still its own bracket, on the flange
      const a = Math.PI / 6, reach = rg.length - pivot;
      const part = placeTool([0, -reach * Math.sin(a), pivot + reach * Math.cos(a), a, 0, 0], rg);
      expect(Math.abs(part.tilt)).toBeCloseTo(a, 6); // which way round depends on how the gripper is turned
      expect(part.mount).toEqual({ kind: 'none' });
      // a TCP its bracket cannot reach from the flange gets a strut, not a made-up bracket
      expect(placeTool(tcp.map((v, i) => (i === 2 ? v + 0.05 : v)), rg, 'y').mount.kind).toBe('strut');

      const urdf = readFileSync(new URL(`../public/${rg.model!.urdf}`, import.meta.url), 'utf8');
      expect(urdf).toContain(`<joint name="${rg.tilt!.joint}"`);
      // the drawing turns the bracket about the same axis: `pivot` out from the flange, and the
      // bracket's mesh hung back from there by as much
      const z = (after: string) => +urdf.split(after)[1].match(/<origin xyz="0 0 (-?[\d.]+)"/)![1];
      expect(z('<joint name="body_joint"') + z(`<joint name="${rg.tilt!.joint}"`)).toBeCloseTo(pivot, 6);
      expect(z('<link name="bracket">')).toBeCloseTo(-pivot, 6);
      // its fingers lie along the tilt axis whatever the deck's setting says
      expect(fingerAxisOf(tcp, rg, 'x')).toBe('y');
      expect(fingerAxisOf(mountTcp(rg, 'straight'), rg, 'y')).toBe('x');
      expect(placeTool(tcp, rg, fingerAxisOf(tcp, rg, 'x')).mount).toEqual({ kind: 'none' });
      expect(fingerAxisOf(tcp, TOOLS.hand_e, 'x')).toBe('x'); // on the others it is the user's to set
    }
    // the RG2 turns about the middle of its bracket's rings of holes, 39 mm from the flange and 11 mm
    // behind the body's origin, where the body's own holes bolt on
    expect(TOOLS.rg2.tilt!.pivot).toBe(0.039);
    expect(mountTcp(TOOLS.rg2, 'right_angle').slice(0, 3)).toEqual([0, -0.1737, 0.039]);
    // and the tools that do not tilt keep their bracket
    expect(placeTool(mountTcp(TOOLS.hand_e, 'right_angle'), TOOLS.hand_e, 'y').mount.kind).toBe('bracket');
  });

  it('drives the real models\' fingers from the gap, and ships a URDF for each', () => {
    expect(fingerJoint(TOOLS.hand_e, 0.05)).toBeCloseTo(0.025, 9);  // each finger half the gap from the middle
    expect(fingerJoint(TOOLS.hand_e, 0)).toBe(0);
    expect(fingerJoint(TOOLS['2f_85'], 0.085)).toBe(0);              // open is the knuckle's zero
    expect(fingerJoint(TOOLS['2f_85'], 0)).toBeCloseTo(0.7929, 9);
    expect(fingerJoint(TOOLS['2f_140'], 1)).toBe(0);                 // never past the stroke
    // the RG6's fingers swing on an 80 mm arm: closed and fully open are its own joint values, and
    // the gap between follows the arm's angle (2 * arm * cos), not an even split
    const rg6 = TOOLS.rg6.model!;
    expect(fingerJoint(TOOLS.rg6, 0)).toBeCloseTo(rg6.closed, 6);
    expect(fingerJoint(TOOLS.rg6, TOOLS.rg6.stroke)).toBeCloseTo(rg6.open, 5);
    expect(fingerJoint(TOOLS.rg6, 1)).toBeCloseTo(rg6.open, 5);
    for (const gap of [0.02, 0.075, 0.13]) {
      const q = fingerJoint(TOOLS.rg6, gap)!;
      const drawn = 2 * rg6.swing!.arm * (Math.cos(q + rg6.swing!.phase) - Math.cos(rg6.closed + rg6.swing!.phase));
      expect(drawn).toBeCloseTo(gap, 9);
    }
    expect(rg6.open).toBeGreaterThan(0);         // inside the URDF's joint limits
    expect(rg6.closed).toBeLessThan(1.3);
    // the RG2 is the same linkage on a 55 mm arm
    const rg2 = TOOLS.rg2.model!;
    expect(rg2.swing!.arm).toBeCloseTo(0.055, 5);
    expect(fingerJoint(TOOLS.rg2, 0)).toBeCloseTo(rg2.closed, 6);
    expect(fingerJoint(TOOLS.rg2, TOOLS.rg2.stroke)).toBeCloseTo(rg2.open, 4);
    expect(rg2.open).toBeGreaterThan(0);
    expect(rg2.closed).toBeLessThan(1.3);
    for (const id of TOOL_IDS) {
      const model = TOOLS[id].model;
      if (!model) continue;
      const urdf = readFileSync(new URL(`../public/${model.urdf}`, import.meta.url), 'utf8');
      expect(urdf).toContain(`<joint name="${model.joint}"`);
      // every mesh comes from a package the page knows where to find
      const packages = [...urdf.matchAll(/package:\/\/(\w+)\//g)].map((m) => m[1]);
      expect(packages.length).toBeGreaterThan(0);
      for (const name of packages) expect(Object.keys(TOOL_PACKAGES)).toContain(name);
      // and any other mesh ships next to the URDF
      for (const [, file] of urdf.matchAll(/<mesh filename="(?!package:)([^"]+)"/g)) {
        expect(existsSync(new URL(`../public/${file}`, import.meta.url)), file).toBe(true);
      }
    }
  });

  it('keeps the tool out of the exported deck and defaults it in older saves', () => {
    const p = demoProject();
    p.gripper.model = '2f_140';
    expect(exportDeck(p).gripper).toEqual({ type: 'robotiq', speed: 255, force: 100 });
    expect(normalizeProject(JSON.parse(JSON.stringify(p))).gripper.model).toBe('2f_140');
    const old = JSON.parse(JSON.stringify(p));
    delete old.gripper.model;
    expect(normalizeProject(old).gripper.model).toBe('hand_e');
    expect(normalizeProject({ ...old, gripper: { ...old.gripper, model: 'generic' } }).gripper.model).toBe('hand_e'); // the stand-in is gone
    expect(mountOf(demoProject().robot.tcp, TOOLS[demoProject().gripper.model])).toBe('straight');
    expect(normalizeProject(old).gripper.fingerAxis).toBe('x');
    expect(normalizeProject({ ...old, gripper: { ...old.gripper, fingerAxis: 'y' } }).gripper.fingerAxis).toBe('y');
  });

  it('still reaches the demo deck top-down with a Hand-E on the 90° bracket', () => {
    const p = demoProject();
    p.gripper.model = 'hand_e';
    p.robot.tcp = mountTcp(TOOLS.hand_e, 'right_angle');
    const errors = checkProject(p).filter((f) => f.level === 'error');
    expect(errors, errors.map((f) => f.title).join('\n')).toEqual([]);
  });

  it('picks from above with the pins hanging over the item, and closes them onto it', () => {
    const pins = TOOLS.hand_e_pins, rods = pins.rods!;
    // a gripper grips along its own axis; only pin fingers out at their pins grip another way
    for (const id of TOOL_IDS) for (const mount of ['straight', 'right_angle'] as const) {
      const g = gripFrame(mountTcp(TOOLS[id], mount), TOOLS[id]);
      expect(g[0] === 1 && g[5] === 1 && g[10] === 1, `${id} ${mount}`).toBe(!(id === 'hand_e_pins' && mount === 'right_angle'));
    }

    const taught = [0.00629, -0.20662, 0.07706, 1.2092, -1.2092, 1.2092];
    for (const tcp of [mountTcp(pins, 'right_angle'), taught]) {
      const p = demoProject();
      p.gripper.model = 'hand_e_pins';
      p.robot.tcp = tcp;
      const tray = p.components.find((c) => c.id === 'vial_tray')!;
      const slot = slotMatrix(tray, 3, p), plain = slotMatrix(tray, 3, demoProject());
      expect([slot[3], slot[7], slot[11]]).toEqual([plain[3], plain[7], plain[11]]); // the TCP is where it was
      const flange = multiply(slot, invertRigid(fromPose(tcp)));
      expect(column(flange, 2)[2]).toBeCloseTo(-1, 6);   // the wrist points down, and the pins with it
      expect(slot[10]).toBeCloseTo(0, 6);                // and the gripper lies flat
      expect(slot[2]).toBeCloseTo(1, 6);                 // along the tray's x
      // safe points carry the tool the same way, so going in is not a turn of the wrist
      const safe = fromPose(exportDeck(p).safe_points.left.pose);
      expect(column(multiply(safe, invertRigid(fromPose(tcp))), 2)[2]).toBeCloseTo(-1, 5);
      // and a pose taught that way is square to its tray, not 90° off
      tray.taught = toAxisAngle(slot);
      expect(tiltFromSkill(tray, p)).toBeLessThan(1e-3);
      expect(checkProject(p).filter((f) => /off vertical/.test(f.title))).toEqual([]);
    }

    // closed on a vial, each of the four pins touches it
    for (const d of [0.016, 0.0216, 0.028]) {
      const gap = closedGap(pins, d, true);
      expect(Math.hypot(gap / 2 + rods.offset, 0.005)).toBeCloseTo(d / 2 + rods.radius, 9);
    }
    expect(closedGap(pins, 0.008, true)).toBe(0);                         // too thin for them: fingers together
    expect(closedGap(TOOLS.hand_e, 0.02)).toBe(0.02);                     // fingers close to the item's width
    expect(closedGap(TOOLS.hand_e, 0.0855)).toBe(TOOLS.hand_e.stroke);    // or as far as they go
    expect(closedGap(TOOLS.hand_e, null)).toBe(CLOSED_GAP);
  });
});
