// Right column, Python tab: the exported controller, its deck as JSON, and how to run them.
import { useMemo, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism-tomorrow.css';
import { Check, ClipboardCopy, Download, FileJson } from 'lucide-react';
import runtimeSource from '../../../arm_loc_helper/runtime.py?raw';
import type { Finding } from '../../lib/checks';
import { generatePython, moduleNameOf, runtimeBody } from '../../lib/generator';
import { exportDeck } from '../../lib/runtimeDeck';
import { download } from '../../lib/storage';
import { useStore } from '../../state';
import { Toggle } from './fields';

export function CodePanel({ findings }: { findings: Finding[] }) {
  const { project } = useStore();
  const [showRuntime, setShowRuntime] = useState(false);
  const [copied, setCopied] = useState(false);
  const moduleName = moduleNameOf(project);
  const code = useMemo(() => generatePython(project, runtimeSource, moduleName), [project, moduleName]);
  const errors = findings.filter((f) => f.level === 'error');

  const shown = useMemo(() => {
    if (showRuntime) return code;
    const body = runtimeBody(runtimeSource);
    const lines = body.split('\n').length;
    return code.replace(body, `# ... ${lines} lines: ArmController, the ur_rtde and simulation drivers, the Robotiq and\n# digital-output grippers (arm_loc_helper/runtime.py). Tick "Show the runtime" to read them.`);
  }, [code, showRuntime]);
  const html = useMemo(() => Prism.highlight(shown, Prism.languages.python, 'python'), [shown]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="code-panel">
      {errors.length > 0 && (
        <div className="summary bad small">The Checks tab has {errors.length} problem{errors.length > 1 ? 's' : ''}: the file is written anyway, but the robot would refuse those moves.</div>
      )}
      <div className="code-actions">
        <button className="btn primary" onClick={() => download(`${moduleName}.py`, code, 'text/x-python')}><Download size={14} /> {moduleName}.py</button>
        <button className="btn" onClick={copy}>{copied ? <Check size={14} /> : <ClipboardCopy size={14} />} Copy</button>
        <button className="btn" title="The deck as data, for ArmController(json.load(...))" onClick={() => download(`${moduleName}.deck.json`, JSON.stringify(exportDeck(project), null, 2), 'application/json')}>
          <FileJson size={14} /> deck.json
        </button>
        <Toggle label="Show the runtime" checked={showRuntime} onChange={setShowRuntime} />
      </div>
      <details className="howto">
        <summary>Run it</summary>
        <pre className="mono small">{`pip install ur_rtde          # only for the real robot
python ${moduleName}.py        # a dry run in simulation

from ${moduleName} import ${project.className}
arm = ${project.className}(host="192.168.1.10", speed=0.3)
arm.transfer(...)`}</pre>
        <p className="small">In IvoryOS it is an ordinary instrument: create it in your deck script and every method (with the locations as dropdowns) is in the workflow designer.</p>
        <pre className="mono small">{`import ivoryos_edge
from ${moduleName} import ${project.className}

arm = ${project.className}()   # host="..." for the robot

if __name__ == "__main__":
    ivoryos_edge.run(__name__)`}</pre>
      </details>
      <pre className="code language-python"><code className="language-python" dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}
