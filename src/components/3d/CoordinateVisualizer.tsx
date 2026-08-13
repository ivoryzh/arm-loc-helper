import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Text, Sphere, Billboard, Bounds, useBounds } from '@react-three/drei';
import { ZoomIn, ZoomOut, Focus } from 'lucide-react';
import RobotArm from './RobotArm';
import type { ParsedLocation, GridConfig, URModel } from '../../types';

interface VisualizerProps {
  locations: ParsedLocation[];
  gridConfigs: Record<string, GridConfig>;
  selectedLocation: string | null;
  selectedModel: URModel;
  onSelectLocation: (name: string | null) => void;
  onConfigChange: (locName: string, field: keyof GridConfig, value: number | boolean) => void;
}

const BoundsController = () => {
  const bounds = useBounds();
  useEffect(() => {
    const handleRefit = () => bounds.refresh().fit();
    window.addEventListener('refit-camera', handleRefit);
    return () => window.removeEventListener('refit-camera', handleRefit);
  }, [bounds]);
  return null;
};

const CoordinateVisualizer: React.FC<VisualizerProps> = ({ locations, gridConfigs, selectedLocation, selectedModel, onSelectLocation, onConfigChange }) => {
  const controlsRef = useRef<any>(null);

  const handleZoom = (direction: 'in' | 'out') => {
    if (!controlsRef.current) return;
    const camera = controlsRef.current.object;
    const target = controlsRef.current.target;
    
    const directionVec = camera.position.clone().sub(target);
    const factor = direction === 'in' ? 0.8 : 1.25;
    directionVec.multiplyScalar(factor);
    
    camera.position.copy(target).add(directionVec);
    controlsRef.current.update();
  };

  const handleRefit = () => {
    window.dispatchEvent(new Event('refit-camera'));
  };

  const points = useMemo(() => {
    return locations
      .filter((loc) => loc.type === 'p')
      .map((loc) => {
        const cleanStr = loc.coordinates.replace('[', '').replace(']', '');
        const parts = cleanStr.split(',').map((p) => parseFloat(p.trim()));
        
        if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
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

  const selectedPoint = useMemo(() => points.find(p => p.name === selectedLocation), [points, selectedLocation]);

  if (points.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b' }}>
        <p>No Cartesian points to display.</p>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas camera={{ position: [center[0] + 1, center[1] + 1, center[2] + 1], fov: 50 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      
      <OrbitControls ref={controlsRef} target={center} makeDefault />
      
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
      
      <RobotArm model={selectedModel} position={[0, 0, 0]} />

      <Bounds fit clip observe margin={1.2}>
        <BoundsController />

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
              onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
              onPointerOut={() => { document.body.style.cursor = 'auto'; }}
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
                {p.name.replace(/_p$/, '')} {isTray ? `(Tray ${p.config.cols}x${p.config.rows})` : ''}
              </Text>
            </Billboard>
            
            {/* Tray Points */}
            {traySpheres}
          </group>
        );
      })}
      </Bounds>
      </Canvas>
      
      {/* Absolute overlay outside of Canvas */}
      {selectedPoint && (
        <div style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          background: 'rgba(15, 23, 42, 0.9)',
          backdropFilter: 'blur(8px)',
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '16px',
          color: 'white',
          width: '280px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          zIndex: 10
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '0.9rem', color: '#fcd34d' }}>{selectedPoint.name.replace(/_p$/, '')}</h3>
            <button 
              onClick={(e) => { e.stopPropagation(); onSelectLocation(null); }}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0 4px', fontSize: '1.2rem' }}
            >
              &times;
            </button>
          </div>
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer', marginBottom: selectedPoint.config?.isGrid ? '12px' : '0' }}>
            <input 
              type="checkbox" 
              checked={selectedPoint.config?.isGrid || false}
              onChange={(e) => onConfigChange(selectedPoint.name, 'isGrid', e.target.checked)}
            />
            Convert to Tray Array
          </label>
          
          {selectedPoint.config?.isGrid && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Cols (X)</label>
                <input 
                  type="number" 
                  value={selectedPoint.config.cols} 
                  onChange={(e) => onConfigChange(selectedPoint.name, 'cols', parseInt(e.target.value) || 0)}
                  style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid #334155', color: 'white', padding: '4px 6px', borderRadius: '4px', fontSize: '0.8rem' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Rows (Y)</label>
                <input 
                  type="number" 
                  value={selectedPoint.config.rows} 
                  onChange={(e) => onConfigChange(selectedPoint.name, 'rows', parseInt(e.target.value) || 0)}
                  style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid #334155', color: 'white', padding: '4px 6px', borderRadius: '4px', fontSize: '0.8rem' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.7rem', color: '#94a3b8' }}>dX (m)</label>
                <input 
                  type="number" 
                  step="0.001"
                  value={selectedPoint.config.dx} 
                  onChange={(e) => onConfigChange(selectedPoint.name, 'dx', parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid #334155', color: 'white', padding: '4px 6px', borderRadius: '4px', fontSize: '0.8rem' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.7rem', color: '#94a3b8' }}>dY (m)</label>
                <input 
                  type="number" 
                  step="0.001"
                  value={selectedPoint.config.dy} 
                  onChange={(e) => onConfigChange(selectedPoint.name, 'dy', parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid #334155', color: 'white', padding: '4px 6px', borderRadius: '4px', fontSize: '0.8rem' }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Camera Controls Toolbar */}
      <div style={{
        position: 'absolute',
        bottom: '16px',
        right: '16px',
        background: 'rgba(15, 23, 42, 0.9)',
        backdropFilter: 'blur(8px)',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '8px',
        display: 'flex',
        gap: '8px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
        zIndex: 10
      }}>
        <button 
          onClick={() => handleZoom('in')}
          style={{ background: '#1e293b', border: '1px solid #334155', color: 'white', borderRadius: '4px', padding: '6px', cursor: 'pointer', display: 'flex' }}
          title="Zoom In"
        >
          <ZoomIn size={18} />
        </button>
        <button 
          onClick={() => handleZoom('out')}
          style={{ background: '#1e293b', border: '1px solid #334155', color: 'white', borderRadius: '4px', padding: '6px', cursor: 'pointer', display: 'flex' }}
          title="Zoom Out"
        >
          <ZoomOut size={18} />
        </button>
        <div style={{ width: '1px', background: '#334155', margin: '0 4px' }} />
        <button 
          onClick={handleRefit}
          style={{ background: '#3b82f6', border: 'none', color: 'white', borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold' }}
          title="Refit to locations"
        >
          <Focus size={16} /> Refit
        </button>
      </div>
    </div>
  );
};

export default CoordinateVisualizer;
