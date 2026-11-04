// The viewport: the bench in the robot's base frame (z up, metres), the arm, the deck, the move and
// turn gizmo on whatever is selected, catalog cards dropped onto the bench, and the motion preview's
// clock (it advances here, in the render loop).
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, Line, OrbitControls, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Project } from '../../lib/deck';
import type { Joints } from '../../lib/kinematics';
import { sampleSegment } from '../../lib/motion';
import { ROBOTS } from '../../lib/robots';
import { useStore, type Selection } from '../../state';
import { ComponentBody, SafeNetwork, SafePointMarker, Slots, Waypoints } from './DeckItems';
import { RobotArm } from './RobotArm';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

// a gizmo drag ends with a click on whatever is under the pointer: do not let it clear the selection
let lastDragEnd = 0;
const justDragged = () => Date.now() - lastDragEnd < 250;

export type GizmoMode = 'translate' | 'rotate';

export type Projector = (clientX: number, clientY: number) => [number, number] | null;

interface SceneProps {
  project: Project;
  home: Joints | null;
  mode: GizmoMode;
  snap: boolean;
  showLabels: boolean;
  showPath: boolean;
  dark: boolean;
  itemsVersion: number;
  projector: React.RefObject<Projector | null>;
  onItemsChanged: () => void;
}

/** Turns a point on the screen into a point on the bench, for drops. */
function DropTarget({ projector, z }: { projector: React.RefObject<Projector | null>; z: number }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    projector.current = (clientX, clientY) => {
      const r = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), hit) ? [hit.x, hit.y] : null;
    };
    return () => {
      projector.current = null;
    };
  }, [camera, gl, projector, z]);
  return null;
}

/** Plays the motion preview: advances the clock, poses the arm, moves items in and out of the gripper. */
function PlayerTick({ project, onItemsChanged }: { project: Project; onItemsChanged: () => void }) {
  const { arm } = useStore();
  useFrame((_, dt) => {
    const a = arm.current;
    const run = a.player;
    if (!run || !run.running) return;
    const segs = run.traj.segments;
    run.t += Math.min(dt, 0.1) * run.speed;
    while (run.seg < segs.length && run.t >= run.segStart + segs[run.seg].duration) {
      const s = segs[run.seg];
      if (s.step.kind === 'gripper' && s.step.after?.kind === 'loc') {
        const key = `${s.step.after.name}[${s.step.after.index}]`;
        const c = project.components.find((x) => x.id === s.step.after!.name! as string);
        if (s.step.name === 'close') {
          const filled = a.occupancy.get(key) ?? c?.filled ?? false;
          if (filled) {
            a.carrying = c?.id ?? null;
            a.occupancy.set(key, false);
          }
        } else if (a.carrying) {
          a.occupancy.set(key, true);
          a.carrying = null;
        }
        onItemsChanged();
      }
      run.segStart += s.duration;
      run.seg++;
      run.onSegment(run.seg);
    }
    if (run.seg >= segs.length) {
      a.target = run.traj.end;
      a.grip = segs.length ? segs[segs.length - 1].gripTo : a.grip;
      run.running = false;
      a.playing = false;
      run.onEnd();
      return;
    }
    const { q, grip } = sampleSegment(segs[run.seg], run.t - run.segStart);
    a.playing = true;
    a.target = q;
    a.grip = grip;
  });
  return null;
}

