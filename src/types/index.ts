export interface ParsedLocation {
  name: string;
  type: string;
  coordinates: string;
}

export interface GridConfig {
  isGrid: boolean;
  cols: number;
  rows: number;
  dx: number;
  dy: number;
}

export type ApiType = 'ti_robots' | 'cri';
export type URModel = 'UR3' | 'UR5' | 'UR10';

export interface MoveSequenceItem {
  moveType: string;
  target: string;
}
