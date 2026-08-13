import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Settings2, Download, Upload, FileCode2, Bot } from 'lucide-react';
import CoordinateVisualizer from './components/3d/CoordinateVisualizer';
import './styles/App.css';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-python';
import type { ParsedLocation, GridConfig, ApiType, URModel } from './types';
import { parseScript } from './lib/parser';
import { generatePython } from './lib/generator';

function App() {
  const [fileName, setFileName] = useState<string>('');
  const [locations, setLocations] = useState<ParsedLocation[]>([]);
  const [gridConfigs, setGridConfigs] = useState<Record<string, GridConfig>>({});
  const [targetApi, setTargetApi] = useState<ApiType>('ti_robots');
  const [selectedModel, setSelectedModel] = useState<URModel>('UR5');
  const [generatedCode, setGeneratedCode] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  
  // Selection state for interactivity
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

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

  // Handle clicking a point in 3D
  const handleSelectLocation = useCallback((name: string | null) => {
    setSelectedLocation(name);
    
    if (name) {
      const rowElement = rowRefs.current[name];
      if (rowElement) {
        rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, []);

  const handleGridConfigChange = (locName: string, field: keyof GridConfig, value: number | boolean) => {
    setGridConfigs(prev => ({
      ...prev,
      [locName]: {
        ...prev[locName],
        [field]: value
      }
    }));
  };

  const handleFileUpload = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const parsedLocations = parseScript(content);
      setLocations(parsedLocations);
      
      setGridConfigs(prev => {
         const newConfigs = { ...prev };
         parsedLocations.forEach(loc => {
           if (!newConfigs[loc.name]) {
             newConfigs[loc.name] = { isGrid: false, cols: 12, rows: 8, dx: 0.009, dy: 0.009 };
           }
         });
         return newConfigs;
      });
    };
    reader.readAsText(file);
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
      handleFileUpload(e.dataTransfer.files[0]);
    }
  }, []);

  const handleDownload = () => {
    const blob = new Blob([generatedCode], { type: 'text/python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'arm_manager.py';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div 
      className="app-container"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="header">
        <div className="logo">
          <Bot size={24} color="#3b82f6" />
          <h1>URScript to Python <span className="highlight">Converter</span></h1>
        </div>
      </header>

      {/* TOP ROW: Dropzone & Settings */}
      <div className="top-bar-container">
        <div className="api-selector">
          <Settings2 size={16} color="#94a3b8" />
          <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as URModel)} style={{ marginLeft: 8 }}>
            <option value="UR3">UR3 (Small)</option>
            <option value="UR5">UR5 (Medium)</option>
            <option value="UR10">UR10 (Large)</option>
          </select>
        </div>
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
            <CoordinateVisualizer 
              locations={locations} 
              gridConfigs={gridConfigs}
              selectedLocation={selectedLocation}
              selectedModel={selectedModel}
              onSelectLocation={handleSelectLocation}
              onConfigChange={handleGridConfigChange}
            />
          </div>
        </section>

        {/* RIGHT COLUMN: Code Preview */}
        <section className="preview-section glass-panel">
            <div className="preview-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h2>Generated Python</h2>
                <select value={targetApi} onChange={(e) => setTargetApi(e.target.value as ApiType)} style={{ background: '#1e293b', color: 'white', border: '1px solid #334155', padding: '4px 8px', borderRadius: '4px' }}>
                  <option value="ti_robots">API: ti_robots</option>
                  <option value="cri">API: cri</option>
                </select>
              </div>
              <button 
                className="btn download-btn" 
                onClick={handleDownload}
                disabled={!generatedCode}
                style={{padding: '6px 12px'}}
              >
                <Download size={14} />
                Download
              </button>
            </div>
            
            <div className="code-container">
              {generatedCode ? (
                <pre><code className="language-python">{generatedCode}</code></pre>
              ) : (
                <div className="empty-state">
                  <FileCode2 size={48} className="empty-icon" />
                  <p>Python code will generate here.</p>
                </div>
              )}
            </div>
          </section>
      </div>
    </div>
  );
}

export default App;
