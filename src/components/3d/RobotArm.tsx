// The arm: the ros-industrial URDF (meshes from the CDN), the chosen end effector drawn back from
// the TCP with whatever holds it to the flange (a spacer, a 90° bracket), and what it carries.
// Joints and the gripper's opening come from the store's arm view every frame.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
import { gripOf, type Project } from '../../lib/deck';
import { itemWidth } from '../../lib/items';
import type { Joints } from '../../lib/kinematics';
import { fromPose } from '../../lib/mat4';
import { JOINT_NAMES, MESH_CDN, PAINT, ROBOTS, paintOf } from '../../lib/robots';
import { BRACKET_90, FLANGE_RADIUS, PLATE, TOOLS, TOOL_PACKAGES, closedGap, fingerAxisOf, fingerJoint, placeTool, type FingerRods, type MountShape, type ToolModel } from '../../lib/tools';
import { useStore } from '../../state';
import { Item } from './items';

/** A CB3 mesh's materials, set to the e-Series' paint (see PAINT). */
function repaintMesh(mesh: THREE.Object3D) {
  const srgb = { r: 0, g: 0, b: 0 };
  mesh.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      const phong = mat as THREE.MeshPhongMaterial;
      if (!phong.color) continue;
      phong.color.getRGB(srgb, THREE.SRGBColorSpace);
      const paint = PAINT[paintOf(mat.name, [srgb.r, srgb.g, srgb.b])];
      phong.color.setRGB(paint.color[0], paint.color[1], paint.color[2], THREE.SRGBColorSpace);
      if (phong.specular) {
        phong.specular.setScalar(paint.specular);
        phong.shininess = 30;
      }
    }
  });
}

function useRobot(urdf: string, repaint = false): URDFRobot | null {
  const [robot, setRobot] = useState<URDFRobot | null>(null);
  useEffect(() => {
    let alive = true;
    const loader = new URDFLoader();
    loader.packages = { ur_description: MESH_CDN };
    if (repaint) {
      // as each mesh arrives, before it is drawn
      loader.loadMeshCb = (path, manager, material, done) => {
        loader.defaultMeshLoader(path, manager, material, (mesh, err) => {
          if (mesh) repaintMesh(mesh);
          done(mesh, err);
        });
      };
    }
    // BASE_URL, not "/": the page may be served from a subpath (/plugins/arm_loc_helper/)
    loader.load(`${import.meta.env.BASE_URL}${urdf}`, (r) => {
      if (!alive) return;
      r.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      setRobot(r);
    });
    return () => {
      alive = false;
    };
  }, [urdf, repaint]);
  return robot;
}

/** A 4x4 (row-major) as a three.js matrix. */
function toThree(m: number[]): THREE.Matrix4 {
  return new THREE.Matrix4().set(...(m as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]));
}

const BLACK = '#1f2937', STEEL = '#9ca3af', TEAL = '#5eb8b0';

