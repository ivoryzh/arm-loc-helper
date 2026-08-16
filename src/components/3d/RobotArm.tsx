import React, { Suspense, useEffect, useRef } from 'react';
import { useLoader, useFrame, createPortal } from '@react-three/fiber';
import URDFLoader from 'urdf-loader';
import type { URModel, ParsedLocation } from '../../types';

interface RobotArmProps {
  model: URModel;
  position?: [number, number, number];
  targetLocation?: ParsedLocation | null;
}

const URDFRobot: React.FC<{ modelUrl: string; position: [number, number, number]; targetLocation?: ParsedLocation | null }> = ({ modelUrl, position, targetLocation }) => {
  // @ts-ignore
  const robot = useLoader(URDFLoader, modelUrl, (loader: any) => {
    // Enable resolving 'package://' paths directly to our public folder
    loader.packages = {
      ur_description: '/universal_robot/ur_description'
    };
  });
  
  // Ref to hold the latest joint angles from the WebSocket (avoids 125Hz React state re-renders)
  const jointAngles = useRef<number[]>([0, 0, 0, 0, 0, 0]);

  useEffect(() => {
    // Connect to the local Node.js bridge server
    const ws = new WebSocket('ws://localhost:8080');
    
    ws.onopen = () => {
      console.log('Connected to URSim Bridge!');
    };
    
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'joints' && Array.isArray(msg.data)) {
          // Store the latest 6 joint angles (in radians)
          jointAngles.current = msg.data;
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    return () => ws.close();
  }, []);

  useFrame(() => {
    if (!robot) return;
    
    // Determine which joint angles to use
    let activeAngles = jointAngles.current;
    
    // If a location is selected and it's a joint angle location, use those angles instead of live WebSocket
    if (targetLocation && targetLocation.type === 'q') {
      const cleanStr = targetLocation.coordinates.replace('[', '').replace(']', '');
      const parts = cleanStr.split(',').map(p => parseFloat(p.trim()));
      if (parts.length >= 6 && parts.every(p => !isNaN(p))) {
        activeAngles = parts;
      }
    }

    // Apply the joint angles to the URDF joints
    // UR joints in order: base, shoulder, elbow, wrist1, wrist2, wrist3
    const jointNames = [
      'shoulder_pan_joint',
      'shoulder_lift_joint',
      'elbow_joint',
      'wrist_1_joint',
      'wrist_2_joint',
      'wrist_3_joint'
    ];

    jointNames.forEach((name, index) => {
      if (robot.joints[name]) {
        robot.joints[name].setJointValue(activeAngles[index]);
      }
    });
  });

  const tool0 = robot.links?.['tool0'];

  return (
    <group position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <primitive object={robot} rotation={[0, 0, Math.PI]} dispose={null} />
      {tool0 && createPortal(
        <group>
          {/* Subtle Glowing Center Sphere */}
          <mesh>
            <sphereGeometry args={[0.02, 32, 32]} />
            <meshPhysicalMaterial 
              color="#06b6d4" 
              emissive="#06b6d4"
              emissiveIntensity={0.5}
              transparent
              opacity={0.6}
              roughness={0.1}
              metalness={0.8}
            />
          </mesh>
          {/* Sleek Outer Ring (Lies flat against flange to show orientation) */}
          <mesh>
            <torusGeometry args={[0.04, 0.003, 16, 64]} />
            <meshBasicMaterial color="#06b6d4" transparent opacity={0.3} />
          </mesh>
        </group>,
        tool0
      )}
    </group>
  );
};

const RobotArm: React.FC<RobotArmProps> = ({ model, position = [0, 0, 0], targetLocation }) => {
  let modelUrl = '/universal_robot/ur5.urdf';
  if (model === 'UR3') modelUrl = '/universal_robot/ur3.urdf';
  if (model === 'UR10') modelUrl = '/universal_robot/ur10.urdf';
  
  return (
    <Suspense fallback={null}>
      <URDFRobot modelUrl={modelUrl} position={position} targetLocation={targetLocation} />
    </Suspense>
  );
};

export default RobotArm;
