import { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, FileCode2, Download, Bot, Settings2, Box } from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-python';
import './App.css';
import CoordinateVisualizer from './CoordinateVisualizer';

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

type ApiType = 'ti_robots' | 'cri';

function App() {
  const [fileContent, setFileContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [locations, setLocations] = useState<ParsedLocation[]>([]);
  const [gridConfigs, setGridConfigs] = useState<Record<string, GridConfig>>({});
  const [targetApi, setTargetApi] = useState<ApiType>('ti_robots');
  const [generatedCode, setGeneratedCode] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  
  // Selection state for interactivity
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    if (locations.length > 0) {
      generatePython(locations, gridConfigs, targetApi);
    }
  }, [gridConfigs, targetApi, locations]);

  useEffect(() => {
    if (generatedCode) {
      Prism.highlightAll();
    }
  }, [generatedCode]);

  // Handle clicking a point in 3D
  const handleSelectLocation = useCallback((name: string) => {
    setSelectedLocation(name);
    
    // Scroll table to the selected row
    const rowElement = rowRefs.current[name];
    if (rowElement) {
      rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const parseScript = (content: string) => {
    const regex = /global\s+([a-zA-Z0-9_]+)\s*=\s*(p\[[\s\S]*?\]|\[[\s\S]*?\])/g;
    const parsedLocations: ParsedLocation[] = [];
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      const rawCoords = match[2];
      
      if (rawCoords.startsWith('[') && (rawCoords.includes('True') || rawCoords.includes('False'))) {
        continue;
      }
      
      const cleanCoords = rawCoords
        .replace(/^p\[/, '[') 
        .replace(/\n/g, '') 
        .replace(/\s+/g, ' '); 
        
      parsedLocations.push({
        name,
        type: rawCoords.startsWith('p') ? 'p' : 'q',
        coordinates: cleanCoords
      });
    }

    setLocations(parsedLocations);
    
    const initialConfigs: Record<string, GridConfig> = {};
    parsedLocations.forEach(loc => {
      if (!gridConfigs[loc.name]) {
        initialConfigs[loc.name] = { isGrid: false, cols: 12, rows: 8, dx: 0.009, dy: 0.009 };
      }
    });
    setGridConfigs(prev => ({ ...prev, ...initialConfigs }));
  };

  const handleGridConfigChange = (locName: string, field: keyof GridConfig, value: number | boolean) => {
    setGridConfigs(prev => ({
      ...prev,
      [locName]: {
        ...prev[locName],
        [field]: value
      }
    }));
  };

  const generatePython = (locs: ParsedLocation[], configs: Record<string, GridConfig>, api: ApiType) => {
    let pythonCode = `import time\n\n# Auto-generated ArmManager from URScript\n# Target API: ${api}\n\nclass ArmManager:\n    def __init__(self, robot_arm=None, gripper=None):\n        """\n        Initialize the ArmManager.\n        :param robot_arm: Instance of your robot controller\n        :param gripper: Instance of your gripper controller\n        """\n        self.robot = robot_arm\n        self.gripper = gripper\n        \n        # Hardcoded locations parsed from URScript\n        # Format: "Name": ("type", [coordinates])\n        self.locations = {\n`;

    locs.forEach(loc => {
      pythonCode += `            "${loc.name}": ("${loc.type}", ${loc.coordinates}),\n`;
    });

    pythonCode += `        }\n        \n        self.location_names = list(self.locations.keys())\n\n`;
    
    pythonCode += `    def open_gripper(self):\n        """Opens the gripper."""\n        if self.gripper:\n            self.gripper.open()\n        else:\n            print("Gripper not configured, cannot open.")\n            \n    def close_gripper(self):\n        """Closes the gripper."""\n        if self.gripper:\n            self.gripper.close()\n        else:\n            print("Gripper not configured, cannot close.")\n\n`;

    if (api === 'ti_robots') {
        pythonCode += `    def _move_cartesian(self, pose):\n        if self.robot:\n            self.robot.move_to_location(pose)\n        else:\n            print(f"Simulated cartesian move to: {pose}")\n\n`;
    } else {
        pythonCode += `    def _move_cartesian(self, pose):\n        if self.robot:\n            self.robot.move_linear(pose)\n        else:\n            print(f"Simulated cartesian move to: {pose}")\n\n`;
    }
    
    pythonCode += `    def _move_joints(self, joints):\n        if self.robot:\n            self.robot.move_joints(joints)\n        else:\n            print(f"Simulated joint move to: {joints}")\n\n`;
    
    pythonCode += `    # ==========================================\n    # Explicit Location Methods\n    # ==========================================\n`;

    locs.forEach(loc => {
      const config = configs[loc.name];
      
      if (loc.type === 'p' && config?.isGrid) {
        pythonCode += `
    def move_to_${loc.name}_grid(self, index: int):
        """Move to indexed location on ${loc.name} grid (Cols: ${config.cols}, Rows: ${config.rows})"""
        cols = ${config.cols}
        rows = ${config.rows}
        dx = ${config.dx}
        dy = ${config.dy}
        
        if index < 0 or index >= (cols * rows):
            raise ValueError(f"Index {index} out of bounds for ${loc.name} grid.")
            
        col = index % cols
        row = index // cols
        
        # Extract base coordinates (X, Y, Z, Rx, Ry, Rz)
        base_coords = list(self.locations["${loc.name}"][1])
        
        # Apply offsets
        base_coords[0] += col * dx
        base_coords[1] += row * dy
        
        print(f"Moving to ${loc.name} Grid Index {index} (Col: {col}, Row: {row})...")
        self._move_cartesian(base_coords)\n`;
      } else {
        if (loc.type === 'p') {
          pythonCode += `
    def move_to_${loc.name}(self):
        """Move to ${loc.name} (Cartesian)."""
        print(f"Moving to ${loc.name}...")
        self._move_cartesian(self.locations["${loc.name}"][1])\n`;
        } else {
          pythonCode += `
    def move_to_${loc.name}(self):
        """Move to ${loc.name} (Joints)."""
        print(f"Moving to ${loc.name}...")
        self._move_joints(self.locations["${loc.name}"][1])\n`;
        }
      }
    });

    setGeneratedCode(pythonCode);
  };

  const handleFileUpload = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setFileContent(content);
      parseScript(content);
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
    <div className="app-container">
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
          <select value={targetApi} onChange={(e) => setTargetApi(e.target.value as ApiType)}>
            <option value="ti_robots">API: ti_robots</option>
            <option value="cri">API: cri</option>
          </select>
        </div>
        <div 
          className={`drop-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
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

      {/* MIDDLE ROW: Full Width 3D Workspace */}
      <section className="visualizer-section glass-panel">
        <div className="section-header" style={{padding: '16px 16px 0', marginBottom: 8}}>
          <h2><Box size={18} style={{marginRight: 8, verticalAlign: 'middle'}}/> 3D Workspace Preview</h2>
        </div>
        <div className="visualizer-container">
          <CoordinateVisualizer 
            locations={locations} 
            gridConfigs={gridConfigs}
            selectedLocation={selectedLocation}
            onSelectLocation={handleSelectLocation}
            onConfigChange={handleGridConfigChange}
          />
        </div>
      </section>

      {/* BOTTOM ROW: Code Preview */}
      <section className="preview-section glass-panel" style={{minHeight: '300px'}}>
          <div className="preview-header">
            <h2>Generated Python</h2>
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
          
          <div className="code-container" style={{minHeight: '300px'}}>
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
  );
}

export default App;
