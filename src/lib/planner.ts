// The moves an action makes, step for step as arm_loc_helper/runtime.py plans them (the generator
// test runs both on the same deck and compares). Works on the exported deck, so both sides see the
// same rounded numbers: same distances, same shortest paths, same ties.
import type { RuntimeDeck } from './runtimeDeck';

export type ArmState = null | { kind: 'safe'; name: string } | { kind: 'loc'; name: string; index: number; down: boolean };

export type StepKind = 'movej' | 'movej_pose' | 'movel' | 'gripper';

export interface PlanStep {
  kind: StepKind;
  name: string;
  target: number[] | null;
  slow: boolean;
  after: ArmState;
}

export type Action = 'home' | 'safe_point' | 'move_above' | 'move_to' | 'pick' | 'place' | 'transfer';

export class PlanError extends Error {}

const sq = (v: number) => v * v;
/** Plain sqrt, as runtime.distance does, so the two agree to the last bit. */
const distance = (a: number[], b: number[]) => Math.sqrt(sq(a[0] - b[0]) + sq(a[1] - b[1]) + sq(a[2] - b[2]));

export function stateName(s: ArmState): string {
  if (!s) return 'unknown';
  if (s.kind === 'safe') return s.name;
  return `${s.name}[${s.index}]${s.down ? '' : ' approach'}`;
}

export function linkMap(deck: RuntimeDeck): Map<string, string[]> {
  const m = new Map<string, Set<string>>(Object.keys(deck.safe_points).map((n) => [n, new Set<string>()]));
  for (const [n, sp] of Object.entries(deck.safe_points)) for (const t of sp.links) {
    if (t !== n && m.has(t)) { m.get(n)!.add(t); m.get(t)!.add(n); }
  }
  return new Map([...m].map(([k, v]) => [k, [...v].sort()]));
}

/** Shortest safe path (both ends included) by straight-line distance; ties go to the smaller name. */
export function safePath(deck: RuntimeDeck, start: string, goal: string): string[] {
  const links = linkMap(deck);
  const edge = (a: string, b: string) => distance(deck.safe_points[a].pose, deck.safe_points[b].pose);
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  for (;;) {
    let best: [number, string] | null = null;
    for (const [n, d] of dist) {
      if (done.has(n)) continue;
      if (!best || d < best[0] || (d === best[0] && n < best[1])) best = [d, n];
    }
    if (!best) break;
    const [d, n] = best;
    if (n === goal) break;
    done.add(n);
    for (const m of links.get(n) ?? []) {
      const nd = d + edge(n, m);
      if (nd < (dist.get(m) ?? Infinity)) {
        dist.set(m, nd);
        prev.set(m, n);
      }
    }
  }
  if (!dist.has(goal)) throw new PlanError(`no safe path from ${start} to ${goal}: link their safe points`);
  const out = [goal];
  while (out[out.length - 1] !== start) out.push(prev.get(out[out.length - 1])!);
  return out.reverse();
}

function loc(deck: RuntimeDeck, name: string) {
  const l = deck.locations[name];
  if (!l) throw new PlanError(`no location ${name}`);
  return l;
}

function slot(deck: RuntimeDeck, name: string, index: number): number[] {
  const l = loc(deck, name);
  if (!(index >= 0 && index < l.slots.length)) throw new PlanError(`${name} has slots 0-${l.slots.length - 1}, not ${index}`);
  return [...l.slots[index]];
}

function approachPose(deck: RuntimeDeck, name: string, index: number): number[] {
  const p = slot(deck, name, index), a = loc(deck, name).approach;
  return [p[0] + a[0], p[1] + a[1], p[2] + a[2], p[3], p[4], p[5]];
}

function safeStep(deck: RuntimeDeck, name: string): PlanStep {
  const sp = deck.safe_points[name];
  const after: ArmState = { kind: 'safe', name };
  return sp.q ? { kind: 'movej', name, target: [...sp.q], slow: false, after } : { kind: 'movej_pose', name, target: [...sp.pose], slow: false, after };
}

