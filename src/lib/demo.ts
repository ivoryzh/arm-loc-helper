// A small UR5e deck to start from: vials picked top-down from a tray, a balance and a capper, a
// slide rack loaded from the side, and three safe points (home in the middle, one per side).
import { DEFAULT_GRIPPER, DEFAULT_MOTION, type DeckComponent, type Project } from './deck';

const base = { rows: 1, cols: 1, colPitch: 0.03, rowPitch: 0.03, toolYaw: 0, yaw: 0, filled: false };

const components: DeckComponent[] = [
  { ...base, id: 'vial_tray', label: 'Vial tray', kind: 'tray', x: 0.3, y: 0.3, z: 0.07, rows: 2, cols: 4,
    approach: 0.08, safePoint: 'left', size: [0.15, 0.09, 0.04], gripHeight: 0.03, color: '#64748b', filled: true },
  { ...base, id: 'balance', label: 'Balance', kind: 'station', x: 0.47, y: 0.08, z: 0.14,
    approach: 0.1, safePoint: 'left', size: [0.2, 0.28, 0.11], gripHeight: 0.03, color: '#a16207' },
  { ...base, id: 'capper', label: 'Capper', kind: 'station', x: 0.12, y: 0.52, z: 0.16,
    approach: 0.08, safePoint: 'home', size: [0.14, 0.14, 0.13], gripHeight: 0.03, color: '#be123c' },
  { ...base, id: 'slide_rack', label: 'Slide rack', kind: 'side_rack', x: -0.46, y: 0.3, z: 0.12, yaw: 180, rows: 3, cols: 1,
    rowPitch: 0.035, approach: 0.1, safePoint: 'right', size: [0.1, 0.06, 0.12], gripHeight: 0.02, color: '#7c3aed', filled: true },
  { ...base, id: 'hplc', label: 'HPLC', kind: 'block', x: -0.3, y: -0.38, z: 0, approach: 0, safePoint: 'home',
    size: [0.36, 0.3, 0.42], gripHeight: 0, color: '#475569' },
];

export function demoProject(): Project {
  return {
    version: 1,
    name: 'Demo deck',
    className: 'DemoDeckArm',
    robot: { model: 'UR5e', tcp: [0, 0, 0.16, 0, 0, 0], payload: 1 },
    benchZ: 0,
    gripper: { ...DEFAULT_GRIPPER },
    motion: { ...DEFAULT_MOTION },
    home: 'home',
    components: components.map((c) => ({ ...c, size: [...c.size] as DeckComponent['size'] })),
    safePoints: [
      { id: 'home', label: 'Home', x: 0, y: 0.38, z: 0.4, heading: 0, links: ['left', 'right'] },
      { id: 'left', label: 'Left', x: 0.36, y: 0.3, z: 0.36, heading: 0, links: ['home'] },
      { id: 'right', label: 'Right', x: -0.34, y: 0.3, z: 0.36, heading: 0, links: ['home'] },
    ],
    waypoints: [],
  };
}
