import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fk, ik, nearest, restingSolution, toolDown, READY, elbowUp, type Joints } from '../src/lib/kinematics';
import { approxEqual, chain, fromPose, multiply, rotZ, rpyXyz, toPose, type Mat4 } from '../src/lib/mat4';
import { ROBOTS, ROBOT_IDS } from '../src/lib/robots';

// Forward kinematics straight from each URDF's joint table (the chain urdf-loader poses on screen),
// so the DH numbers in robots.ts are checked against what is drawn.
function urdfChain(file: string) {
  const xml = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
  const joints = new Map<string, { parent: string; child: string; type: string; rpy: number[]; xyz: number[] }>();
  for (const m of xml.matchAll(/<joint name="([^"]+)" type="(\w+)">([\s\S]*?)<\/joint>/g)) {
    const body = m[3];
    const origin = body.match(/<origin rpy="([^"]+)" xyz="([^"]+)"\s*\/>/) ?? body.match(/<origin xyz="([^"]+)" rpy="([^"]+)"\s*\/>/);
    const parent = body.match(/<parent link="([^"]+)"/)![1];
    const child = body.match(/<child link="([^"]+)"/)![1];
    const nums = (s: string) => s.trim().split(/\s+/).map(Number);
    const [rpy, xyz] = origin![0].startsWith('<origin rpy') ? [nums(origin![1]), nums(origin![2])] : [nums(origin![2]), nums(origin![1])];
    joints.set(child, { parent, child, type: m[2], rpy, xyz });
  }
  // walk back from tool0 to base_link
  const path: { type: string; rpy: number[]; xyz: number[] }[] = [];
  for (let link = 'tool0'; link !== 'base_link';) {
    const j = joints.get(link)!;
    expect(j, `${file}: no joint into ${link}`).toBeTruthy();
    path.unshift(j);
    link = j.parent;
  }
  return path;
}

function urdfFk(file: string, q: Joints): Mat4 {
  let k = 0;
  const parts = urdfChain(file).map((j) => {
    const t = rpyXyz(j.rpy[0], j.rpy[1], j.rpy[2], j.xyz[0], j.xyz[1], j.xyz[2]);
    return j.type === 'revolute' ? multiply(t, rotZ(q[k++])) : t;
  });
  expect(k).toBe(6);
  return chain(rotZ(Math.PI), ...parts); // base is base_link turned by pi about z
}

const samples: Joints[] = [
  [0, 0, 0, 0, 0, 0],
  [0, -Math.PI / 2, Math.PI / 2, -Math.PI / 2, -Math.PI / 2, 0],
  [0.3, -1.2, 1.9, -2.3, -1.4, 0.7],
  [-2.1, -0.4, 0.9, -1.0, 1.3, -2.5],
  [1.0, -2.6, -1.1, 0.4, 2.0, 3.0],
];

describe('forward kinematics', () => {
  for (const id of ROBOT_IDS) {
    it(`matches the joint table of ${ROBOTS[id].urdf}`, () => {
      for (const q of samples) {
        const a = fk(q, ROBOTS[id].params);
        const b = urdfFk(ROBOTS[id].urdf, q);
        expect(approxEqual(a, b, 5e-4), `${id} q=${q}\n dh=${a.map((v) => v.toFixed(4))}\n urdf=${b.map((v) => v.toFixed(4))}`).toBe(true);
      }
    });
  }

  it('draws every arm from the ros-industrial meshes', () => {
    for (const id of ROBOT_IDS) {
      const xml = readFileSync(new URL(`../public/${ROBOTS[id].urdf}`, import.meta.url), 'utf8');
      const meshes = [...xml.matchAll(/filename="([^"]+)"/g)].map((m) => m[1]);
      expect(meshes.length).toBeGreaterThan(6);
      for (const f of meshes) expect(f).toMatch(new RegExp(`^package://ur_description/meshes/${id.toLowerCase()}/`));
    }
  });
});

describe('inverse kinematics', () => {
  it('round-trips every solution through fk, for every arm', () => {
    for (const id of ROBOT_IDS) {
      const p = ROBOTS[id].params;
      for (const q of samples) {
        const target = fk(q, p);
        const sols = ik(target, p);
        expect(sols.length).toBeGreaterThan(0);
        for (const s of sols) expect(approxEqual(fk(s, p), target, 1e-6), `${id} q=${q} sol=${s}`).toBe(true);
        // all zeros is the arm stretched flat, singular at the elbow and the wrist at once: other
        // joints give the same pose there, so only the pose is compared
        if (q.every((v) => v === 0)) continue;
        const back = nearest(sols, q)!;
        expect(back.every((v, i) => Math.abs(v - q[i]) < 1e-6)).toBe(true);
      }
    }
  });

  it('finds the resting posture for a safe point: elbow up, facing the target', () => {
    const p = ROBOTS.UR5e.params;
    for (const [x, y] of [[0.4, 0.3], [-0.4, 0.3], [0, 0.45], [0.3, -0.4]]) {
      const target = toolDown(x, y, 0.3, 0);
      const q = restingSolution(target, p)!;
      expect(q).not.toBeNull();
      expect(elbowUp(q)).toBe(true);
      expect(approxEqual(fk(q, p), target, 1e-6)).toBe(true);
    }
    const q = restingSolution(fk(READY, p), p)!;
    expect(q.every((v, i) => Math.abs(v - READY[i]) < 1e-6)).toBe(true);
  });

  it('returns nothing out of reach', () => {
    expect(ik(toolDown(1.2, 0, 0.1, 0), ROBOTS.UR5e.params)).toHaveLength(0);
  });

  it('converts URScript poses both ways', () => {
    const pose = [0.1, -0.2, 0.3, 2.2, -2.2, 0.1];
    toPose(fromPose(pose)).forEach((v, i) => expect(v).toBeCloseTo(pose[i], 6));
  });
});
