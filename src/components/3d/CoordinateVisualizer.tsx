import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Text, Sphere, Billboard, Bounds, useBounds, Line } from '@react-three/drei';
import { ZoomIn, ZoomOut, Focus } from 'lucide-react';
import RobotArm from './RobotArm';
import type { ParsedLocation, GridConfig, URModel, MoveSequenceItem } from '../../types';

interface VisualizerProps {
  locations: ParsedLocation[];
  sequence: MoveSequenceItem[];
  showPath: boolean;
  gridConfigs: Record<string, GridConfig>;
  selectedLocation: string | null;
  selectedLocationData: ParsedLocation | null;
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

const CoordinateVisualizer: React.FC<VisualizerProps> = ({ locations, sequence, showPath, gridConfigs, selectedLocation, selectedLocationData, selectedModel, onSelectLocation, onConfigChange }) => {
  const controlsRef = useRef<any>(null);
  const [activeSegment, setActiveSegment] = useState<number | null>(null);

  const handleZoom = (direction: 'in' | 'out') => {
    if (controlsRef.current) {
      const zoomAmount = direction === 'in' ? 0.8 : 1.2;
      controlsRef.current.target.multiplyScalar(zoomAmount);
      controlsRef.current.object.position.multiplyScalar(zoomAmount);
      controlsRef.current.update();
    }
  };

  const handleRefit = () => {
    window.dispatchEvent(new Event('refit-camera'));
  };

  const points = useMemo(() => {
    return locations.map(loc => {
      if (loc.type !== 'p') return null;
      
      const cleanStr = loc.coordinates.replace('[', '').replace(']', '');
      const parts = cleanStr.split(',').map(p => parseFloat(p.trim()));
      
      if (parts.length >= 3 && !parts.slice(0,3).some(isNaN)) {
        return {
          name: loc.name,
          x: parts[0],
          y: parts[1],
          z: parts[2],
          config: gridConfigs[loc.name]
        };
      }
      return null;
    }).filter((p): p is {name: string, x: number, y: number, z: number, config: GridConfig} => p !== null);
  }, [locations, gridConfigs]);

  const sequenceSegments = useMemo(() => {
    const segments: { start: [number, number, number], end: [number, number, number], moveType: string, index: number }[] = [];
    const validPoints: { pt: [number, number, number], item: MoveSequenceItem }[] = [];
    
    sequence.forEach(item => {
      let loc = locations.find(l => l.name === item.target);
      if (!loc && item.target.endsWith('_q')) {
        loc = locations.find(l => l.name === item.target.replace(/_q$/, '_p'));
      }
      if (loc && loc.type === 'p') {
        const parts = loc.coordinates.replace('[', '').replace(']', '').split(',').map(n => parseFloat(n.trim()));
        if (parts.length >= 3 && !parts.slice(0,3).some(isNaN)) {
          validPoints.push({ pt: [parts[0], parts[2], -parts[1]], item });
        }
      }
    });

    for (let i = 0; i < validPoints.length - 1; i++) {
      segments.push({
        start: validPoints[i].pt,
        end: validPoints[i+1].pt,
        moveType: validPoints[i+1].item.moveType,
        index: i
      });
    }
    return segments;
  }, [sequence, locations]);

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
      
      <RobotArm model={selectedModel} position={[0, 0, 0]} targetLocation={selectedLocationData} />

      <Bounds fit clip observe margin={1.2}>
        <BoundsController />

      {showPath && sequenceSegments.map((segment, idx) => {
        const isSelected = activeSegment === segment.index;
        const color = isSelected ? "#f97316" : "#ffffff";
        const opacity = isSelected ? 1 : 0.4;
        
        const midX = (segment.start[0] + segment.end[0]) / 2;
        const midY = (segment.start[1] + segment.end[1]) / 2;
        const midZ = (segment.start[2] + segment.end[2]) / 2;

        return (
          <group key={`seg-${idx}`}>
            {/* Visual Line */}
            <Line 
              points={[segment.start, segment.end]} 
              color={color} 
              lineWidth={isSelected ? 3 : 1.5} 
              dashed={true} 
              dashSize={0.015} 
              gapSize={0.015}
              transparent
              opacity={opacity}
            />
            
            {/* Invisible Fat Line for Interaction */}
            <Line 
              points={[segment.start, segment.end]} 
              color="white"
              lineWidth={20} // Fat hit area 
              transparent
              opacity={0} // Invisible
              onClick={(e) => {
                e.stopPropagation();
                setActiveSegment(isSelected ? null : segment.index);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                document.body.style.cursor = 'auto';
              }}
            />

            <Text
              position={[midX, midY + 0.015, midZ]}
              fontSize={0.015}
              color={color}
              anchorX="center"
              anchorY="middle"
              fillOpacity={opacity}
            >
              {segment.moveType}
            </Text>
          </group>
        );
      })}

      {points.map((p, idx) => {
        const pName = selectedLocation?.endsWith('_q') ? selectedLocation.replace(/_q$/, '_p') : selectedLocation;
        const isSelected = selectedLocation === p.name || pName === p.name;
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

      {/* Path Segment Info Overlay */}
      {activeSegment !== null && (
        <div style={{
          position: 'absolute',
          bottom: '16px',
          left: '16px',
          background: 'var(--overlay-bg)',
          backdropFilter: 'blur(8px)',
          border: '1px solid #3b82f6',
          borderRadius: '8px',
          padding: '16px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          color: 'var(--text-main)',
          zIndex: 10,
          minWidth: '240px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f97316' }} />
              Segment Info
            </h4>
            <button 
              onClick={() => setActiveSegment(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 4px', fontSize: '1.2rem', lineHeight: 1 }}
            >
              ×
            </button>
          </div>
          <div style={{ fontSize: '0.85rem' }}>
            {(() => {
               const seg = sequenceSegments.find(s => s.index === activeSegment);
               if (!seg) return null;
               const isLinear = seg.moveType === 'movel' || seg.moveType === 'movep';
               return (
                 <>
                   <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid var(--panel-border)' }}>
                     <strong style={{ color: 'var(--text-muted)' }}>Path Type: </strong> 
                     <span style={{ color: isLinear ? '#3b82f6' : '#f59e0b', fontWeight: 'bold' }}>
                       {isLinear ? 'Linear Location' : 'Non-Linear Joint'}
                     </span>
                     <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>({seg.moveType})</span>
                   </div>
                   <div style={{ marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                     <strong style={{ color: 'var(--text-muted)' }}>Start: </strong> 
                     <span style={{ color: 'var(--text-main)', fontFamily: 'monospace' }}>[{seg.start[0].toFixed(3)}, {seg.start[1].toFixed(3)}, {seg.start[2].toFixed(3)}]</span>
                   </div>
                   <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                     <strong style={{ color: 'var(--text-muted)' }}>End: </strong> 
                     <span style={{ color: 'var(--text-main)', fontFamily: 'monospace' }}>[{seg.end[0].toFixed(3)}, {seg.end[1].toFixed(3)}, {seg.end[2].toFixed(3)}]</span>
                   </div>
                 </>
               );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default CoordinateVisualizer;
