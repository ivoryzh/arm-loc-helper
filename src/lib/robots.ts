// The arms the editor knows. A robot is its kinematics (standard DH, as in ros-industrial
// ur_description's default_kinematics.yaml), the URDF drawn on screen, and a few numbers for checks.
// Another make of arm would be another entry here plus a driver class in the Python runtime.
import type { URParams } from './kinematics';

export type RobotModelId = 'UR3' | 'UR3e' | 'UR5' | 'UR5e' | 'UR10' | 'UR10e';

export interface RobotModel {
  id: RobotModelId;
  label: string;
  urdf: string;      // in public/
  params: URParams;
  reach: number;     // m, the datasheet reach
  payload: number;   // kg
  repaint?: boolean; // its meshes come darker than the arm is: draw them in the e-Series' colours
}

/**
 * The e-Series meshes' own materials (sRGB). The CB3 meshes are the same arm in the same paint, but
 * were exported with every colour about half as bright, so they are drawn in these instead.
 */
export const PAINT = {
  link: { color: [0.82, 0.82, 0.82], specular: 0.5 },    // the aluminium tubes
  joint: { color: [0.28, 0.28, 0.28], specular: 0.03 },  // the joint housings
  blue: { color: [0.49, 0.68, 0.8], specular: 0.03 },    // the caps
  black: { color: [0.03, 0.03, 0.03], specular: 0.03 },  // seals and connectors
} as const;

export type Paint = keyof typeof PAINT;

/**
 * Which paint a CB3 mesh's material is, from its name where it has a telling one (the UR3 and UR5
 * meshes use Rohr, verbindung, blau, Scheibe: tube, joint, blue, disc) and its colour (sRGB) where not.
 */
export function paintOf(name: string, [r, g, b]: number[]): Paint {
  if (b - r > 0.08 || /^blau/i.test(name)) return 'blue';
  if (/^rohr/i.test(name)) return 'link';
  if (/^verbindung/i.test(name)) return 'joint';
  if (/^scheibe/i.test(name)) return 'black';
  const grey = (r + g + b) / 3;
  return grey >= 0.3 ? 'link' : grey >= 0.12 ? 'joint' : 'black';
}

export const ROBOTS: Record<RobotModelId, RobotModel> = {
  UR3: { id: 'UR3', label: 'UR3 (CB3)', urdf: 'ur3.urdf', reach: 0.5, payload: 3, repaint: true,
    params: { name: 'UR3', d1: 0.1519, a2: -0.24365, a3: -0.21325, d4: 0.11235, d5: 0.08535, d6: 0.0819 } },
  UR3e: { id: 'UR3e', label: 'UR3e', urdf: 'ur3e.urdf', reach: 0.5, payload: 3,
    params: { name: 'UR3e', d1: 0.15185, a2: -0.24355, a3: -0.2132, d4: 0.13105, d5: 0.08535, d6: 0.0921 } },
  UR5: { id: 'UR5', label: 'UR5 (CB3)', urdf: 'ur5.urdf', reach: 0.85, payload: 5, repaint: true,
    params: { name: 'UR5', d1: 0.089159, a2: -0.425, a3: -0.39225, d4: 0.10915, d5: 0.09465, d6: 0.0823 } },
  UR5e: { id: 'UR5e', label: 'UR5e', urdf: 'ur5e.urdf', reach: 0.85, payload: 5,
    params: { name: 'UR5e', d1: 0.1625, a2: -0.425, a3: -0.3922, d4: 0.1333, d5: 0.0997, d6: 0.0996 } },
  UR10: { id: 'UR10', label: 'UR10 (CB3)', urdf: 'ur10.urdf', reach: 1.3, payload: 10, repaint: true,
    params: { name: 'UR10', d1: 0.1273, a2: -0.612, a3: -0.5723, d4: 0.163941, d5: 0.1157, d6: 0.0922 } },
  UR10e: { id: 'UR10e', label: 'UR10e', urdf: 'ur10e.urdf', reach: 1.3, payload: 12.5,
    params: { name: 'UR10e', d1: 0.1807, a2: -0.6127, a3: -0.57155, d4: 0.17415, d5: 0.11985, d6: 0.11655 } },
};

export const ROBOT_IDS = Object.keys(ROBOTS) as RobotModelId[];

/** Meshes come from ros-industrial's ur_description on jsDelivr; the repository ships only the URDF text. */
export const MESH_CDN = 'https://cdn.jsdelivr.net/gh/ros-industrial/universal_robot@master/ur_description';

export const JOINT_NAMES = [
  'shoulder_pan_joint', 'shoulder_lift_joint', 'elbow_joint', 'wrist_1_joint', 'wrist_2_joint', 'wrist_3_joint',
] as const;
