// The deck being edited: the arm, its gripper, the components on the bench and the safe points
// between them. Lengths in metres, angles in degrees, in the robot's base frame (z up), the frame
// the teach pendant and URScript use. A component is placed by its first slot's grip point: where
// the TCP is when it holds the item in slot 0.
//
// Every component has a skill, the way the arm goes in and out of its slots:
//   top_down  the tool points straight down; approach straight above the slot (trays, plates,
//             balances, cappers: 99% of lab pick-and-place)
//   side_load the tool points horizontally along the component's insertion axis (+x of the
//             component); approach straight back out along it (a slide or plate rack with rails
//             parallel to the bench, an incubator hotel, a drawer)
import { chain, fromAxisAngle, rotY, rotZ, toAxisAngle, translate, type Mat4, type Vec3 } from './mat4';
import type { Joints } from './kinematics';
import type { RobotModelId } from './robots';

export type ComponentKind = 'tray' | 'station' | 'side_rack' | 'block';
export type Skill = 'top_down' | 'side_load';
export type GripperType = 'robotiq' | 'digital_out' | 'none';

export interface DeckComponent {
  id: string;                // a Python identifier, unique on the deck
  label: string;
  kind: ComponentKind;
  x: number; y: number; z: number; // slot 0's grip point (block: centre of its footprint, z unused)
  yaw: number;               // turn of the whole component about the base z axis
  rows: number;              // tray: along local y; side rack: levels along z
  cols: number;              // tray: along local x; side rack: along local y
  colPitch: number;
  rowPitch: number;
  approach: number;          // from the slot out to the approach point
  toolYaw: number;           // the gripper's turn about its own axis, relative to the component
  safePoint: string;         // the safe point it is entered from
  size: Vec3;                // body: [along local x, along local y, height]
  gripHeight: number;        // how far above the body's top (into the item) the TCP grips
  taught?: Vec3;             // an orientation from the pendant (axis-angle, rad), kept for every slot
  taughtFrom?: string;       // the waypoint it came from
  color: string;
  filled: boolean;           // slots hold an item at the start of a motion preview
}

export interface SafePointDef {
  id: string;
  label: string;
  x: number; y: number; z: number;
  heading: number;           // the tool points down with its x axis this way (deg about z)
  q?: Joints;                // taught joints (from a .script q[...] waypoint): used as they are
  taughtFrom?: string;
  links: string[];           // the safe points the arm may go to straight from here
}

export interface Waypoint {   // a named point read from a .script file
  name: string;
  pose?: number[];           // p[x, y, z, rx, ry, rz]
  q?: Joints;                // joints
}

export interface ScriptInfo {
  fileName: string;
  sequence: { move: string; target: string }[];
  tcp?: number[];
}

export interface MotionConfig {
  joint_speed: number; joint_accel: number; linear_speed: number; linear_accel: number; approach_speed: number;
}

export interface GripperConfig {
  type: GripperType;
  speed: number; force: number;      // robotiq 0-255
  pin: number; tool: boolean; closeLevel: boolean; // digital_out
}

export interface Project {
  version: 1;
  name: string;
  className: string;
  robot: { model: RobotModelId; tcp: number[]; payload: number };
  benchZ: number;
  gripper: GripperConfig;
  motion: MotionConfig;
  home: string;
  components: DeckComponent[];
  safePoints: SafePointDef[];
  waypoints: Waypoint[];
  script?: ScriptInfo;
}

export const SKILL: Record<ComponentKind, Skill | null> = {
  tray: 'top_down', station: 'top_down', side_rack: 'side_load', block: null,
};

export const SKILL_LABEL: Record<Skill, string> = {
  top_down: 'Top-down: tool straight down, in and out vertically',
  side_load: 'Side-load: tool horizontal, in and out along the rack axis',
};

export const DEFAULT_MOTION: MotionConfig = {
  joint_speed: 0.6, joint_accel: 0.8, linear_speed: 0.15, linear_accel: 0.5, approach_speed: 0.04,
};

export const DEFAULT_GRIPPER: GripperConfig = { type: 'robotiq', speed: 255, force: 100, pin: 0, tool: false, closeLevel: true };

const deg = (d: number) => (d * Math.PI) / 180;

// ----------------------------------------------------------------------------- the component catalog

export interface CatalogEntry {
  key: string;
  label: string;
  hint: string;
  make: () => Omit<DeckComponent, 'id' | 'x' | 'y' | 'z' | 'safePoint'> & { z: number };
}

