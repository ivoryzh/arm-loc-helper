// The editor's state: the project with undo/redo, what is selected, and the live arm view the 3D
// scene reads every frame (kept out of React state so animation does not re-render the page).
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode, type RefObject } from 'react';
import { demoProject } from './lib/demo';
import type { Project } from './lib/deck';
import type { Joints } from './lib/kinematics';
import type { Trajectory } from './lib/motion';
import { loadSaved, saveLocal } from './lib/storage';

export type Selection = { type: 'component' | 'safe' | 'waypoint'; id: string } | null;

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  selection: Selection;
  lastKey: string | null;
  lastAt: number;
}

type Action =
  | { type: 'update'; fn: (p: Project) => Project; key?: string; record?: boolean }
  | { type: 'replace'; project: Project }
  | { type: 'checkpoint' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; selection: Selection };

const LIMIT = 100;

function selectionExists(p: Project, s: Selection): Selection {
  if (!s) return null;
  if (s.type === 'component') return p.components.some((c) => c.id === s.id) ? s : null;
  if (s.type === 'safe') return p.safePoints.some((c) => c.id === s.id) ? s : null;
  return p.waypoints.some((w) => w.name === s.id) ? s : null;
}

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'update': {
      const next = a.fn(state.project);
      if (next === state.project) return state;
      const now = Date.now();
      // typing into one field, or one drag, is one undo step
      const coalesce = a.record === false || (a.key != null && a.key === state.lastKey && now - state.lastAt < 1200);
      return {
        ...state,
        project: next,
        past: coalesce ? state.past : [...state.past.slice(-LIMIT), state.project],
        future: coalesce ? state.future : [],
        lastKey: a.key ?? null,
        lastAt: now,
        selection: selectionExists(next, state.selection),
      };
    }
    case 'replace':
      return { ...state, project: a.project, past: [...state.past.slice(-LIMIT), state.project], future: [], selection: null, lastKey: null };
    case 'checkpoint':
      return { ...state, past: [...state.past.slice(-LIMIT), state.project], future: [], lastKey: null };
    case 'undo': {
      if (!state.past.length) return state;
      const prev = state.past[state.past.length - 1];
      return { ...state, project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future], lastKey: null,
        selection: selectionExists(prev, state.selection) };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const next = state.future[0];
      return { ...state, project: next, past: [...state.past, state.project], future: state.future.slice(1), lastKey: null,
        selection: selectionExists(next, state.selection) };
    }
    case 'select':
      return { ...state, selection: a.selection };
  }
}

/** What the 3D arm shows this frame; the motion preview and the inspector write it, the scene reads it. */
export interface ArmView {
  target: Joints | null;        // where the arm should be (it eases there)
  q: Joints | null;             // where it is drawn
  grip: number;                 // 1 open .. 0 closed
  carrying: string | null;      // the component whose item is in the gripper
  occupancy: Map<string, boolean>; // "component[slot]" -> holds an item, during a preview
  playing: boolean;
  player: PlayerRun | null;
}

/** A motion preview being played; the scene's render loop advances it. */
export interface PlayerRun {
  traj: Trajectory;
  t: number;          // seconds since the start
  segStart: number;   // when the current segment began
  seg: number;        // the segment playing
  speed: number;      // times real time
  running: boolean;
  onSegment: (index: number) => void;
  onEnd: () => void;
}

interface Store {
  project: Project;
  selection: Selection;
  canUndo: boolean;
  canRedo: boolean;
  update: (fn: (p: Project) => Project, key?: string, record?: boolean) => void;
  replace: (p: Project) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  arm: RefObject<ArmView>;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, null, () => ({
    project: loadSaved() ?? demoProject(), past: [], future: [], selection: null, lastKey: null, lastAt: 0,
  }));
  const arm = useRef<ArmView>({ target: null, q: null, grip: 1, carrying: null, occupancy: new Map(), playing: false, player: null });

  useEffect(() => {
    const t = setTimeout(() => saveLocal(state.project), 300);
    return () => clearTimeout(t);
  }, [state.project]);

  const store = useMemo<Store>(() => ({
    project: state.project,
    selection: state.selection,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    update: (fn, key, record) => dispatch({ type: 'update', fn, key, record }),
    replace: (project) => dispatch({ type: 'replace', project }),
    checkpoint: () => dispatch({ type: 'checkpoint' }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    select: (selection) => dispatch({ type: 'select', selection }),
    arm,
  }), [state]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
