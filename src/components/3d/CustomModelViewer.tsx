import { useGLTF, Resize, Center, Clone } from '@react-three/drei';
import type { CustomModel } from '../../types';

interface CustomModelViewerProps {
  model: CustomModel;
}

export default function CustomModelViewer({ model }: CustomModelViewerProps) {
  const { scene } = useGLTF(model.url);
  
  // Convert UR coordinates to Three.js coordinates
  // UR: [x, y, z] -> Three.js: [x, z, -y]
  const position: [number, number, number] = [model.x, model.z, -model.y];
  const rotation: [number, number, number] = [0, model.rotationY, 0];

  return (
    <group position={position} rotation={rotation}>
      <group scale={model.width}>
        <Center bottom>
          <Resize width>
            <Clone object={scene} />
          </Resize>
        </Center>
      </group>
    </group>
  );
}
