// From points taught on the pendant (a .script's waypoints) to the deck: a component placed so its
// slot 0 is the taught point, keeping the taught orientation until it is snapped to the skill's, and
// safe points that keep the taught joints exactly.
import {
  CATALOG, SKILL, allIds, makeComponent, slug, uniqueId, yawFromOrientation,
  type DeckComponent, type Project, type SafePointDef, type Waypoint,
} from './deck';
import { fk, type Joints } from './kinematics';
import { fromPose, multiply, toAxisAngle, type Mat4 } from './mat4';
import { ROBOTS } from './robots';
import { flangeToTcp } from './runtimeDeck';

/** Where a waypoint puts the TCP: its pose, or its joints through the arm's kinematics and the TCP. */
export function waypointMatrix(w: Waypoint, p: Project): Mat4 {
  if (w.pose) return fromPose(w.pose);
  return multiply(fk(w.q!, ROBOTS[p.robot.model].params), flangeToTcp(p));
}

/** The component moved and turned so slot 0 is the waypoint, with the waypoint's orientation. */
export function anchorTo(c: DeckComponent, w: Waypoint, p: Project): DeckComponent {
  const m = waypointMatrix(w, p);
  if (!SKILL[c.kind]) return { ...c, x: m[3], y: m[7] };
  const yaw = yawFromOrientation(c.kind, m, c.toolYaw);
  return { ...c, x: m[3], y: m[7], z: m[11], yaw: Math.round(yaw * 1000) / 1000, taught: toAxisAngle(m), taughtFrom: w.name };
}

export function componentFromWaypoint(catalogKey: string, w: Waypoint, p: Project): DeckComponent {
  const entry = CATALOG.find((e) => e.key === catalogKey)!;
  const m = waypointMatrix(w, p);
  const c = makeComponent(entry, p, m[3], m[7]);
  const named = { ...c, id: uniqueId(slug(w.name), allIds(p)), label: w.name.replace(/_/g, ' ') };
  return anchorTo(named, w, p);
}

export function safePointFromWaypoint(w: Waypoint, p: Project): SafePointDef {
  const m = waypointMatrix(w, p);
  return {
    id: uniqueId(slug(w.name), allIds(p)),
    label: w.name.replace(/_/g, ' '),
    x: m[3], y: m[7], z: m[11],
    heading: (Math.atan2(m[4], m[0]) * 180) / Math.PI,
    q: w.q ? ([...w.q] as Joints) : undefined,
    taughtFrom: w.name,
    links: p.safePoints.map((s) => s.id),
  };
}
