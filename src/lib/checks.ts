// What the editor recommends: problems that would stop the controller (errors), things that
// work but are likely not what was meant (warnings), and habits that make a deck easier to run
// (tips). Most come with a one-click fix.
import {
  approachMatrix, gripOf, linksOf, nearestSafePoint, skillOf, slotCount, slotMatrix, slotRotation, tiltFromSkill,
  type DeckComponent, type Project,
} from './deck';
import { itemKind, itemWidth } from './items';
import { ik, elbowUp } from './kinematics';
import { column, type Mat4 } from './mat4';
import { ROBOTS } from './robots';
import { safePointTcp, tcpToFlange } from './runtimeDeck';
import { TOOLS, closedGap, fingerAxisOf } from './tools';

export type Level = 'error' | 'warning' | 'tip';

export interface Fix {
  label: string;
  apply: (p: Project) => Project;
}

export interface Finding {
  level: Level;
  target?: string;     // the id of a component or safe point
  title: string;
  detail?: string;
  fix?: Fix;
}

export type Reach = 'ok' | 'elbow_down' | 'none';

/** Whether the arm can put its TCP at `tcp`, and in which posture. */
export function reach(p: Project, tcp: Mat4): Reach {
  const sols = ik(tcpToFlange(tcp, p), ROBOTS[p.robot.model].params);
  if (!sols.length) return 'none';
  return sols.some(elbowUp) ? 'ok' : 'elbow_down';
}

export interface ComponentReach { slots: Reach[]; approaches: Reach[] }

export function componentReach(p: Project, c: DeckComponent): ComponentReach {
  const n = slotCount(c);
  return {
    slots: Array.from({ length: n }, (_, i) => reach(p, slotMatrix(c, i, p))),
    approaches: Array.from({ length: n }, (_, i) => reach(p, approachMatrix(c, i, p))),
  };
}

/**
 * What the fingers have to open to at a component, and what they may: `need` is the gap that just
 * holds its item, `limit` the gap at which they reach the next item along the way they open (a tray
 * of vials; null when nothing is that way). The limit takes the fingers as having no thickness of
 * their own (pins: as they are), so a real gripper is into the next item a little sooner.
 */
export function openRange(p: Project, c: DeckComponent): { need: number; limit: number | null; stroke: number } | null {
  const width = itemWidth(c);
  if (width == null) return null;
  const tool = TOOLS[p.gripper.model];
  const grip = gripOf(p), byPins = grip[0] !== 1;
  const need = closedGap(tool, width, byPins);
  let limit: number | null = null;
  if (c.kind === 'tray' && itemKind(c) === 'vial') {
    // the way the fingers open, in the tray's own frame
    const along: number[] = byPins ? column(grip, 1) : fingerAxisOf(p.robot.tcp, tool, p.gripper.fingerAxis) === 'y' ? [0, 1, 0] : [1, 0, 0];
    const r = slotRotation(c, p);
    const bx = r[0] * along[0] + r[1] * along[1] + r[2] * along[2], by = r[4] * along[0] + r[5] * along[1] + r[6] * along[2];
    const a = (c.yaw * Math.PI) / 180, flat = Math.hypot(bx, by);
    if (flat > 0.9) {
      const fx = (Math.cos(a) * bx + Math.sin(a) * by) / flat, fy = (-Math.sin(a) * bx + Math.cos(a) * by) / flat;
      const extra = byPins && tool.rods ? tool.rods.offset + tool.rods.radius : 0; // a pin's far side, out from the finger's face
      for (const i of c.cols > 1 ? [-1, 0, 1] : [0]) for (const j of c.rows > 1 ? [-1, 0, 1] : [0]) {
        if (!i && !j) continue;
        const nx = i * c.colPitch, ny = j * c.rowPitch;
        const ahead = Math.abs(nx * fx + ny * fy), aside = Math.abs(nx * fy - ny * fx);
        if (aside >= width / 2) continue; // that one is not in the fingers' way
        const edge = ahead - Math.sqrt((width / 2) ** 2 - aside ** 2);
        limit = Math.min(limit ?? Infinity, Math.max(0, 2 * (edge - extra)));
      }
    }
  }
  return { need, limit, stroke: tool.stroke };
}

const mm = (m: number) => `${Math.round(m * 1000)} mm`;
const patch = (id: string, change: Partial<DeckComponent>) => (p: Project): Project =>
  ({ ...p, components: p.components.map((c) => (c.id === id ? { ...c, ...change } : c)) });