export const CATALOG: CatalogEntry[] = [
  {
    key: 'vial_tray', label: 'Vial tray', hint: 'rows × cols of vials, picked top-down',
    make: () => ({ label: 'Vial tray', kind: 'tray', yaw: 0, rows: 2, cols: 4, colPitch: 0.03, rowPitch: 0.03, approach: 0.08,
      toolYaw: 0, size: [0.15, 0.09, 0.04], gripHeight: 0.03, color: '#64748b', filled: true, z: 0.07 }),
  },
  {
    key: 'well_plate', label: 'Well plate (SBS)', hint: 'a plate position: 1 slot, gripped on the long sides',
    make: () => ({ label: 'Plate nest', kind: 'station', yaw: 0, rows: 1, cols: 1, colPitch: 0.03, rowPitch: 0.03, approach: 0.06,
      toolYaw: 90, size: [0.1278, 0.0855, 0.02], gripHeight: 0.008, color: '#0ea5e9', filled: true, z: 0.028 }),
  },
  {
    key: 'station', label: 'Station', hint: 'one top-down position: balance, capper, stirrer',
    make: () => ({ label: 'Balance', kind: 'station', yaw: 0, rows: 1, cols: 1, colPitch: 0.03, rowPitch: 0.03, approach: 0.1,
      toolYaw: 0, size: [0.2, 0.3, 0.1], gripHeight: 0.03, color: '#a16207', filled: false, z: 0.13 }),
  },
  {
    key: 'side_rack', label: 'Side-load rack', hint: 'slide in sideways along rails parallel to the bench',
    make: () => ({ label: 'Slide rack', kind: 'side_rack', yaw: 0, rows: 3, cols: 1, colPitch: 0.04, rowPitch: 0.03, approach: 0.1,
      toolYaw: 0, size: [0.1, 0.06, 0.12], gripHeight: 0.02, color: '#7c3aed', filled: true, z: 0.05 }),
  },
  {
    key: 'block', label: 'Instrument / obstacle', hint: 'a box the arm must keep clear of (no slots)',
    make: () => ({ label: 'Instrument', kind: 'block', yaw: 0, rows: 1, cols: 1, colPitch: 0, rowPitch: 0, approach: 0,
      toolYaw: 0, size: [0.3, 0.3, 0.35], gripHeight: 0, color: '#475569', filled: false, z: 0 }),
  },
];

// ------------------------------------------------------------------------------------------ names

/** A Python identifier from a label ("Vial tray 2" -> vial_tray_2). */
export function slug(label: string): string {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(s) ? `_${s}` : s || 'item';
}

/** `base`, or base_2, base_3 ... whichever is not taken. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

export const allIds = (p: Project) => [...p.components.map((c) => c.id), ...p.safePoints.map((s) => s.id)];

/** A class name from the deck name ("Colour match deck" -> ColourMatchDeckArm). */
export function className(name: string): string {
  const words = name.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let s = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Deck';
  if (/^[0-9]/.test(s)) s = `Deck${s}`;
  return s.endsWith('Arm') ? s : `${s}Arm`;
}

// --------------------------------------------------------------------------------------- geometry

export const skillOf = (c: DeckComponent): Skill | null => SKILL[c.kind];
export const slotCount = (c: DeckComponent) => (c.kind === 'block' ? 0 : c.kind === 'station' ? 1 : c.rows * c.cols);

/** Where slot `i` is relative to slot 0, in the component's own frame. Row-major: index = row * cols + col. */
export function slotOffset(c: DeckComponent, i: number): Vec3 {
  if (c.kind === 'station') return [0, 0, 0];
  const col = i % c.cols, row = Math.floor(i / c.cols);
  if (c.kind === 'side_rack') return [0, col * c.colPitch, row * c.rowPitch];
  return [col * c.colPitch, row * c.rowPitch, 0];
}

/** The ideal TCP orientation for the component's skill. */
export function skillRotation(c: DeckComponent): Mat4 {
  if (skillOf(c) === 'side_load') {
    // tool z along the insertion axis (+x of the component), tool x pointing down at toolYaw 0
    return chain(rotZ(deg(c.yaw)), rotY(Math.PI / 2), rotZ(deg(c.toolYaw)));
  }
  return chain(rotZ(deg(c.yaw + c.toolYaw)), [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]); // rotX(pi)
}

export function slotRotation(c: DeckComponent): Mat4 {
  return c.taught ? fromAxisAngle(...c.taught) : skillRotation(c);
}

/** The TCP pose (matrix) at slot `i`. */
export function slotMatrix(c: DeckComponent, i: number): Mat4 {
  const [ox, oy, oz] = slotOffset(c, i);
  const a = deg(c.yaw), ca = Math.cos(a), sa = Math.sin(a);
  const m = slotRotation(c);
  m[3] = c.x + ca * ox - sa * oy;
  m[7] = c.y + sa * ox + ca * oy;
  m[11] = c.z + oz;
  return m;
}

