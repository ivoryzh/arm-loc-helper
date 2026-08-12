import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Text, Sphere, Billboard } from '@react-three/drei';

interface ParsedLocation {
  name: string;
  type: string;
  coordinates: string;
}

interface GridConfig {
  isGrid: boolean;
  cols: number;
  rows: number;
  dx: number;
  dy: number;
}

interface VisualizerProps {
  locations: ParsedLocation[];
  gridConfigs: Record<string, GridConfig>;
  selectedLocation: string | null;
  onSelectLocation: (name: string) => void;
}

const CoordinateVisualizer: React.FC<VisualizerProps> = ({ locations, gridConfigs, selectedLocation, onSelectLocation }) => {
  const points = useMemo(() => {
    return locations
      .filter((loc) => loc.type === 'p')
      .map((loc) => {
        const cleanStr = loc.coordinates.replace('[', '').replace(']', '');
        const parts = cleanStr.split(',').map((p) => parseFloat(p.trim()));
        
        if (parts.length >= 3) {
          return {
            name: loc.name,
            x: parts[0],
            y: parts[1],
            z: parts[2],
            config: gridConfigs[loc.name]
          };
        }
        return null;
      })
      .filter(Boolean) as { name: string; x: number; y: number; z: number; config: GridConfig }[];
  }, [locations, gridConfigs]);

  const center = useMemo(() => {
    if (points.length === 0) return [0, 0, 0] as [number, number, number];
    let cx = 0, cy = 0, cz = 0;
    points.forEach(p => { cx += p.x; cy += p.y; cz += p.z; });
    return [cx / points.length, cy / points.length, cz / points.length] as [number, number, number];
  }, [points]);

  if (points.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b' }}>
        <p>No Cartesian points to display.</p>
      </div>
    );
  }

  return (
    <Canvas camera={{ position: [center[0] + 1, center[1] + 1, center[2] + 1], fov: 50 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      
      <OrbitControls target={center} makeDefault />
      
      <Grid 
        position={[0, 0, 0]} 
        args={[4, 4]} 
        cellSize={0.1} 
        cellThickness={1} 
        cellColor="#3b82f6" 
        sectionSize={1}
        sectionThickness={1.5}
        sectionColor="#1e293b"
        fadeDistance={4}
        fadeStrength={1}
      />
      <axesHelper args={[1]} />

      {points.map((p, idx) => {
        const isSelected = selectedLocation === p.name;
        const mainColor = isSelected ? "#f59e0b" : "#3b82f6";
        
        // Generate Tray Array if configured
        const isTray = p.config?.isGrid;
        const traySpheres = [];
        
        if (isTray) {
          for (let row = 0; row < p.config.rows; row++) {
            for (let col = 0; col < p.config.cols; col++) {
              if (row === 0 && col === 0) continue; // Skip origin, we draw it below
              
              const tx = p.x + (col * p.config.dx);
              const ty = p.y + (row * p.config.dy);
              const tz = p.z;
              
              traySpheres.push(
                <Sphere 
                  key={`${p.name}-${col}-${row}`} 
                  position={[tx, tz, -ty]} 
                  args={[0.008, 16, 16]}
                  onClick={(e) => { e.stopPropagation(); onSelectLocation(p.name); }}
                >
                  <meshStandardMaterial color={mainColor} transparent opacity={0.6} />
                </Sphere>
              );
            }
          }
        }

        const originPos = [p.x, p.z, -p.y] as [number, number, number];
        
        return (
          <group key={idx}>
            {/* Origin Sphere */}
            <Sphere 
              position={originPos} 
              args={[0.015, 16, 16]}
              onClick={(e) => { e.stopPropagation(); onSelectLocation(p.name); }}
              onPointerOver={(e) => { document.body.style.cursor = 'pointer'; }}
              onPointerOut={(e) => { document.body.style.cursor = 'auto'; }}
            >
              <meshStandardMaterial color={mainColor} emissive={mainColor} emissiveIntensity={0.5} toneMapped={false} />
            </Sphere>
            
            {/* Label */}
            <Billboard position={[originPos[0], originPos[1] + 0.03, originPos[2]]}>
              <Text
                fontSize={0.03}
                color={isSelected ? "#fcd34d" : "#f8fafc"}
                anchorX="center"
                anchorY="middle"
                outlineWidth={0.002}
                outlineColor="#000000"
              >
                {p.name} {isTray ? `(Tray ${p.config.cols}x${p.config.rows})` : ''}
              </Text>
            </Billboard>
            
            {/* Tray Points */}
            {traySpheres}
          </group>
        );
      })}
    </Canvas>
  );
};

export default CoordinateVisualizer;