/** A cylinder along z from z0 to z1. */
function Rod({ r, z0, z1, color, metal = 0.3 }: { r: number; z0: number; z1: number; color: string; metal?: number }) {
  return (
    <mesh position={[0, 0, (z0 + z1) / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[r, r, Math.max(0.001, z1 - z0), 28]} />
      <meshStandardMaterial color={color} metalness={metal} roughness={0.5} />
    </mesh>
  );
}

/** The tool's own URDF with every mesh in, or null: none for this tool, still loading, or a mesh did not arrive. */
function useToolModel(tool: ToolModel): URDFRobot | null {
  const urdf = tool.model?.urdf;
  const [loaded, setLoaded] = useState<{ urdf: string; robot: URDFRobot } | null>(null);
  useEffect(() => {
    if (!urdf) return;
    let alive = true, failed = false, pending = 0;
    let robot: URDFRobot | null = null;
    const settle = () => {
      if (!alive || failed || !robot || pending) return;
      robot.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      setLoaded({ urdf, robot });
    };
    const loader = new URDFLoader();
    loader.packages = TOOL_PACKAGES;
    // count the meshes ourselves: three shares a download between loaders asking for the same file, so
    // a loading manager's "all done" can come before this gripper's meshes have
    loader.loadMeshCb = (path, manager, material, done) => {
      pending++;
      loader.defaultMeshLoader(path, manager, material, (mesh, err) => {
        done(mesh, err);
        if (err) {
          failed = true;
          console.warn(`A gripper mesh did not load (${path}); drawing its stand-in.`);
        }
        pending--;
        settle();
      });
    };
    loader.load(`${import.meta.env.BASE_URL}${urdf}`, (r) => {
      robot = r;
      settle();
    }, undefined, () => {
      failed = true;
    });
    return () => {
      alive = false;
    };
  }, [urdf]);
  return loaded && loaded.urdf === urdf ? loaded.robot : null;
}

/**
 * The end effector in the TCP's frame: fingertips at the origin, its body back along -z, fingers
 * opening along x. The tool's meshes when it has them and they are in, a stand-in of boxes if not.
 */
function Gripper({ tool, length, tilt, gapNow }: { tool: ToolModel; length: number; tilt: number; gapNow: () => number }) {
  const model = useToolModel(tool);
  const pads = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  const links = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  const linkage = tool.style === 'linkage';
  const finger = Math.min(tool.fingerLength, length - 0.02);
  const pad = linkage ? Math.min(0.045, finger * 0.55) : finger; // the part that touches the item
  const knuckle = 0.03;                                          // where a 2F's links leave the palm

  useFrame(() => {
    const gap = gapNow();
    if (model) {
      model.joints[tool.model!.joint]?.setJointValue(fingerJoint(tool, gap)!);
      if (tool.tilt) model.joints[tool.tilt.joint]?.setJointValue(tilt);
      return;
    }
    [1, -1].forEach((side, i) => {
      const x = side * (gap / 2 + 0.005);
      if (pads[i].current) pads[i].current!.position.x = x;
      const link = links[i].current;
      if (link) {
        // from the palm's knuckle to the top of the pad
        const dx = x - side * knuckle, dz = finger - pad;
        link.position.set(side * knuckle + dx / 2, 0, -finger + dz / 2);
        link.rotation.y = Math.atan2(dx, dz);
        link.scale.z = Math.hypot(dx, dz);
      }
    });
  });

  if (model) return <primitive object={model} position={[0, 0, -length]} dispose={null} />;
  return (
    <group>
      {linkage ? (
        <>
          <Rod r={tool.bodyRadius} z0={-length} z1={-length + 0.035} color={BLACK} />
          <mesh position={[0, 0, (-length + 0.035 - finger) / 2]} castShadow>
            <boxGeometry args={[0.076, 0.046, Math.max(0.005, length - 0.035 - finger)]} />
            <meshStandardMaterial color={BLACK} roughness={0.5} />
          </mesh>
          {links.map((ref, i) => (
            <mesh key={i} ref={ref} castShadow>
              <boxGeometry args={[0.014, 0.024, 1]} />
              <meshStandardMaterial color={BLACK} roughness={0.5} />
            </mesh>
          ))}
        </>
      ) : (
        <>
          <Rod r={tool.bodyRadius} z0={-length} z1={-finger - 0.016} color={BLACK} />
          <mesh position={[0, 0, -finger - 0.008]} castShadow>
            <boxGeometry args={[Math.max(tool.stroke + 0.03, tool.bodyRadius * 1.6), 0.03, 0.016]} />
            <meshStandardMaterial color={BLACK} roughness={0.5} />
          </mesh>
        </>
      )}
      {pads.map((ref, i) => (
        <mesh key={i} ref={ref} position={[(i ? -1 : 1) * tool.stroke / 2, 0, -pad / 2]} castShadow>
          <boxGeometry args={[0.01, 0.022, pad]} />
          <meshStandardMaterial color={STEEL} metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * The pins fixed in a tool's fingers, in the gripper's frame: fingertips at the origin, fingers
 * opening along x. They are part of the gripper: they stick out of the fingers' bosses along -y and
 * turn with it, wherever the TCP is.
 */
function Pins({ tool, rods, gapNow }: { tool: ToolModel; rods: FingerRods; gapNow: () => number }) {
  const pins = useRef<(THREE.Mesh | null)[]>([]);
  const places = useMemo(() => [1, -1].flatMap((side) => rods.back.map((back) => ({ side, back }))), [rods]);
  const length = rods.reach + rods.past - rods.from;
  const y = -(rods.from + length / 2);

  useFrame(() => {
    const gap = gapNow();
    places.forEach(({ side, back }, i) => pins.current[i]?.position.set(side * (gap / 2 + rods.offset), y, -back));
  });

  return (
    <group>
      {places.map(({ side, back }, i) => (
        <mesh key={i} ref={(m) => { pins.current[i] = m; }} position={[side * (tool.stroke / 2 + rods.offset), y, -back]} castShadow>
          <cylinderGeometry args={[rods.radius, rods.radius, length, 12]} />
          <meshStandardMaterial color={STEEL} metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

/** A mesh from public/, or null until it is in (and if it never arrives). */
function useStl(file: string): THREE.BufferGeometry | null {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    let alive = true;
    new STLLoader().load(`${import.meta.env.BASE_URL}${file}`, (g) => {
      if (alive) setGeometry(g);
    }, undefined, () => console.warn(`${file} did not load; drawing its stand-in.`));
    return () => {
      alive = false;
    };
  }, [file]);
  return geometry;
}

/** What holds the tool to the flange, in the flange's frame (z out of the flange). */
function Mount({ shape, tool }: { shape: MountShape; tool: ToolModel }) {
  const bracket = useStl(BRACKET_90.mesh);
  const bar = useMemo(() => {
    if (shape.kind !== 'strut') return null;
    const to = new THREE.Vector3(...shape.base);
    return { length: to.length(), mid: to.clone().multiplyScalar(0.5), turn: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().normalize()) };
  }, [shape]);
  const mat = <meshStandardMaterial color={TEAL} roughness={0.6} />;

  if (shape.kind === 'adapter') return <Rod r={FLANGE_RADIUS} z0={0} z1={shape.height} color={STEEL} metal={0.6} />;
  if (shape.kind === 'bracket' && shape.spacer != null && bracket) {
    // the real bracket, and whatever coupling is left between its face and the gripper's base
    return (
      <group rotation={[0, 0, shape.turn]}>
        <mesh geometry={bracket} castShadow receiveShadow>
          {mat}
        </mesh>
        {shape.spacer > 0.0005 && (
          <mesh position={[BRACKET_90.reach + shape.spacer / 2, 0, BRACKET_90.depth]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[FLANGE_RADIUS, FLANGE_RADIUS, shape.spacer, 32]} />
            <meshStandardMaterial color={BLACK} roughness={0.5} />
          </mesh>
        )}
      </group>
    );
  }
  if (shape.kind === 'bracket') {
    const width = 2 * Math.max(FLANGE_RADIUS, tool.bodyRadius);
    return (
      <group rotation={[0, 0, shape.turn]}>
        <mesh position={[(shape.reach - FLANGE_RADIUS) / 2, 0, PLATE / 2]} castShadow>
          <boxGeometry args={[shape.reach + FLANGE_RADIUS, width, PLATE]} />
          {mat}
        </mesh>
        <mesh position={[shape.reach - PLATE / 2, 0, shape.drop / 2]} castShadow>
          <boxGeometry args={[PLATE, width, shape.drop]} />
          {mat}
        </mesh>
      </group>
    );
  }
  if (bar) {
    return (
      <group>
        <Rod r={FLANGE_RADIUS} z0={0} z1={PLATE} color={TEAL} metal={0} />
        <mesh position={bar.mid} quaternion={bar.turn} castShadow>
          <cylinderGeometry args={[0.014, 0.014, bar.length, 12]} />
          {mat}
        </mesh>
      </group>
    );
  }
  return null;
}

export function RobotArm({ project, home }: { project: Project; home: Joints | null }) {
  const robot = useRobot(ROBOTS[project.robot.model].urdf, ROBOTS[project.robot.model].repaint);
  const { arm } = useStore();
  const [carrying, setCarrying] = useState<string | null>(null);
  const tool = TOOLS[project.gripper.model];
  const tcp = useMemo(() => toThree(fromPose(project.robot.tcp)), [project.robot.tcp]);
  const fingerAxis = useMemo(() => fingerAxisOf(project.robot.tcp, tool, project.gripper.fingerAxis), [project.robot.tcp, tool, project.gripper.fingerAxis]);
  const placed = useMemo(() => placeTool(project.robot.tcp, tool, fingerAxis), [project.robot.tcp, tool, fingerAxis]);
  const carriedComponent = project.components.find((c) => c.id === carrying);
  const turn = fingerAxis === 'y' ? Math.PI / 2 : 0;
  // what the tool holds sits in its grip frame: at the TCP, along the gripper or along its pins
  const grip = useMemo(() => toThree(gripOf(project)), [project]);
  const byPins = useMemo(() => gripOf(project)[0] !== 1, [project]);
  // the finger gap this frame: as far open as it is told, but no further closed than what it is
  // closing on or holding lets it
  const gapNow = useCallback(() => {
    const a = arm.current;
    const held = project.components.find((c) => c.id === (a.carrying ?? a.closingOn));
    return Math.max(closedGap(tool, held ? itemWidth(held) : null, byPins), tool.stroke * a.grip);
  }, [arm, project, tool, byPins]);

  useFrame((_, dt) => {
    const a = arm.current;
    const target = a.target ?? home;
    if (!target) return;
    if (!a.q || a.playing) a.q = [...target] as Joints;
    else a.q = a.q.map((v, i) => v + (target[i] - v) * Math.min(1, dt * 7)) as Joints;
    if (robot) JOINT_NAMES.forEach((n, i) => robot.joints[n]?.setJointValue(a.q![i]));
    if (a.carrying !== carrying) setCarrying(a.carrying);
  });

  if (!robot) return null;
  const tool0 = robot.links.tool0;
  return (
    // keyed by the robot: what hangs on its flange is portalled into it, and must move to the new
    // flange when another arm is picked
    <group key={robot.uuid} rotation={[0, 0, Math.PI]}>
      {/* base_link is the pendant's base frame turned half a turn about z */}
      <primitive object={robot} dispose={null} />
      {tool0 && createPortal(
        <group>
          <Mount shape={placed.mount} tool={tool} />
          <group matrixAutoUpdate={false} matrix={tcp}>
            {/* the gripper may be bolted on a quarter turn about its own axis from the TCP's frame */}
            <group position={placed.tip} rotation={[0, 0, turn]}>
              <Gripper tool={tool} length={placed.length} tilt={placed.tilt} gapNow={gapNow} />
              {tool.rods && <Pins tool={tool} rods={tool.rods} gapNow={gapNow} />}
            </group>
            <mesh>
              <sphereGeometry args={[0.006, 12, 12]} />
              <meshBasicMaterial color="#06b6d4" />
            </mesh>
            {carriedComponent && (
              <group matrixAutoUpdate={false} matrix={grip}>
                <Item c={carriedComponent} />
              </group>
            )}
          </group>
        </group>,
        tool0,
      )}
    </group>
  );
}