export function checkProject(p: Project): Finding[] {
  const out: Finding[] = [];
  const model = ROBOTS[p.robot.model];
  const ids = new Set(p.safePoints.map((s) => s.id));

  if (!p.safePoints.length) {
    out.push({ level: 'error', title: 'No safe points', detail: 'Every move goes through safe points. Drag a safe point onto the deck.' });
    return out;
  }
  if (!ids.has(p.home)) {
    out.push({ level: 'error', title: `Home (${p.home}) is not a safe point`,
      fix: { label: `Make ${p.safePoints[0].id} home`, apply: (q) => ({ ...q, home: q.safePoints[0].id }) } });
  }

  // the safe network must connect every safe point to home
  const links = linksOf(p);
  const seen = new Set<string>([p.home]);
  const queue = [p.home];
  while (queue.length) for (const n of links.get(queue.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  for (const s of p.safePoints) {
    if (ids.has(p.home) && !seen.has(s.id)) {
      out.push({ level: 'error', target: s.id, title: `${s.label} is cut off from home`,
        detail: 'No chain of links leads there, so nothing entered from it can be reached.',
        fix: { label: `Link it to ${p.home}`, apply: (q) => ({ ...q, safePoints: q.safePoints.map((t) => (t.id === s.id ? { ...t, links: [...t.links, q.home] } : t)) }) } });
    }
    const r = reach(p, safePointTcp(s, p));
    if (r === 'none') out.push({ level: 'error', target: s.id, title: `${s.label} is out of reach`, detail: `The ${model.label} cannot get its TCP there.` });
  }

  const tcp = p.robot.tcp;
  const scriptTcp = p.script?.tcp;
  if (scriptTcp && scriptTcp.some((v, i) => Math.abs(v - tcp[i]) > 1e-6)) {
    out.push({ level: 'warning', title: `${p.script!.fileName} sets a different TCP`,
      detail: `The script uses set_tcp(p[${scriptTcp.map((v) => +v.toFixed(4)).join(', ')}]); its waypoints are poses of that TCP.`,
      fix: { label: 'Use the script\'s TCP', apply: (q) => ({ ...q, robot: { ...q.robot, tcp: [...scriptTcp] } }) } });
  }
  if (tcp.every((v) => v === 0)) {
    out.push({ level: 'tip', title: 'The TCP is the bare flange',
      detail: 'Poses are where the TCP is. Set it to the gripper\'s fingertips (a Robotiq 2F-85 is about 150-175 mm) so slots mean where the item is held.' });
  }
  if (p.motion.approach_speed > 0.1) {
    out.push({ level: 'tip', title: `Approach speed ${mm(p.motion.approach_speed)}/s`,
      detail: 'The last straight line into a slot is usually 20-50 mm/s, slow enough to stop before damage.',
      fix: { label: 'Use 40 mm/s', apply: (q) => ({ ...q, motion: { ...q.motion, approach_speed: 0.04 } }) } });
  }

  for (const c of p.components) {
    const skill = skillOf(c);
    if (!skill) continue;
    const name = c.label;
    if (!ids.has(c.safePoint)) {
      const near = nearestSafePoint(p, c.x, c.y, c.z);
      out.push({ level: 'error', target: c.id, title: `${name} has no safe point`, detail: `It names "${c.safePoint}", which is not on the deck.`,
        fix: near ? { label: `Enter it from ${near}`, apply: patch(c.id, { safePoint: near }) } : undefined });
    }

    const r = componentReach(p, c);
    const n = r.slots.length;
    const badSlots = r.slots.filter((x) => x === 'none').length;
    const badApproach = r.approaches.filter((x) => x === 'none').length;
    if (badSlots) out.push({ level: 'error', target: c.id, title: `${name}: ${badSlots === n ? 'out of reach' : `${badSlots} of ${n} slots out of reach`}`, detail: `The ${model.label} reaches about ${model.reach * 1000} mm.` });
    else if (badApproach) out.push({ level: 'error', target: c.id, title: `${name}: approach point out of reach`, detail: `${mm(c.approach)} out is too far; shorten the approach or move it closer.` });
    else if (r.slots.some((x) => x === 'elbow_down')) {
      out.push({ level: 'warning', target: c.id, title: `${name} needs the elbow down`, detail: 'The arm can only get there with its elbow below the shoulder, where it sweeps low over the bench. Move it closer, or higher.' });
    }

    // how far the gripper opens here: wide enough for the item, not so wide it is into the next one
    const range = openRange(p, c);
    if (range) {
      const { need, limit, stroke } = range;
      const gap = (stroke * c.openTo) / 100;
      const pct = (g: number) => Math.round((g / stroke) * 100);
      const room = limit != null && need + 0.003 < limit ? Math.min(100, pct((need + limit) / 2)) : null; // midway between the two
      if (limit != null && gap >= limit) {
        out.push({ level: 'warning', target: c.id, title: `${name}: the fingers open into the next vial`,
          detail: `Open to ${c.openTo}% the fingers are ${mm(gap)} apart, and the next vial is in their way from ${mm(limit)}.`
            + (room == null ? ' This gripper has no room between these vials.' : ''),
          fix: room == null ? undefined : { label: `Open to ${room}%`, apply: patch(c.id, { openTo: room }) } });
      } else if (need + 0.002 <= stroke && gap < need + 0.002) {
        const wide = room ?? Math.min(100, pct(need + 0.006));
        out.push({ level: 'warning', target: c.id, title: `${name}: the fingers do not open enough for the item`,
          detail: `Open to ${c.openTo}% the fingers are ${mm(gap)} apart; the item needs ${mm(need)}.`,
          fix: { label: `Open to ${wide}%`, apply: patch(c.id, { openTo: wide }) } });
      }
    }
    if (c.openTo < 100 && p.gripper.type === 'digital_out') {
      out.push({ level: 'warning', target: c.id, title: `${name}: this gripper only opens fully`,
        detail: `A gripper on a digital output is open or closed, so the ${c.openTo}% set here is not used on the robot.` });
    }

    const tilt = tiltFromSkill(c, p);
    if (tilt > 0.5) {
      out.push({ level: 'warning', target: c.id,
        title: skill === 'top_down' ? `${name}: tool ${tilt.toFixed(1)}° off vertical` : `${name}: tool ${tilt.toFixed(1)}° off the rack axis`,
        detail: skill === 'top_down'
          ? `The taught pose${c.taughtFrom ? ` (${c.taughtFrom})` : ''} tips the gripper, so it grabs at an angle and the straight move in and out is not along the item. Lab pick-and-place is almost always perpendicular.`
          : `The taught pose${c.taughtFrom ? ` (${c.taughtFrom})` : ''} is not along the insertion axis, so the item goes in at an angle to the rails.`,
        fix: { label: skill === 'top_down' ? 'Snap to vertical' : 'Snap to the rack axis', apply: patch(c.id, { taught: undefined }) } });
    }
    if (skill === 'side_load') {
      const off = ((c.yaw % 90) + 90) % 90;
      const d = Math.min(off, 90 - off);
      if (d > 0.5) {
        const snapped = Math.round(c.yaw / 90) * 90;
        out.push({ level: 'tip', target: c.id, title: `${name}: insertion ${d.toFixed(1)}° off the robot's X/Y`,
          detail: 'Racks squared to the robot are easier to teach and check: jogging along base X or Y on the pendant is then the insertion.',
          fix: { label: `Turn it to ${snapped}°`, apply: patch(c.id, { yaw: snapped }) } });
      }
    }
    if (c.approach < 0.02) {
      out.push({ level: 'warning', target: c.id, title: `${name}: approach only ${mm(c.approach)}`,
        detail: 'The fingers start that close to the item; neighbours or the rack may be in the way.',
        fix: { label: skill === 'top_down' ? 'Use 60 mm' : 'Use 80 mm', apply: patch(c.id, { approach: skill === 'top_down' ? 0.06 : 0.08 }) } });
    }
    if (c.z < p.benchZ + 0.003) out.push({ level: 'error', target: c.id, title: `${name} grips below the bench` });

    const sp = p.safePoints.find((s) => s.id === c.safePoint);
    if (sp) {
      const spAt = safePointTcp(sp, p);
      const top = Math.max(...Array.from({ length: n }, (_, i) => approachMatrix(c, i, p)[11]));
      if (spAt[11] < top - 0.01) {
        out.push({ level: 'warning', target: c.id, title: `${name}: safe point ${sp.label} is below its approach`,
          detail: 'The arm comes from the safe point down into the approach point; a safe point lower than that drags the gripper across the stations.' });
      }
      const far = Math.hypot(spAt[3] - c.x, spAt[7] - c.y);
      if (far > 0.5) {
        out.push({ level: 'tip', target: c.id, title: `${name} is ${mm(far)} from ${sp.label}`,
          detail: 'The joint move from a far safe point to the approach point is the least predictable part of the path. A safe point near it keeps that move short.' });
      }
    }
  }
  const rank: Record<Level, number> = { error: 0, warning: 1, tip: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
