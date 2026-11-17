// The end effectors the editor knows, and how they sit on the flange. A tool is a few datasheet
// numbers (how long it is, how far it opens) and a URDF to draw (a stand-in of boxes until its meshes
// arrive, or if they never do), and a mount is a nominal TCP for that tool. The TCP stays the truth:
// the mount shown in the inspector is read back from it, and anything that is not a preset is "custom". Nothing here reaches the exported controller, which
// only ever sees `robot.tcp`.
import { column, fromPose, identity, translation, type Mat4, type Vec3 } from './mat4';

export type ToolId = 'hand_e' | 'hand_e_pins' | '2f_85' | '2f_140' | 'rg2' | 'rg6';
export type MountId = 'straight' | 'right_angle';

export interface ToolModel {
  id: ToolId;
  label: string;
  style: 'parallel' | 'linkage'; // fingers on a rack, or on a linkage (2F, RG6)
  length: number;       // flange face to the fingertips, coupling included
  fingerLength: number; // of that, what sticks out of the body
  bodyRadius: number;
  stroke: number;       // fully open
  model?: ToolUrdf;
  rods?: FingerRods;
  tilt?: ToolTilt;
}

/**
 * A tool that comes with its own angled bracket (the RG2 and RG6): its body bolts on turned about the
 * axis its fingers open along, `pivot` out from the flange, so it needs no 90° bracket to lie across
 * the flange. The axis is where the body bolts to the bracket (on the RG2, the middle of a ring of holes
 * 30° apart), not the body's own origin.
 */
export interface ToolTilt {
  pivot: number;  // flange face to the tilt axis
  joint: string;  // the URDF joint that turns the bracket against the body
}

/**
 * The pins fixed in a tool's fingers: they stick out sideways (the gripper's -y, across the way the
 * fingers open) and grip `reach` from the tool's axis, in the middle of the four, so that is where its
 * TCP is on a 90° bracket (pins that hang down over a vial when the wrist points down). They are part
 * of the gripper and turn with it. A tool without them is just the gripper: its TCP is on its own axis.
 */
export interface FingerRods {
  back: number[];   // each pin's distance back from the fingertips, along the tool
  offset: number;   // a pin's distance from the middle with the fingers together
  radius: number;
  from: number;     // how far from the tool's axis a pin starts
  reach: number;    // and how far from it the pins grip
  past: number;     // what is left of a pin beyond there
}

/** The real thing: a URDF in public/ whose root sits on the flange, z out along the tool, fingers opening along x. */
export interface ToolUrdf {
  urdf: string;
  joint: string;   // the one that drives the fingers (the rest mimic it)
  open: number;    // its value at the full stroke
  closed: number;  // and with the fingers together
  swing?: FingerSwing;
}

/**
 * Fingers that stay parallel on the end of an arm swinging about a pivot (the RG6): the gap follows
 * the arm's angle exactly, 2 * arm * (cos(joint + phase) - cos(closed + phase)), instead of being
 * taken as even between closed and open.
 */
export interface FingerSwing {
  arm: number;    // pivot to pivot
  phase: number;  // the arm's angle from flat out sideways at joint 0
}

/** Where the URDFs' meshes come from: the description packages on jsDelivr, pinned to a commit. */
export const TOOL_PACKAGES: Record<string, string> = {
  robotiq_description: 'https://cdn.jsdelivr.net/gh/PickNikRobotics/ros2_robotiq_gripper@a5e1405098166dd9bd63fd24b3c03173fc1cb984/robotiq_description',
  robotiq_hande_description: 'https://cdn.jsdelivr.net/gh/AGH-CEAI/robotiq_hande_description@f0f1a87180c21f04661d515186a891dfc422c111',
  onrobot_description: 'https://cdn.jsdelivr.net/gh/libishm1/onrobot1_ros@9c6ce32d84bd903d59120c2a95d4a115d6e33cde/onrobot_description',
};

/** How far back from the fingertips the middle of a tool's pins is: where they hold an item. */
export const pinMiddle = (rods: FingerRods) => rods.back.reduce((a, b) => a + b, 0) / rods.back.length;

