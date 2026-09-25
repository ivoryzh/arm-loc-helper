import React from 'react';
import { useGLTF, Resize, Center } from '@react-three/drei';

interface EasyMaxProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
}

export default function EasyMax({ position = [0, 0, 0], rotation = [0, 0, 0] }: EasyMaxProps) {
  const { scene } = useGLTF('/easymax.glb');
  
  return (
    <group position={position} rotation={rotation}>
      <Center bottom disableX disableZ>
        <Resize width={0.132}>
          <primitive object={scene} />
        </Resize>
      </Center>
    </group>
  );
}

// Pre-load the model
useGLTF.preload('/easymax.glb');
