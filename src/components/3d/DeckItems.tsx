// The deck on screen: each component's body, its slots (coloured by reach), approach points and
// the line in, the safe points and their links, and the waypoints read from a .script file.
import { forwardRef, useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { componentReach, type Reach } from '../../lib/checks';
import { approachMatrix, linksOf, slotCount, slotMatrix, slotOffset, type DeckComponent, type Project } from '../../lib/deck';
import { fk } from '../../lib/kinematics';
import { fromPose, multiply, type Mat4 } from '../../lib/mat4';
import { ROBOTS } from '../../lib/robots';
import { flangeToTcp, safePointTcp } from '../../lib/runtimeDeck';
import type { Selection } from '../../state';
import { itemKind } from '../../lib/items';
import { Item } from './items';

const REACH_COLOR: Record<Reach, string> = { ok: '#14b8a6', elbow_down: '#f59e0b', none: '#ef4444' };

const toThree = (m: Mat4) => new THREE.Matrix4().set(...(m as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]));
const pos = (m: Mat4): [number, number, number] => [m[3], m[7], m[11]];

/** The body of a component, in its own frame (origin at slot 0's grip point, unturned). */
function Body({ c, benchZ, selected }: { c: DeckComponent; benchZ: number; selected: boolean }) {
  const floor = benchZ - c.z; // the bench, in the component's frame
  const color = selected ? new THREE.Color(c.color).offsetHSL(0, 0, 0.12) : c.color;
  const mat = <meshStandardMaterial color={color} roughness={0.7} />;
  if (c.kind === 'block') {
    return (
      <mesh position={[0, 0, c.size[2] / 2]} castShadow receiveShadow>
        <boxGeometry args={c.size} />
        {mat}
      </mesh>
    );
  }
  if (c.kind === 'side_rack') {
    const width = Math.max(c.size[1], (c.cols - 1) * c.colPitch + 0.045);
    const top = (c.rows - 1) * c.rowPitch + 0.025;
    const height = top - floor;
    const cy = ((c.cols - 1) * c.colPitch) / 2;
    const depth = c.size[0];
    return (
      <group>
        <mesh position={[depth, cy, floor + height / 2]} castShadow receiveShadow>
          <boxGeometry args={[0.008, width, height]} />
          {mat}
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[depth / 2, cy + side * (width / 2 - 0.003), floor + height / 2]} castShadow>
            <boxGeometry args={[depth, 0.006, height]} />
            {mat}
          </mesh>
        ))}
        {Array.from({ length: slotCount(c) }, (_, i) => {
          const [, y, z] = slotOffset(c, i);
          // two rails per slot, parallel to the bench and to the insertion axis
          return [-1, 1].map((side) => (
            <mesh key={`${i}${side}`} position={[depth / 2, y + side * 0.0145, z - 0.004]} rotation={[0, Math.PI / 2, 0]}>
              <cylinderGeometry args={[0.0025, 0.0025, depth, 8]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.3} />
            </mesh>
          ));
        })}
      </group>
    );
  }
  // tray / station: a block under the grip points, its top gripHeight below them
  const spanX = c.kind === 'tray' ? (c.cols - 1) * c.colPitch : 0;
  const spanY = c.kind === 'tray' ? (c.rows - 1) * c.rowPitch : 0;
  const w = Math.max(c.size[0], spanX + 0.02), d = Math.max(c.size[1], spanY + 0.02);
  const top = -c.gripHeight;
  const h = Math.max(0.004, top - floor);
  return (
    <mesh position={[spanX / 2, spanY / 2, top - h / 2]} castShadow receiveShadow>
      <boxGeometry args={[w, d, h]} />
      {mat}
    </mesh>
  );
}

interface ComponentProps {
  c: DeckComponent;
  project: Project;
  selected: boolean;
  occupancy: Map<string, boolean>;
  onPick: (e: ThreeEvent<MouseEvent>) => void;
  showLabels: boolean;
}

/** The component's group (what the move/turn gizmo drags) holds the body; slots are drawn in the base frame. */
export const ComponentBody = forwardRef<THREE.Group, ComponentProps>(function ComponentBody({ c, project, selected, onPick, showLabels }, ref) {
  const z = c.kind === 'block' ? project.benchZ : c.z;
  return (
    <group ref={ref} position={[c.x, c.y, z]} rotation={[0, 0, (c.yaw * Math.PI) / 180]} onClick={onPick} userData={{ id: c.id }}>
      <Body c={c} benchZ={project.benchZ} selected={selected} />
      {showLabels && (
        <Html position={[0, 0, c.kind === 'block' ? c.size[2] + 0.03 : c.approach + 0.03]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`label3d ${selected ? 'selected' : ''}`}>{c.label}</div>
        </Html>
      )}
    </group>
  );
});