/** With nothing in them, the fingers are drawn closed to this. */
export const CLOSED_GAP = 0.012;

/**
 * The finger gap when closed on an item `width` across (a vial's diameter), or on nothing. Fingers
 * close to the item's width. Pins hold a round item between the four of them, so they close until
 * each one touches it.
 */
export function closedGap(tool: ToolModel, width: number | null, byPins = false): number {
  if (width == null) return Math.min(CLOSED_GAP, tool.stroke);
  let gap = width;
  if (byPins && tool.rods) {
    const { back, offset, radius } = tool.rods;
    const half = (Math.max(...back) - Math.min(...back)) / 2; // a pin's distance along the tool from the middle
    const touch = width / 2 + radius;                           // and from the item's axis, touching it
    gap = 2 * (Math.sqrt(Math.max(0, touch * touch - half * half)) - offset);
  }
  return Math.max(0, Math.min(tool.stroke, gap));
}

/** The driving joint's value for a finger gap. */
export function fingerJoint(tool: ToolModel, gap: number): number | null {
  if (!tool.model) return null;
  const k = Math.max(0, Math.min(1, gap / tool.stroke));
  const { closed, open, swing } = tool.model;
  if (swing) return Math.acos(Math.min(1, Math.cos(closed + swing.phase) + (k * tool.stroke) / (2 * swing.arm))) - swing.phase;
  return closed + (open - closed) * k;
}

// The RG6's truss arm carries the finger 55 mm out and 58 mm up from its pivot, an 80 mm arm, and the
// URDF's joint starts 0.49 rad back from there.
const RG6_SWING: FingerSwing = { arm: Math.hypot(0.05503, 0.05807), phase: Math.atan2(0.05807, 0.05503) - 0.49 };
// The RG2 is the same linkage, smaller: a 55 mm arm, starting 0.772 rad back.
const RG2_SWING: FingerSwing = { arm: Math.hypot(0.0256, 0.04868), phase: Math.atan2(0.04868, 0.0256) - 0.772 };

// Lengths are the URDFs' own, fingers closed, with the 11 mm UR coupling: Hand-E 156.5 mm (75 mm
// across, 50 mm stroke), 2F-85 174 mm and 2F-140 244 mm (Robotiq quotes 162.8 and 232.8 without the
// coupling). The RG6 (v2) is 290.5 mm to its closed fingertips: 56.1 mm of bracket to the tilt axis,
// then 234.4 mm of gripper. Its fingertips pull back as they open (54 mm at full stroke), and this
// model opens to 150 mm at its joint limit, where OnRobot quotes 160. The RG2 (v1) is 212.7 mm: 39 mm
// of bracket to the tilt axis (the middle of the bracket's rings of holes, which the body's own holes
// bolt to), then 173.7 mm of gripper; its model opens to 100 mm, where OnRobot quotes 110.
// Close enough to place a deck, not to skip measuring the TCP.
export const TOOLS: Record<ToolId, ToolModel> = {
  hand_e: { id: 'hand_e', label: 'Robotiq Hand-E', style: 'parallel', length: 0.1565, fingerLength: 0.045, bodyRadius: 0.0375, stroke: 0.05,
    model: { urdf: 'robotiq_hande.urdf', joint: 'robotiq_hande_left_finger_joint', open: 0.025, closed: 0 } },
  // the Hand-E with the lab's own fingers: bosses 6 and 16 mm back from the tips, 5.5 mm off the middle,
  // their pins gripping 38.5 mm from the gripper's axis
  hand_e_pins: { id: 'hand_e_pins', label: 'Robotiq Hand-E, pin fingers', style: 'parallel', length: 0.1565, fingerLength: 0.045, bodyRadius: 0.0375, stroke: 0.05,
    model: { urdf: 'robotiq_hande_pins.urdf', joint: 'robotiq_hande_left_finger_joint', open: 0.025, closed: 0 },
    rods: { back: [0.006, 0.016], offset: 0.0055, radius: 0.0015, from: 0.014, reach: 0.0385, past: 0.012 } },
  '2f_85': { id: '2f_85', label: 'Robotiq 2F-85', style: 'linkage', length: 0.174, fingerLength: 0.07, bodyRadius: 0.0375, stroke: 0.085,
    model: { urdf: 'robotiq_2f_85.urdf', joint: 'robotiq_85_left_knuckle_joint', open: 0, closed: 0.7929 } },
  '2f_140': { id: '2f_140', label: 'Robotiq 2F-140', style: 'linkage', length: 0.244, fingerLength: 0.13, bodyRadius: 0.0375, stroke: 0.14,
    model: { urdf: 'robotiq_2f_140.urdf', joint: 'finger_joint', open: 0, closed: 0.695 } },
  rg2: { id: 'rg2', label: 'OnRobot RG2', style: 'linkage', length: 0.2127, fingerLength: 0.085, bodyRadius: 0.036, stroke: 0.1,
    model: { urdf: 'onrobot_rg2.urdf', joint: 'finger_joint', open: 0.01708, closed: 1.219729, swing: RG2_SWING },
    tilt: { pivot: 0.039, joint: 'mount_joint' } },
  rg6: { id: 'rg6', label: 'OnRobot RG6', style: 'linkage', length: 0.2905, fingerLength: 0.116, bodyRadius: 0.042, stroke: 0.15,
    model: { urdf: 'onrobot_rg6.urdf', joint: 'finger_joint', open: 0.003175, closed: 1.238486, swing: RG6_SWING },
    tilt: { pivot: 0.0561, joint: 'mount_joint' } },
};

