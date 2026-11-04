// Saving and opening decks: a project file (JSON), the browser's own copy between visits, downloads.
import { CATALOG, DEFAULT_GRIPPER, DEFAULT_MOTION, emptyProject, slug, type DeckComponent, type Project, type SafePointDef, type Waypoint } from './deck';
import type { Joints } from './kinematics';
import { ROBOTS, type RobotModelId } from './robots';

const KEY = 'arm-loc-helper/project@1';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const nums = (v: unknown, n: number): number[] | undefined =>
  Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : undefined;
const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A project from anything that might be one (an older save, a hand-edited file): missing fields get defaults. */
export function normalizeProject(raw: unknown): Project {
  const r = obj(raw);
  const base = emptyProject();
  const robot = obj(r.robot);
  const model = (Object.keys(ROBOTS).includes(robot.model as string) ? robot.model : base.robot.model) as RobotModelId;
  const kinds = ['tray', 'station', 'side_rack', 'block'];
  const usedIds = new Set<string>();
  const unique = (id: string) => { let s = id, i = 2; while (usedIds.has(s)) s = `${id}_${i++}`; usedIds.add(s); return s; };

  const safePoints: SafePointDef[] = (Array.isArray(r.safePoints) ? r.safePoints : []).map((x) => {
    const s = obj(x);
    const id = unique(slug(str(s.id, 'safe')));
    return { id, label: str(s.label, id), x: num(s.x, 0), y: num(s.y, 0.35), z: num(s.z, 0.4), heading: num(s.heading, 0),
      q: nums(s.q, 6) as Joints | undefined, taughtFrom: typeof s.taughtFrom === 'string' ? s.taughtFrom : undefined,
      links: Array.isArray(s.links) ? s.links.filter((l): l is string => typeof l === 'string') : [] };
  });
  const components: DeckComponent[] = (Array.isArray(r.components) ? r.components : []).map((x) => {
    const c = obj(x);
    const kind = (kinds.includes(c.kind as string) ? c.kind : 'station') as DeckComponent['kind'];
    const entry = CATALOG.find((e) => e.make().kind === kind)!;
    const d = entry.make();
    const id = unique(slug(str(c.id, d.label)));
    return {
      ...d, id, kind, label: str(c.label, id),
      x: num(c.x, 0.3), y: num(c.y, 0.3), z: num(c.z, d.z), yaw: num(c.yaw, 0),
      rows: Math.max(1, Math.round(num(c.rows, d.rows))), cols: Math.max(1, Math.round(num(c.cols, d.cols))),
      colPitch: num(c.colPitch, d.colPitch), rowPitch: num(c.rowPitch, d.rowPitch), approach: num(c.approach, d.approach),
      toolYaw: num(c.toolYaw, d.toolYaw), safePoint: str(c.safePoint, ''), size: (nums(c.size, 3) ?? d.size) as DeckComponent['size'],
      gripHeight: num(c.gripHeight, d.gripHeight), taught: nums(c.taught, 3) as DeckComponent['taught'],
      taughtFrom: typeof c.taughtFrom === 'string' ? c.taughtFrom : undefined, color: str(c.color, d.color),
      filled: typeof c.filled === 'boolean' ? c.filled : d.filled,
    };
  });
  const waypoints: Waypoint[] = (Array.isArray(r.waypoints) ? r.waypoints : []).map((x) => {
    const w = obj(x);
    return { name: str(w.name, 'waypoint'), pose: nums(w.pose, 6), q: nums(w.q, 6) as Joints | undefined };
  }).filter((w) => w.pose || w.q);
  const g = obj(r.gripper);
  const m = obj(r.motion);
  const name = str(r.name, base.name);
  const script = obj(r.script);
  return {
    version: 1,
    name,
    className: /^[A-Za-z_][A-Za-z0-9_]*$/.test(r.className as string) ? (r.className as string) : base.className,
    robot: { model, tcp: nums(robot.tcp, 6) ?? base.robot.tcp, payload: num(robot.payload, base.robot.payload) },
    benchZ: num(r.benchZ, 0),
    gripper: {
      type: (['robotiq', 'digital_out', 'none'].includes(g.type as string) ? g.type : DEFAULT_GRIPPER.type) as Project['gripper']['type'],
      speed: num(g.speed, DEFAULT_GRIPPER.speed), force: num(g.force, DEFAULT_GRIPPER.force), pin: num(g.pin, 0),
      tool: g.tool === true, closeLevel: g.closeLevel !== false,
    },
    motion: Object.fromEntries(Object.entries(DEFAULT_MOTION).map(([k, v]) => [k, num(m[k], v)])) as unknown as Project['motion'],
    home: safePoints.some((s) => s.id === r.home) ? (r.home as string) : safePoints[0]?.id ?? 'home',
    components,
    safePoints: safePoints.length ? safePoints : base.safePoints,
    waypoints,
    script: script.fileName ? {
      fileName: str(script.fileName, ''), tcp: nums(script.tcp, 6),
      sequence: (Array.isArray(script.sequence) ? script.sequence : []).map((s) => obj(s)).map((s) => ({ move: str(s.move, 'movej'), target: str(s.target, '') })),
    } : undefined,
  };
}

export function loadSaved(): Project | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? normalizeProject(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

export function saveLocal(p: Project): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // private window, storage full: the deck still works, it just will not be there next time
  }
}

export function download(fileName: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const projectFileName = (p: Project) => `${slug(p.name) || 'deck'}.deck.json`;