export function Slots({ c, project, selected, occupancy, onPick }: Omit<ComponentProps, 'showLabels'>) {
  const reach = useMemo(() => componentReach(project, c), [project, c]);
  const n = slotCount(c);
  const kind = itemKind(c);
  if (!n) return null;
  return (
    <group onClick={onPick}>
      {Array.from({ length: n }, (_, i) => {
        const s = slotMatrix(c, i), a = approachMatrix(c, i);
        const filled = occupancy.get(`${c.id}[${i}]`) ?? c.filled;
        const color = REACH_COLOR[reach.slots[i] === 'none' || reach.approaches[i] === 'none' ? 'none' : reach.slots[i]];
        return (
          <group key={i}>
            <mesh position={pos(s)}>
              <sphereGeometry args={[selected ? 0.0045 : 0.0035, 10, 10]} />
              <meshBasicMaterial color={color} />
            </mesh>
            {(selected || i === 0) && <Line points={[pos(s), pos(a)]} color={color} lineWidth={1} dashed dashSize={0.006} gapSize={0.004} />}
            {(selected || i === 0) && (
              <mesh position={pos(a)}>
                <octahedronGeometry args={[0.005]} />
                <meshBasicMaterial color={color} wireframe />
              </mesh>
            )}
            {filled && kind && (
              <group matrixAutoUpdate={false} matrix={toThree(s)}>
                <Item c={c} />
              </group>
            )}
          </group>
        );
      })}
      {/* the tool axis at slot 0: where the gripper points */}
      {(() => {
        const s = slotMatrix(c, 0);
        const tip: [number, number, number] = [s[3] - s[2] * 0.05, s[7] - s[6] * 0.05, s[11] - s[10] * 0.05];
        return <Line points={[tip, pos(s)]} color="#06b6d4" lineWidth={2} />;
      })()}
    </group>
  );
}

export const SafePointMarker = forwardRef<THREE.Group, { project: Project; id: string; selected: boolean; onPick: (e: ThreeEvent<MouseEvent>) => void; showLabels: boolean }>(
  function SafePointMarker({ project, id, selected, onPick, showLabels }, ref) {
    const s = project.safePoints.find((x) => x.id === id)!;
    const m = safePointTcp(s, project);
    const home = project.home === id;
    return (
      <group ref={ref} position={pos(m)} onClick={onPick}>
        <mesh>
          <octahedronGeometry args={[selected ? 0.022 : 0.017]} />
          <meshStandardMaterial color={home ? '#22c55e' : '#f59e0b'} emissive={selected ? '#f59e0b' : '#000000'} emissiveIntensity={0.4} />
        </mesh>
        <Line points={[[0, 0, 0], [-m[2] * 0.06, -m[6] * 0.06, -m[10] * 0.06]]} color="#f59e0b" lineWidth={1} />
        {showLabels && (
          <Html position={[0, 0, 0.04]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div className={`label3d safe ${selected ? 'selected' : ''}`}>{home ? `⌂ ${s.label}` : s.label}{s.q ? ' · taught' : ''}</div>
          </Html>
        )}
      </group>
    );
  });

/** Links between safe points, and from each component to the safe point it is entered from. */
export function SafeNetwork({ project, selection }: { project: Project; selection: Selection }) {
  const at = new Map(project.safePoints.map((s) => [s.id, pos(safePointTcp(s, project))]));
  const lines: { a: [number, number, number]; b: [number, number, number]; key: string; strong: boolean; dashed: boolean }[] = [];
  for (const [a, bs] of linksOf(project)) for (const b of bs) {
    if (a < b) lines.push({ a: at.get(a)!, b: at.get(b)!, key: `${a}-${b}`, strong: true, dashed: false });
  }
  for (const c of project.components) {
    const sp = at.get(c.safePoint);
    if (!sp || !slotCount(c)) continue;
    const sel = selection?.type === 'component' && selection.id === c.id;
    lines.push({ a: pos(approachMatrix(c, 0)), b: sp, key: `c-${c.id}`, strong: sel, dashed: true });
  }
  return (
    <group>
      {lines.map((l) => (
        <Line key={l.key} points={[l.a, l.b]} color={l.strong ? '#f59e0b' : '#94a3b8'} lineWidth={l.strong ? 1.5 : 1}
          transparent opacity={l.strong ? 0.9 : 0.45} dashed={l.dashed} dashSize={0.015} gapSize={0.01} />
      ))}
    </group>
  );
}

export function Waypoints({ project, selection, showPath, onPick }: { project: Project; selection: Selection; showPath: boolean; onPick: (name: string) => void }) {
  const T_FT = flangeToTcp(project);
  const params = ROBOTS[project.robot.model].params;
  const where = new Map(project.waypoints.map((w) => [w.name, w.pose ? fromPose(w.pose) : multiply(fk(w.q!, params), T_FT)]));
  const path = (project.script?.sequence ?? []).map((s) => where.get(s.target)).filter((m): m is Mat4 => !!m).map(pos);
  return (
    <group>
      {project.waypoints.map((w) => {
        const m = where.get(w.name)!;
        const sel = selection?.type === 'waypoint' && selection.id === w.name;
        return (
          <group key={w.name} position={pos(m)} onClick={(e) => { e.stopPropagation(); onPick(w.name); }}>
            <mesh>
              <sphereGeometry args={[sel ? 0.011 : 0.007, 12, 12]} />
              <meshStandardMaterial color={w.pose ? '#ec4899' : '#a855f7'} />
            </mesh>
            <Line points={[[0, 0, 0], [-m[2] * 0.04, -m[6] * 0.04, -m[10] * 0.04]]} color="#ec4899" lineWidth={1} />
            {sel && (
              <Html position={[0, 0, 0.03]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
                <div className="label3d waypoint selected">{w.name}</div>
              </Html>
            )}
          </group>
        );
      })}
      {showPath && path.length > 1 && <Line points={path} color="#ec4899" lineWidth={1.5} transparent opacity={0.7} />}
    </group>
  );
}