export const TOOL_IDS = Object.keys(TOOLS) as ToolId[];

const MOUNT_LABEL: Record<MountId, string> = {
  straight: 'Straight on the flange',
  right_angle: '90° bracket (gripper across the flange)',
};

/** What a mount is called for a tool: one with its own angled bracket has no 90° bracket to add. */
export function mountLabel(tool: ToolModel, mount: MountId): string {
  return mount === 'right_angle' && tool.tilt ? '90° on its own bracket' : MOUNT_LABEL[mount];
}

/**
 * The TCP axis the fingers open along on each mount. Straight on, that is the TCP's x. On the 90°
 * bracket the gripper is bolted on so its fingers travel across the bracket (the flange's x), which
 * with that mount's TCP is the tool's y.
 */
export const MOUNT_FINGER_AXIS: Record<MountId, 'x' | 'y'> = { straight: 'x', right_angle: 'y' };

/**
 * The TCP axis the fingers are drawn along. It is the user's to set (`chosen`), except on a tool that
 * tilts on its own bracket: there the fingers lie along the tilt axis, which is the flange's x, so
 * it is whichever of the TCP's x and y is nearer that.
 */
export function fingerAxisOf(tcp: number[], tool: ToolModel, chosen: 'x' | 'y'): 'x' | 'y' {
  if (!tool.tilt) return chosen;
  const m = fromPose(tcp);
  return Math.abs(column(m, 1)[0]) > Math.abs(column(m, 0)[0]) ? 'y' : 'x';
}

/** A UR's tool flange (ISO 9409-1-50-4-M6) is 63 mm across. */
export const FLANGE_RADIUS = 0.0315;
/** Plate thickness of the stand-in bracket, drawn where the real one does not fit the TCP. */
export const PLATE = 0.012;
/**
 * The 90° bracket, from its CAD (public/bracket_90.stl, written by scripts/make_bracket_mesh.py): the
 * gripper bolts to a face `reach` out from the flange's axis, with its own axis `depth` from the
 * flange's face.
 */
export const BRACKET_90 = { reach: 0.0425, depth: 0.0385, mesh: 'bracket_90.stl' };

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 || 0;

// The 90° bracket as labs fit it to a UR: the gripper lies along the flange's -y (the side the
// flange's dowel pin puts the bracket's upright on), tool z out along the gripper and tool x along
// the flange's axis (so along the pins of pin fingers). On the pendant
// that orientation reads RX, RY, RZ = 1.2092, -1.2092, 1.2092 rad (120° about [1, -1, 1]).
const ACROSS = 2 * Math.PI / 3 / Math.sqrt(3);