function Content({ project, home, mode, snap, showLabels, showPath, dark, itemsVersion, projector, onItemsChanged }: SceneProps) {
  const { selection, select, update, checkpoint, arm } = useStore();
  const refs = useRef(new Map<string, THREE.Group>());
  const model = ROBOTS[project.robot.model];
  const size = Math.max(1.6, model.reach * 2.8);
  const occupancy = useMemo(() => new Map(arm.current.occupancy), [itemsVersion, arm]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (sel: Selection) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select(sel);
  };
  const key = selection ? `${selection.type}:${selection.id}` : '';
  const target = selection && selection.type !== 'waypoint' ? refs.current.get(key) : undefined;
  const selectedComponent = selection?.type === 'component' ? project.components.find((c) => c.id === selection.id) : undefined;
  const isBlock = selectedComponent?.kind === 'block';
  const canRotate = selection?.type === 'component';

  const onObjectChange = () => {
    if (!target || !selection) return;
    const p = target.position;
    const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
    if (selection.type === 'component') {
      let yaw = (target.rotation.z * 180) / Math.PI;
      yaw = ((((yaw + 180) % 360) + 360) % 360) - 180;
      update((pr) => ({
        ...pr,
        components: pr.components.map((c) => (c.id === selection.id
          ? { ...c, x: r6(p.x), y: r6(p.y), z: c.kind === 'block' ? c.z : r6(p.z), yaw: Math.round(yaw * 1000) / 1000 }
          : c)),
      }), undefined, false);
    } else {
      update((pr) => ({
        ...pr,
        safePoints: pr.safePoints.map((s) => (s.id === selection.id ? { ...s, x: r6(p.x), y: r6(p.y), z: r6(p.z), q: undefined, taughtFrom: undefined } : s)),
      }), undefined, false);
    }
  };

  const bench = dark ? '#1e293b' : '#e2e8f0';
  return (
    <>
      <hemisphereLight args={[dark ? '#cbd5e1' : '#ffffff', dark ? '#0f172a' : '#94a3b8', dark ? 1.4 : 1.8]} />
      <directionalLight position={[1.5, -1.0, 2.5]} intensity={dark ? 1.6 : 2.0} castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-1.5} shadow-camera-right={1.5} shadow-camera-top={1.5} shadow-camera-bottom={-1.5} />
      <OrbitControls makeDefault target={[0, 0.3, project.benchZ + 0.12]} maxDistance={6} minDistance={0.2} />
      <DropTarget projector={projector} z={project.benchZ} />
      <PlayerTick project={project} onItemsChanged={onItemsChanged} />

      <mesh position={[0, 0, project.benchZ - 0.001]} receiveShadow onClick={(e) => { e.stopPropagation(); if (!justDragged()) select(null); }}>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color={bench} roughness={0.95} />
      </mesh>
      <Grid args={[size, size]} position={[0, 0, project.benchZ + 0.0005]} rotation={[Math.PI / 2, 0, 0]} cellSize={0.05} sectionSize={0.25}
        cellColor={dark ? '#334155' : '#cbd5e1'} sectionColor={dark ? '#475569' : '#94a3b8'} fadeDistance={size * 1.5} cellThickness={0.6} sectionThickness={1} />
      {/* the datasheet reach, on the bench */}
      <Line points={Array.from({ length: 129 }, (_, i) => [Math.cos((i / 128) * 2 * Math.PI) * model.reach, Math.sin((i / 128) * 2 * Math.PI) * model.reach, project.benchZ + 0.001] as [number, number, number])}
        color={dark ? '#64748b' : '#94a3b8'} lineWidth={1} dashed dashSize={0.03} gapSize={0.02} />
      <axesHelper args={[0.12]} position={[0, 0, project.benchZ + 0.002]} />

      <RobotArm project={project} home={home} />

      {project.components.map((c) => {
        const sel = selection?.type === 'component' && selection.id === c.id;
        return (
          <group key={c.id}>
            <ComponentBody ref={(g) => { if (g) refs.current.set(`component:${c.id}`, g); else refs.current.delete(`component:${c.id}`); }}
              c={c} project={project} selected={sel} occupancy={occupancy} onPick={pick({ type: 'component', id: c.id })} showLabels={showLabels} />
            <Slots c={c} project={project} selected={sel} occupancy={occupancy} onPick={pick({ type: 'component', id: c.id })} />
          </group>
        );
      })}
      {project.safePoints.map((s) => (
        <SafePointMarker key={s.id} ref={(g) => { if (g) refs.current.set(`safe:${s.id}`, g); else refs.current.delete(`safe:${s.id}`); }}
          project={project} id={s.id} selected={selection?.type === 'safe' && selection.id === s.id} onPick={pick({ type: 'safe', id: s.id })} showLabels={showLabels} />
      ))}
      <SafeNetwork project={project} selection={selection} />
      <Waypoints project={project} selection={selection} showPath={showPath} onPick={(name) => select({ type: 'waypoint', id: name })} />

      {target && (
        <TransformControls
          object={target}
          mode={canRotate ? mode : 'translate'}
          size={0.7}
          showX={mode === 'translate' || !canRotate}
          showY={mode === 'translate' || !canRotate}
          showZ={(mode === 'translate' && !isBlock) || (mode === 'rotate' && canRotate)}
          translationSnap={snap ? 0.005 : null}
          rotationSnap={snap ? Math.PI / 36 : null}
          onMouseDown={() => checkpoint()}
          onMouseUp={() => { lastDragEnd = Date.now(); }}
          onObjectChange={onObjectChange}
        />
      )}
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#ffffff" />
      </GizmoHelper>
    </>
  );
}

export function Scene(props: SceneProps) {
  const { select } = useStore();
  return (
    <Canvas shadows camera={{ position: [0.85, 1.55, 1.15], up: [0, 0, 1], fov: 40, near: 0.01, far: 40 }}
      onPointerMissed={(e) => { if (e.type === 'click' && !justDragged()) select(null); }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
      <Content {...props} />
    </Canvas>
  );
}
