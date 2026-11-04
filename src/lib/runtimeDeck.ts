// The deck as the Python runtime reads it (arm_loc_helper/runtime.py): every slot as a URScript
// pose, approach offsets in the base frame, safe points with their joints. The editor's own
// project (deck.ts) keeps the higher-level description it is computed from.
import { approachVector, poseOf, safePointMatrix, skillOf, slotCount, slotMatrix, type Project, type SafePointDef } from './deck';
import { fk, restingSolution, type Joints } from './kinematics';
import { fromPose, invertRigid, multiply, type Mat4 } from './mat4';
import { ROBOTS } from './robots';

export interface RuntimeSafePoint { label: string; q?: number[]; q_from?: 'pendant' | 'model'; pose: number[]; links: string[] }

export interface RuntimeLocation {
  label: string;
  kind: string;
  skill: string;
  safe_point: string;
  approach: number[];
  slots: number[][];
  grid?: { rows: number; cols: number };
}

export interface RuntimeDeck {
  format: 'arm-loc-helper/deck@1';
  name: string;
  robot: { model: string; tcp: number[]; payload: number };
  gripper: Record<string, unknown>;
  motion: Record<string, number>;
  home: string;
  safe_points: Record<string, RuntimeSafePoint>;
  locations: Record<string, RuntimeLocation>;
}

/** Six decimals: a micrometre, a microradian. And no -0. */
export const r6 = (v: number) => Math.round(v * 1e6) / 1e6 || 0;
const round = (v: number[]) => v.map(r6);

export const flangeToTcp = (p: Project): Mat4 => fromPose(p.robot.tcp);

/** The flange (tool0) pose that puts the TCP at `tcp`. */
export const tcpToFlange = (tcp: Mat4, p: Project): Mat4 => multiply(tcp, invertRigid(flangeToTcp(p)));

/** The TCP at a safe point: from its taught joints, or tool-down at its position. */
export function safePointTcp(s: SafePointDef, p: Project): Mat4 {
  if (s.q) return multiply(fk(s.q, ROBOTS[p.robot.model].params), flangeToTcp(p));
  return safePointMatrix(s);
}

/** Joints for a safe point: the taught ones, or the arm's resting posture at its pose. */
export function safePointJoints(s: SafePointDef, p: Project): Joints | null {
  if (s.q) return s.q;
  return restingSolution(tcpToFlange(safePointMatrix(s), p), ROBOTS[p.robot.model].params);
}

export function exportDeck(p: Project): RuntimeDeck {
  const g = p.gripper;
  const gripper: Record<string, unknown> = g.type === 'robotiq'
    ? { type: 'robotiq', speed: g.speed, force: g.force }
    : g.type === 'digital_out'
      ? { type: 'digital_out', pin: g.pin, tool: g.tool, close_level: g.closeLevel }
      : { type: 'none' };

  const safe_points: Record<string, RuntimeSafePoint> = {};
  for (const s of p.safePoints) {
    const q = safePointJoints(s, p);
    const entry: RuntimeSafePoint = { label: s.label, pose: round(poseOf(safePointTcp(s, p))), links: [...s.links].sort() };
    if (q) {
      entry.q = round(q);
      entry.q_from = s.q ? 'pendant' : 'model';
    }
    safe_points[s.id] = entry;
  }

  const locations: Record<string, RuntimeLocation> = {};
  for (const c of p.components) {
    const skill = skillOf(c);
    if (!skill) continue;
    const loc: RuntimeLocation = {
      label: c.label,
      kind: c.kind,
      skill,
      safe_point: c.safePoint,
      approach: round(approachVector(c)),
      slots: Array.from({ length: slotCount(c) }, (_, i) => round(poseOf(slotMatrix(c, i)))),
    };
    if (c.kind !== 'station') loc.grid = { rows: c.rows, cols: c.cols };
    locations[c.id] = loc;
  }

  return {
    format: 'arm-loc-helper/deck@1',
    name: p.name,
    robot: { model: p.robot.model, tcp: round(p.robot.tcp), payload: p.robot.payload },
    gripper,
    motion: { ...p.motion },
    home: p.home,
    safe_points,
    locations,
  };
}
