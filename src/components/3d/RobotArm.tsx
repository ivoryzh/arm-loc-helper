// The arm: the ros-industrial URDF (meshes from the CDN), a two-finger gripper on the flange out to
// the TCP, and whatever it carries. Joints come from the store's arm view every frame.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
import type { Project } from '../../lib/deck';
import type { Joints } from '../../lib/kinematics';
import { fromPose } from '../../lib/mat4';
import { JOINT_NAMES, MESH_CDN, ROBOTS } from '../../lib/robots';
import { useStore } from '../../state';
import { Item } from './items';

const FINGER = 0.045;  // finger length, ending at the TCP
const OPEN_GAP = 0.085; // a 2F-85 fully open

function useRobot(urdf: string): URDFRobot | null {
  const [robot, setRobot] = useState<URDFRobot | null>(null);
  useEffect(() => {
    let alive = true;
    const loader = new URDFLoader();
    loader.packages = { ur_description: MESH_CDN };
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
  }, [urdf]);
  return robot;
}

/** The 4x4 (row-major) TCP offset as a three.js matrix. */
function tcpMatrix(tcp: number[]): THREE.Matrix4 {
  const m = fromPose(tcp);
  return new THREE.Matrix4().set(...(m as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]));
}

export function RobotArm({ project, home }: { project: Project; home: Joints | null }) {
  const robot = useRobot(ROBOTS[project.robot.model].urdf);
  const { arm } = useStore();
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);
  const carried = useRef<THREE.Group>(null);
  const [carrying, setCarrying] = useState<string | null>(null);
  const tcpLen = Math.max(0.06, Math.hypot(project.robot.tcp[0], project.robot.tcp[1], project.robot.tcp[2]));
  const tcp = useMemo(() => tcpMatrix(project.robot.tcp), [project.robot.tcp]);
  const carriedComponent = project.components.find((c) => c.id === carrying);

  useFrame((_, dt) => {
    const a = arm.current;
    const target = a.target ?? home;
    if (!target) return;
    if (!a.q || a.playing) a.q = [...target] as Joints;
    else a.q = a.q.map((v, i) => v + (target[i] - v) * Math.min(1, dt * 7)) as Joints;
    if (robot) JOINT_NAMES.forEach((n, i) => robot.joints[n]?.setJointValue(a.q![i]));
    const gap = 0.012 + (OPEN_GAP - 0.012) * a.grip;
    if (left.current) left.current.position.x = gap / 2 + 0.005;
    if (right.current) right.current.position.x = -gap / 2 - 0.005;
    if (a.carrying !== carrying) setCarrying(a.carrying);
  });

  if (!robot) return null;
  const tool0 = robot.links.tool0;
  return (
    <group rotation={[0, 0, Math.PI]}>
      {/* base_link is the pendant's base frame turned half a turn about z */}
      <primitive object={robot} dispose={null} />
      {tool0 && createPortal(
        <group>
          <mesh position={[0, 0, (tcpLen - FINGER) / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.035, 0.04, Math.max(0.01, tcpLen - FINGER), 24]} />
            <meshStandardMaterial color="#334155" metalness={0.3} roughness={0.5} />
          </mesh>
          <mesh ref={left} position={[OPEN_GAP / 2, 0, tcpLen - FINGER / 2]} castShadow>
            <boxGeometry args={[0.01, 0.022, FINGER]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          <mesh ref={right} position={[-OPEN_GAP / 2, 0, tcpLen - FINGER / 2]} castShadow>
            <boxGeometry args={[0.01, 0.022, FINGER]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          <group ref={carried} matrixAutoUpdate={false} matrix={tcp}>
            <mesh>
              <sphereGeometry args={[0.006, 12, 12]} />
              <meshBasicMaterial color="#06b6d4" />
            </mesh>
            {carriedComponent && <Item c={carriedComponent} />}
          </group>
        </group>,
        tool0,
      )}
    </group>
  );
}