/** The nominal TCP for a tool on a mount. */
export function mountTcp(tool: ToolModel, mount: MountId): number[] {
  if (mount === 'straight') return [0, 0, tool.length, 0, 0, 0];
  // tilted on its own bracket, the gripper swings down about its pivot: the same pose, no bracket
  if (tool.tilt) return [0, -r6(tool.length - tool.tilt.pivot), r6(tool.tilt.pivot), r6(ACROSS), -r6(ACROSS), r6(ACROSS)];
  // pin fingers hold the item in the middle of their pins, a little back from the fingertips
  const back = tool.rods ? pinMiddle(tool.rods) : 0;
  return [0, -r6(BRACKET_90.reach + tool.length - back), r6(BRACKET_90.depth + (tool.rods?.reach ?? 0)), r6(ACROSS), -r6(ACROSS), r6(ACROSS)];
}

/**
 * How far the TCP is out along the flange's axis from a gripper lying across the flange on the
 * bracket, when that is its pins' doing: the TCP is where the pins grip. 0 for a tool without pins,
 * or one whose TCP is on its own axis.
 */
function pinDrop(m: Mat4, tool: ToolModel): number {
  const across = Math.abs(m[10]) < 0.35;
  return tool.rods && across && m[11] > BRACKET_90.depth + 0.002 ? m[11] - BRACKET_90.depth : 0;
}

/**
 * The frame a tool grips in, as seen from the TCP's frame: z into the item, x and y as a skill turns
 * them. A gripper grips along its own axis, so that is the TCP's frame itself. Pin fingers in use (the
 * TCP out at their pins) grip along the pins: z along them, x along the gripper, so that a pick from
 * above hangs the pins over the item with the gripper lying flat.
 */
export function gripFrame(tcp: number[], tool: ToolModel): Mat4 {
  const m = fromPose(tcp);
  if (!pinDrop(m, tool)) return identity();
  // the pins run along the flange's axis, which the TCP's frame sees as its rotation's third row
  const n = Math.hypot(m[8], m[9]), dx = m[8] / n, dy = m[9] / n;
  return [0, dy, dx, 0, 0, -dx, dy, 0, 1, 0, 0, 0, 0, 0, 0, 1]; // columns: the gripper's axis, pins x that, the pins
}

/** Which preset a TCP is, if any: to 0.1 mm and 0.01°, what the inspector's fields round to. */
export function mountOf(tcp: number[], tool: ToolModel): MountId | 'custom' {
  for (const m of ['straight', 'right_angle'] as const) {
    if (mountTcp(tool, m).every((v, i) => Math.abs(v - tcp[i]) < (i < 3 ? 1e-4 : 2e-4))) return m;
  }
  return 'custom';
}

/** What joins the flange to the tool's base, in the flange (tool0) frame. */
export type MountShape =
  | { kind: 'none' }
  | { kind: 'adapter'; height: number }                              // a spacer along the flange axis
  // an L turned `turn` about z, holding the gripper's base `reach` out with its axis `depth` from the
  // flange. `spacer` is set when the real bracket fits: what is left between its face and the gripper.
  // Otherwise a stand-in is drawn, its upright reaching down to `drop`.
  | { kind: 'bracket'; turn: number; reach: number; depth: number; drop: number; spacer: number | null }
  | { kind: 'strut'; base: Vec3 };                                   // anything else: a bar to the tool's base

export interface ToolPlacement {
  length: number;    // the tool as drawn, back from its fingertips along its axis
  tip: Vec3;         // its fingertips in the TCP's frame: the origin, unless its pins reach from them to the TCP
  tilt: number;      // how far a tool that tilts on its own bracket is turned (its tilt joint's value), else 0
  mount: MountShape;
}

/**
 * Where the tool's body goes for a TCP, and the shape that holds it to the flange. `fingerAxis` is the
 * TCP axis the fingers open along, which is also the axis a tilting tool tilts about.
 */