/** From the slot to its approach point, in the base frame. */
export function approachVector(c: DeckComponent): Vec3 {
  if (skillOf(c) === 'side_load') {
    const a = deg(c.yaw);
    return [-Math.cos(a) * c.approach, -Math.sin(a) * c.approach, 0];
  }
  return [0, 0, c.approach];
}

export function approachMatrix(c: DeckComponent, i: number): Mat4 {
  const m = slotMatrix(c, i);
  const v = approachVector(c);
  m[3] += v[0];
  m[7] += v[1];
  m[11] += v[2];
  return m;
}

/** Degrees between the taught orientation and the skill's ideal one (0 when not taught). */
export function tiltFromSkill(c: DeckComponent): number {
  if (!c.taught) return 0;
  const a = fromAxisAngle(...c.taught), b = skillRotation(c);
  // compare the tool axes: what matters for the grip is where the tool points
  const dot = a[2] * b[2] + a[6] * b[6] + a[10] * b[10];
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

/** The yaw (deg) that lines a component up with a taught tool orientation. */
export function yawFromOrientation(kind: ComponentKind, rotation: Mat4, toolYaw: number): number {
  if (SKILL[kind] === 'side_load') {
    // the insertion axis is the tool z, flattened onto the bench
    return (Math.atan2(rotation[6], rotation[2]) * 180) / Math.PI;
  }
  // top-down: the tool x heading, less the gripper's own turn
  return (Math.atan2(rotation[4], rotation[0]) * 180) / Math.PI - toolYaw;
}

export function safePointMatrix(s: SafePointDef): Mat4 {
  return chain(translate(s.x, s.y, s.z), rotZ(deg(s.heading)), [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]);
}

/** A matrix as a URScript pose [x, y, z, rx, ry, rz]. */
export function poseOf(m: Mat4): number[] {
  return [m[3], m[7], m[11], ...toAxisAngle(m)];
}

// ---------------------------------------------------------------------------------------- defaults

export function emptyProject(): Project {
  return {
    version: 1,
    name: 'My deck',
    className: 'MyDeckArm',
    robot: { model: 'UR5e', tcp: [0, 0, 0.16, 0, 0, 0], payload: 1 },
    benchZ: 0,
    gripper: { ...DEFAULT_GRIPPER },
    motion: { ...DEFAULT_MOTION },
    home: 'home',
    components: [],
    safePoints: [{ id: 'home', label: 'Home', x: 0.0, y: 0.35, z: 0.45, heading: 0, links: [] }],
    waypoints: [],
  };
}

/** A component from the catalog at a spot on the bench, entered from the nearest safe point. */
export function makeComponent(entry: CatalogEntry, p: Project, x: number, y: number): DeckComponent {
  const { z, ...rest } = entry.make();
  const id = uniqueId(slug(rest.label), allIds(p));
  return { ...rest, id, label: id === slug(rest.label) ? rest.label : `${rest.label} ${id.split('_').pop()}`,
    x, y, z: p.benchZ + z, safePoint: nearestSafePoint(p, x, y, p.benchZ + z) ?? p.home };
}

export function nearestSafePoint(p: Project, x: number, y: number, z: number): string | null {
  let best: string | null = null, bestD = Infinity;
  for (const s of p.safePoints) {
    const d = Math.hypot(s.x - x, s.y - y, s.z - z);
    if (d < bestD) { bestD = d; best = s.id; }
  }
  return best;
}

/** A new safe point at (x, y), linked to every safe point there is, at the height of home. */
export function makeSafePoint(p: Project, x: number, y: number): SafePointDef {
  const id = uniqueId('safe', allIds(p));
  const home = p.safePoints.find((s) => s.id === p.home);
  // heading 0 everywhere keeps the wrist from spinning between safe points
  return { id, label: id === 'safe' ? 'Safe' : `Safe ${id.split('_').pop()}`, x, y, z: home?.z ?? p.benchZ + 0.4, heading: 0,
    links: p.safePoints.map((s) => s.id) };
}

/** Safe points linked either way, as the runtime reads them. */
export function linksOf(p: Project): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>(p.safePoints.map((s) => [s.id, new Set<string>()]));
  for (const s of p.safePoints) for (const t of s.links) {
    if (t !== s.id && m.has(t)) { m.get(s.id)!.add(t); m.get(t)!.add(s.id); }
  }
  return m;
}
