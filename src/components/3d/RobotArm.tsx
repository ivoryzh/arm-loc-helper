import React, { Suspense } from 'react';
import { useGLTF } from '@react-three/drei';
import type { URModel } from '../../types';

interface RobotArmProps {
  model: URModel;
  position?: [number, number, number];
}

const Model: React.FC<{ modelUrl: string; position: [number, number, number] }> = ({ modelUrl, position }) => {
  const { scene } = useGLTF(modelUrl);
  
  // Clone the scene to ensure hot reloads or multiple instances work cleanly
  const clonedScene = React.useMemo(() => scene.clone(), [scene]);
  
  // Note: Depending on the CAD export, you might need to adjust rotation if it's laying on its side.
  // e.g., rotation={[-Math.PI / 2, 0, 0]}
  return <primitive object={clonedScene} position={position} />;
};

const RobotArm: React.FC<RobotArmProps> = ({ model, position = [0, 0, 0] }) => {
  // Map the selected model to the downloaded files.
  // We fallback to UR5e if UR10 is selected since we only have 3 and 5.
  let modelUrl = '/UR5e.glb';
  if (model === 'UR3') modelUrl = '/UR3e.glb';
  if (model === 'UR10') modelUrl = '/UR10e.glb';
  
  return (
    <Suspense fallback={null}>
      <Model modelUrl={modelUrl} position={position} />
    </Suspense>
  );
};

// Preload the models so switching in the UI is instant
useGLTF.preload('/UR3e.glb');
useGLTF.preload('/UR5e.glb');
useGLTF.preload('/UR10e.glb');

export default RobotArm;