export function placeTool(tcp: number[], tool: ToolModel, fingerAxis: 'x' | 'y' = 'x'): ToolPlacement {
  const m: Mat4 = fromPose(tcp);
  const at = translation(m), axis = column(m, 2);
  const length = tool.length;

  if (tool.tilt) {
    // The gripper's own axes in the flange frame: x along its fingers, z out along it. Its bracket
    // turns about x until it faces the flange squarely, as far as it can.
    const tx = column(m, 0), ty = column(m, 1);
    const gy: Vec3 = fingerAxis === 'y' ? [-tx[0], -tx[1], -tx[2]] : ty;
    const gx = fingerAxis === 'y' ? ty : tx;
    const tilt = Math.atan2(-gy[2], axis[2]);
    if (Math.abs(tilt) > 0.02) {
      const { pivot } = tool.tilt;
      const c = Math.cos(tilt), s = Math.sin(tilt);
      const out: Vec3 = [-s * gy[0] + c * axis[0], -s * gy[1] + c * axis[1], -s * gy[2] + c * axis[2]]; // the bracket's own axis
      const reach = length - pivot;
      const base: Vec3 = [at[0] - axis[0] * reach - out[0] * pivot, at[1] - axis[1] * reach - out[1] * pivot, at[2] - axis[2] * reach - out[2] * pivot];
      // on the flange when it faces it squarely and sits on its middle; a TCP that says otherwise gets a strut
      const seated = Math.abs(gx[2]) < 0.05 && Math.hypot(...base) < 0.003;
      return { length, tip: [0, 0, 0], tilt, mount: seated ? { kind: 'none' } : { kind: 'strut', base } };
    }
  }

  // A gripper lying across the flange is on the bracket, its axis the bracket's depth from the flange.
  // With pin fingers, a TCP further out along the flange's axis than that is not a gripper hung lower:
  // it is where the pins grip: `drop` out along them, and in the middle of them, a little back from the
  // fingertips. Without them the gripper is where its TCP says, on a longer bracket.
  const across = Math.abs(axis[2]) < 0.35;
  const drop = pinDrop(m, tool);
  const ahead = drop && tool.rods ? pinMiddle(tool.rods) : 0;
  const tipAt: Vec3 = [at[0] + axis[0] * ahead, at[1] + axis[1] * ahead, at[2] - drop + axis[2] * ahead];
  // the flange's axis as the TCP's frame sees it is the rotation's third row
  const tip: Vec3 = drop ? [-drop * m[8] || 0, -drop * m[9] || 0, ahead - drop * m[10] || 0] : [0, 0, 0];

  const base: Vec3 = [tipAt[0] - axis[0] * length, tipAt[1] - axis[1] * length, tipAt[2] - axis[2] * length];
  const side = Math.hypot(base[0], base[1]);

  if (Math.hypot(...base) < 0.002) return { length, tip, tilt: 0, mount: { kind: 'none' } };
  if (axis[2] > 0.94 && side < 0.02 && base[2] > 0) return { length, tip, tilt: 0, mount: { kind: 'adapter', height: base[2] } };
  if (across && base[2] > 0) {
    // an L along the way the gripper points; a base far off that line is not this bracket
    const flat = Math.hypot(axis[0], axis[1]);
    const u = [axis[0] / flat, axis[1] / flat];
    const reach = base[0] * u[0] + base[1] * u[1], off = Math.abs(base[0] * u[1] - base[1] * u[0]);
    if (reach > 0.01 && off < 0.03) {
      // the real bracket, if the gripper's base is on its face or a coupling's thickness out from it
      const gap = reach - BRACKET_90.reach;
      const fits = Math.abs(base[2] - BRACKET_90.depth) < 0.003 && off < 0.012 && gap > -0.003 && gap < 0.03;
      return { length, tip, tilt: 0, mount: { kind: 'bracket', turn: Math.atan2(u[1], u[0]), reach, depth: base[2],
        drop: base[2] + tool.bodyRadius, spacer: fits ? Math.max(0, gap) : null } };
    }
  }
  return { length, tip, tilt: 0, mount: { kind: 'strut', base } };
}
