// Turns a plan into what the arm does over time, the way a UR moves: a movej interpolates the
// joints (to the exact joints of a safe point, or to the IK solution nearest the current joints
// for a pose, as moveJ_IK does on the robot), a movel keeps the TCP on a straight line (IK every
// few millimetres, each solution nearest the last). Unreachable stretches and wrist flips are
// found here, before anything plays.
import { fk, ik, nearest, unwrapTo, jointDistance, type Joints } from './kinematics';
import { fromPose, interpolate, multiply, type Mat4 } from './mat4';
import type { PlanStep } from './planner';
import { ROBOTS } from './robots';
import { flangeToTcp, tcpToFlange } from './runtimeDeck';
import type { Project } from './deck';

export interface Segment {
  step: PlanStep;
  duration: number;
  samples: Joints[];      // evenly spaced in time, first = start, last = end
  gripFrom: number;       // 1 open .. 0 closed
  gripTo: number;
}

export interface Trajectory {
  segments: Segment[];
  total: number;
  error: { step: number; message: string } | null;
  end: Joints;
}

const GRIP_SECONDS = 0.5;
const ramp = (v: number, a: number) => v / Math.max(a, 1e-6); // time lost speeding up and slowing down

export function buildTrajectory(p: Project, steps: PlanStep[], start: Joints, startGrip = 1): Trajectory {
  const params = ROBOTS[p.robot.model].params;
  const T_FT = flangeToTcp(p);
  const m = p.motion;
  const segments: Segment[] = [];
  let q = [...start] as Joints;
  let grip = startGrip;

  for (let si = 0; si < steps.length; si++) {
    const step = steps[si];
    if (step.kind === 'gripper') {
      const to = step.name === 'open' ? 1 : 0;
      segments.push({ step, duration: GRIP_SECONDS, samples: [q, q], gripFrom: grip, gripTo: to });
      grip = to;
      continue;
    }
    if (step.kind === 'movej' || step.kind === 'movej_pose') {
      let target: Joints | null;
      if (step.kind === 'movej') target = step.target as Joints;
      else target = nearest(ik(tcpToFlange(fromPose(step.target!), p), params), q);
      if (!target) return fail(segments, si, `${step.name} is out of reach`, q);
      const d = jointDistance(q, target);
      const duration = Math.max(0.3, d / m.joint_speed + ramp(m.joint_speed, m.joint_accel));
      const n = Math.max(2, Math.ceil(duration * 30));
      const from = q;
      const samples = Array.from({ length: n + 1 }, (_, k) => from.map((v, i) => v + (target![i] - v) * ease(k / n)) as Joints);
      segments.push({ step, duration, samples, gripFrom: grip, gripTo: grip });
      q = target;
      continue;
    }
    // movel: a straight line for the TCP
    const a = multiply(fk(q, params), T_FT);
    const b = fromPose(step.target!);
    const dist = Math.hypot(b[3] - a[3], b[7] - a[7], b[11] - a[11]);
    const v = step.slow ? m.approach_speed : m.linear_speed;
    const duration = Math.max(0.2, dist / v + ramp(v, m.linear_accel));
    const n = Math.max(2, Math.ceil(Math.max(dist / 0.004, duration * 30)));
    const samples: Joints[] = [q];
    let prev = q;
    for (let k = 1; k <= n; k++) {
      const tcp: Mat4 = interpolate(a, b, ease(k / n));
      const next = nearest(ik(tcpToFlange(tcp, p), params), prev);
      if (!next) return fail(segments, si, `the straight line to ${step.name} leaves the arm's reach`, q);
      if (jointDistance(unwrapTo(next, prev), prev) > 0.35) {
        return fail(segments, si, `the straight line to ${step.name} passes a singularity (the wrist would flip)`, q);
      }
      samples.push(next);
      prev = next;
    }
    segments.push({ step, duration, samples, gripFrom: grip, gripTo: grip });
    q = prev;
  }
  return { segments, total: segments.reduce((s, x) => s + x.duration, 0), error: null, end: q };
}

function fail(segments: Segment[], step: number, message: string, q: Joints): Trajectory {
  return { segments, total: segments.reduce((s, x) => s + x.duration, 0), error: { step, message }, end: q };
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Joints and gripper opening `t` seconds into a segment. */
export function sampleSegment(s: Segment, t: number): { q: Joints; grip: number } {
  const u = s.duration > 0 ? Math.min(1, Math.max(0, t / s.duration)) : 1;
  const x = u * (s.samples.length - 1);
  const i = Math.min(s.samples.length - 2, Math.floor(x));
  const f = x - i;
  const a = s.samples[i], b = s.samples[i + 1];
  return { q: a.map((v, j) => v + (b[j] - v) * f) as Joints, grip: s.gripFrom + (s.gripTo - s.gripFrom) * u };
}