function toSafe(deck: RuntimeDeck, state: ArmState, goal: string): [PlanStep[], ArmState] {
  if (!state) throw new PlanError('the arm is not at a known point: recover() it to a safe point first');
  const steps: PlanStep[] = [];
  let at: string;
  if (state.kind === 'loc') {
    const l = loc(deck, state.name);
    if (state.down) {
      steps.push({ kind: 'movel', name: `${state.name}[${state.index}] approach`, target: approachPose(deck, state.name, state.index), slow: true,
        after: { kind: 'loc', name: state.name, index: state.index, down: false } });
    }
    steps.push(safeStep(deck, l.safe_point));
    at = l.safe_point;
  } else {
    at = state.name;
  }
  for (const n of safePath(deck, at, goal).slice(1)) steps.push(safeStep(deck, n));
  return [steps, { kind: 'safe', name: goal }];
}

function toApproach(deck: RuntimeDeck, state: ArmState, name: string, index: number): [PlanStep[], ArmState] {
  const target = approachPose(deck, name, index);
  const here: ArmState = { kind: 'loc', name, index, down: false };
  const label = `${name}[${index}] approach`;
  if (state && state.kind === 'loc' && state.name === name) {
    const steps: PlanStep[] = [];
    if (state.down) {
      steps.push({ kind: 'movel', name: `${name}[${state.index}] approach`, target: approachPose(deck, name, state.index), slow: true,
        after: { kind: 'loc', name, index: state.index, down: false } });
    }
    if (state.index !== index) steps.push({ kind: 'movel', name: label, target, slow: false, after: here });
    return [steps, here];
  }
  const [steps] = toSafe(deck, state, loc(deck, name).safe_point);
  steps.push({ kind: 'movej_pose', name: label, target, slow: false, after: here });
  return [steps, here];
}

const into = (deck: RuntimeDeck, name: string, index: number): PlanStep =>
  ({ kind: 'movel', name: `${name}[${index}]`, target: slot(deck, name, index), slow: true, after: { kind: 'loc', name, index, down: true } });
const out = (deck: RuntimeDeck, name: string, index: number): PlanStep =>
  ({ kind: 'movel', name: `${name}[${index}] approach`, target: approachPose(deck, name, index), slow: true, after: { kind: 'loc', name, index, down: false } });
const grip = (open: boolean, after: ArmState): PlanStep => ({ kind: 'gripper', name: open ? 'open' : 'close', target: null, slow: false, after });

export function plan(deck: RuntimeDeck, action: Action, state: ArmState, location?: string, index = 0,
  destination?: string, destinationIndex = 0): PlanStep[] {
  if (action === 'home') return toSafe(deck, state, deck.home)[0];
  if (action === 'safe_point') {
    if (!location || !deck.safe_points[location]) throw new PlanError(`no safe point ${location}`);
    return toSafe(deck, state, location)[0];
  }
  if (!location) throw new PlanError(`${action} needs a location`);
  if (action === 'transfer') {
    if (!destination) throw new PlanError('transfer needs a destination');
    const first = plan(deck, 'pick', state, location, index);
    return [...first, ...plan(deck, 'place', first[first.length - 1].after, destination, destinationIndex)];
  }
  const [steps, here] = toApproach(deck, state, location, index);
  if (action === 'move_above') return steps;
  if (action === 'move_to') return [...steps, into(deck, location, index)];
  if (action === 'pick') {
    const down = into(deck, location, index);
    return [...steps, grip(true, here), down, grip(false, down.after), out(deck, location, index)];
  }
  if (action === 'place') {
    const down = into(deck, location, index);
    return [...steps, down, grip(true, down.after), out(deck, location, index)];
  }
  throw new PlanError(`unknown action ${action}`);
}
