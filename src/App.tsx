import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Settings2, Download, Upload, FileCode2, Bot, Sun, Moon } from 'lucide-react';
import CoordinateVisualizer from './components/3d/CoordinateVisualizer';
import './styles/App.css';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-python';
import type { ParsedLocation, GridConfig, URModel, ApiType, MoveSequenceItem } from './types';
import { parseScript } from './lib/parser';
import { generatePython } from './lib/generator';

function App() {
  const [fileName, setFileName] = useState<string>('');
  const [locations, setLocations] = useState<ParsedLocation[]>([]);
  const [sequence, setSequence] = useState<MoveSequenceItem[]>([]);
  const [showPath, setShowPath] = useState<boolean>(true);
  const [gridConfigs, setGridConfigs] = useState<Record<string, GridConfig>>({});
  const [targetApi, setTargetApi] = useState<ApiType>('ti_robots');
  const [selectedModel, setSelectedModel] = useState<URModel>('UR5');
  const [generatedCode, setGeneratedCode] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [isLightMode, setIsLightMode] = useState(false);
  
  // Selection state for interactivity
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    document.body.classList.toggle('light-mode', isLightMode);
  }, [isLightMode]);

  useEffect(() => {
    if (locations.length > 0) {
      const code = generatePython(locations, gridConfigs, targetApi);
      setGeneratedCode(code);
    }
  }, [gridConfigs, targetApi, locations]);

  // Globally prevent browser from navigating to dropped files
  useEffect(() => {
    const preventDefault = (e: Event) => e.preventDefault();
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  useEffect(() => {
    if (generatedCode) {
      Prism.highlightAll();
    }
  }, [generatedCode]);

  useEffect(() => {
    if (selectedLocation && rowRefs.current[selectedLocation]) {
      rowRefs.current[selectedLocation]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }, [selectedLocation]);

  const handleGridConfigChange = (locName: string, field: keyof GridConfig, value: number | boolean) => {
    setGridConfigs(prev => ({
      ...prev,
      [locName]: {
        ...prev[locName],
        [field]: value
      }
    }));
  };

  const handleFileUpload = async (file: File) => {
    setFileName(file.name);
    const content = await file.text();
    const { locations: parsedLocs, sequence: parsedSeq } = parseScript(content);
    setLocations(parsedLocs);
    setSequence(parsedSeq);
    
    const initialConfigs: Record<string, GridConfig> = {};
    parsedLocs.forEach(loc => {
      if (loc.type === 'p') {
        initialConfigs[loc.name] = { isGrid: false, cols: 3, rows: 3, dx: 0.05, dy: 0.05 };
      }
    });
    setGridConfigs(initialConfigs);
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.script') || file.name.endsWith('.txt')) {
        handleFileUpload(file);
      }
    }
  }, []);

  const downloadPython = () => {
    const blob = new Blob([generatedCode], { type: 'text/python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName ? `${fileName.replace('.script', '')}_converted.py` : 'robot_sequence.py';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSelectLocation = (name: string | null) => {
    setSelectedLocation(name);
  };

  return (
    <div 
      className="app-container"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="header" style={{ justifyContent: 'space-between' }}>
        <div className="logo">
          <Bot size={24} color="#3b82f6" />
          <span style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>URScript <span className="highlight">Visualizer</span></span>
        </div>
        <button onClick={() => setIsLightMode(!isLightMode)} className="btn" style={{ padding: '6px 12px', background: 'transparent', color: 'var(--text-main)', border: '1px solid var(--panel-border)', boxShadow: 'none' }}>
          {isLightMode ? <Moon size={16} /> : <Sun size={16} />} 
          {isLightMode ? 'Dark Mode' : 'Light Mode'}
        </button>
      </header>

      {/* TOP ROW: Dropzone & Settings */}
      <div className="top-bar-container">
        {locations.length > 0 && (
          <div className="api-selector">
            <Settings2 size={16} color="var(--text-muted)" />
            <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as URModel)}>
              <option value="UR3">UR3 (Small)</option>
              <option value="UR5">UR5 (Medium)</option>
              <option value="UR10">UR10 (Large)</option>
            </select>
          </div>
        )}
        <div 
          className={`drop-zone ${isDragging ? 'dragging' : ''}`}
        >
          <Upload size={24} className="upload-icon" />
          <div>
            <h3 style={{fontSize: '0.9rem'}}>Drag .script file here</h3>
          </div>
          <label className="btn" style={{padding: '6px 12px', fontSize: '0.8rem'}}>
            Browse
            <input 
              type="file" 
              accept=".script,.txt" 
              onChange={(e) => e.target.files && handleFileUpload(e.target.files[0])} 
              style={{ display: 'none' }} 
            />
          </label>
          {fileName && <span className="file-name" style={{fontSize: '0.8rem'}}>{fileName}</span>}
        </div>
      </div>

      <div className="main-content-split">
        {/* LEFT COLUMN: 3D Workspace */}
        <section className="visualizer-section glass-panel" style={{ padding: '16px' }}>
          <div className="visualizer-container">
            <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 10, background: 'var(--overlay-bg)', padding: '8px 12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input 
                type="checkbox" 
                id="showPath" 
                checked={showPath} 
                onChange={(e) => setShowPath(e.target.checked)} 
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="showPath" style={{ color: 'var(--text-main)', fontSize: '0.9rem', cursor: 'pointer' }}>Show Movement Path</label>
            </div>
            <CoordinateVisualizer 
              locations={locations} 
              sequence={sequence}
              showPath={showPath}
              gridConfigs={gridConfigs}
              selectedLocation={selectedLocation}
              selectedLocationData={locations.find(l => l.name === selectedLocation) || null}
              selectedModel={selectedModel}
              onSelectLocation={handleSelectLocation}
              onConfigChange={handleGridConfigChange}
            />
          </div>
        </section>

        {/* RIGHT COLUMN: Code Preview */}
        <section className="preview-section glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {locations.length > 0 && (
              <div className="locations-list" style={{ padding: '16px 16px 0 16px' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Locations (Click to view)</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {locations.filter(loc => loc.type === 'q').map((loc) => (
                    <button 
                      key={loc.name}
                      onClick={() => handleSelectLocation(loc.name === selectedLocation ? null : loc.name)}
                      style={{
                        background: selectedLocation === loc.name ? '#3b82f6' : 'var(--card-bg)',
                        color: selectedLocation === loc.name ? 'white' : 'var(--text-main)',
                        border: `1px solid ${selectedLocation === loc.name ? '#60a5fa' : 'var(--card-border)'}`,
                        padding: '6px 12px',
                        borderRadius: '16px',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        transition: 'all 0.2s ease',
                        boxShadow: selectedLocation === loc.name ? '0 0 10px rgba(59, 130, 246, 0.5)' : 'none'
                      }}
                    >
                      {loc.name.replace(/_q$/, '')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ padding: '0 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h2 style={{ fontSize: '1.1rem' }}>Generated Python</h2>
                {locations.length > 0 && (
                  <select value={targetApi} onChange={(e) => setTargetApi(e.target.value as ApiType)} style={{ background: 'var(--card-bg)', color: 'var(--text-main)', border: '1px solid var(--card-border)', padding: '4px 8px', borderRadius: '4px' }}>
                    <option value="ti_robots">ti_robots API</option>
                    <option value="cri">CRI API</option>
                  </select>
                )}
              </div>
              <button 
                className="btn" 
                onClick={downloadPython}
                disabled={!generatedCode}
                style={{ padding: '6px 12px', fontSize: '0.85rem' }}
              >
                <Download size={16} /> Download
              </button>
            </div>
            <div className="code-container">
              {generatedCode ? (
                <pre>
                  <code className="language-python">{generatedCode}</code>
                </pre>
              ) : (
                <div className="empty-state">
                  <FileCode2 size={48} className="empty-icon" />
                  <p>Upload a .script file to generate Python code</p>
                </div>
              )}
            </div>
        </section>
      </div>
    </div>
  );
}

export default App;
