// Closed-form kinematics of a Universal Robots arm (Hawkins 2013, as in ROS ur_kinematics), in the
// robot's own `base` frame (the pendant's) and for the URDF `tool0` frame (the flange), so a pose
// read off the teach pendant drops straight in. Joint order: shoulder_pan, shoulder_lift, elbow,
// wrist_1, wrist_2, wrist_3. Ported from Beaver's Bench, with the arm's lengths as a parameter.
//
// Convention (standard DH): A_i = RotZ(q_i) TransZ(d_i) TransX(a_i) RotX(alpha_i), alpha = [90, 0, 0, 90, -90, 0] deg.
import { chain, column, invertRigid, multiply, rotX, rotZ, translate, translation, type Mat4, type Vec3 } from './mat4';

export interface URParams {
  name: string;
  d1: number; a2: number; a3: number; d4: number; d5: number; d6: number;
}

export type Joints = [number, number, number, number, number, number];

function dh(theta: number, d: number, a: number, alpha: number): Mat4 {
  const ct = Math.cos(theta), st = Math.sin(theta);
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  return [ct, -st * ca, st * sa, a * ct, st, ct * ca, -ct * sa, a * st, 0, sa, ca, d, 0, 0, 0, 1];
}

const HALF_PI = Math.PI / 2;

function links(q: Joints, p: URParams): Mat4[] {
  return [
    dh(q[0], p.d1, 0, HALF_PI),
    dh(q[1], 0, p.a2, 0),
    dh(q[2], 0, p.a3, 0),
    dh(q[3], p.d4, 0, HALF_PI),
    dh(q[4], p.d5, 0, -HALF_PI),
    dh(q[5], p.d6, 0, 0),
  ];
}

/** Forward kinematics: base -> tool0 (DH frame 6 is the URDF tool0 frame). */
export function fk(q: Joints, p: URParams): Mat4 {
  return chain(...links(q, p));
}

/** Positions of every joint origin, for a skeleton drawing. */
export function jointOrigins(q: Joints, p: URParams): Vec3[] {
  const out: Vec3[] = [[0, 0, 0]];
  let t = translate(0, 0, 0);
  for (const l of links(q, p)) {
    t = multiply(t, l);
    out.push(translation(t));
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** All inverse kinematics solutions (up to 8) for a base -> tool0 pose, each joint in (-pi, pi]. */
export function ik(tool0: Mat4, p: URParams): Joints[] {
  const T = tool0;
  const px = T[3], py = T[7], pz = T[11];
  const z6 = column(T, 2);
  const x6 = column(T, 0);
  const y6 = column(T, 1);
  const solutions: Joints[] = [];

  const p05: Vec3 = [px - p.d6 * z6[0], py - p.d6 * z6[1], pz - p.d6 * z6[2]];
  const r05 = Math.hypot(p05[0], p05[1]);
  if (r05 < Math.abs(p.d4) - 1e-9) return solutions;
  const psi = Math.atan2(p05[1], p05[0]);
  const phi = Math.acos(clamp(p.d4 / r05, -1, 1));

  for (const t1 of [psi + phi + HALF_PI, psi - phi + HALF_PI]) {
    const c1 = Math.cos(t1), s1 = Math.sin(t1);
    const c5 = clamp((px * s1 - py * c1 - p.d4) / p.d6, -1, 1);
    for (const t5 of [Math.acos(c5), -Math.acos(c5)]) {
      const s5 = Math.sin(t5);
      let t6: number;
      if (Math.abs(s5) < 1e-9) {
        t6 = 0; // wrist singularity: theta6 is free, keep it at zero
      } else {
        const sgn = s5 < 0 ? -1 : 1;
        t6 = Math.atan2(sgn * -(y6[0] * s1 - y6[1] * c1), sgn * (x6[0] * s1 - x6[1] * c1));
      }
      const T01 = dh(t1, p.d1, 0, HALF_PI);
      const T45 = dh(t5, p.d5, 0, -HALF_PI);
      const T56 = dh(t6, p.d6, 0, 0);
      const T14 = chain(invertRigid(T01), T, invertRigid(T56), invertRigid(T45));
      const x14 = T14[3], y14 = T14[7];
      const c3 = (x14 * x14 + y14 * y14 - p.a2 * p.a2 - p.a3 * p.a3) / (2 * p.a2 * p.a3);
      if (c3 < -1 - 1e-9 || c3 > 1 + 1e-9) continue; // out of reach
      for (const t3 of [Math.acos(clamp(c3, -1, 1)), -Math.acos(clamp(c3, -1, 1))]) {
        const s3 = Math.sin(t3);
        const t2 = Math.atan2(y14, x14) - Math.atan2(p.a3 * s3, p.a2 + p.a3 * Math.cos(t3));
        const T12 = dh(t2, 0, p.a2, 0);
        const T23 = dh(t3, 0, p.a3, 0);
        const T34 = multiply(invertRigid(multiply(T12, T23)), T14);
        const t4 = Math.atan2(T34[4], T34[0]);
        solutions.push([t1, t2, t3, t4, t5, t6].map(wrapPi) as Joints);
      }
    }
  }
  return solutions;
}

export function wrapPi(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/** Shift each joint by multiples of 2*pi so it lies within pi of the reference joint. */
export function unwrapTo(q: Joints, ref: Joints): Joints {
  return q.map((v, i) => {
    let x = v;
    while (x - ref[i] > Math.PI) x -= 2 * Math.PI;
    while (x - ref[i] < -Math.PI) x += 2 * Math.PI;
    return x;
  }) as Joints;
}

export function jointDistance(a: Joints, b: Joints): number {
  return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
}

/** The solution closest (in joint space) to `ref`: what a movej to a pose does on the robot. */
export function nearest(solutions: Joints[], ref: Joints, prefer?: (q: Joints) => boolean): Joints | null {
  let best: Joints | null = null;
  let bestD = Infinity;
  for (const s of solutions) {
    if (prefer && !prefer(s)) continue;
    const u = unwrapTo(s, ref);
    const d = u.reduce((acc, v, i) => acc + (v - ref[i]) ** 2, 0);
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

/** A pose with the tool pointing straight down and its x axis along `heading` (radians about z). */
export function toolDown(x: number, y: number, z: number, heading: number): Mat4 {
  return chain(translate(x, y, z), rotZ(heading), rotX(Math.PI));
}

/** The usual UR "ready" posture: upper arm up, forearm forward, wrist pointing down. */
export const READY: Joints = [0, -Math.PI / 2, Math.PI / 2, -Math.PI / 2, -Math.PI / 2, 0];

/** Elbow above the shoulder line, the posture lab decks are taught in. */
export const elbowUp = (q: Joints) => q[1] < 0 && q[1] > -Math.PI;

/**
 * Joints for a TCP far from any current position (a safe point): the elbow-up solution closest to
 * READY turned to face the target, so every safe point is in the same, predictable posture.
 */
export function restingSolution(tool0: Mat4, p: URParams): Joints | null {
  const sols = ik(tool0, p);
  if (!sols.length) return null;
  const at = fk(READY, p);
  const facing = Math.atan2(tool0[7], tool0[3]) - Math.atan2(at[7], at[3]);
  const ref = [wrapPi(facing), ...READY.slice(1)] as Joints;
  return nearest(sols, ref, elbowUp) ?? nearest(sols, ref);
}
