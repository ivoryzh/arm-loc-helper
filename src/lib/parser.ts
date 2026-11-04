// Reads the waypoints out of a URScript file, as Polyscope saves them (`global Waypoint_1_p=p[...]`
// and `global Waypoint_1_q=[...]` for the same waypoint) or as people write them by hand
// (`global vial_tray = p[...]`, `home_q = [...]`), the TCP (`set_tcp(p[...])`) and the order of
// the moves (`movej(get_inverse_kin(Waypoint_1_p, qnear=Waypoint_1_q), ...)`, `movel(approach)`).
import type { Joints } from './kinematics';
import type { ScriptInfo, Waypoint } from './deck';

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const LIST = String.raw`\[\s*${NUM}(?:\s*,\s*${NUM})*\s*\]`;

function numbers(text: string): number[] {
  return (text.match(new RegExp(NUM, 'g')) ?? []).map(Number);
}

/** `Waypoint_1_p` and `Waypoint_1_q` are one waypoint, Waypoint_1. */
function baseName(name: string): string {
  return name.replace(/_(p|q)$/, '');
}

export interface ParsedScript {
  waypoints: Waypoint[];
  script: Omit<ScriptInfo, 'fileName'>;
}

export function parseScript(content: string): ParsedScript {
  const byName = new Map<string, Waypoint>();
  const varToWaypoint = new Map<string, string>();
  const assign = new RegExp(String.raw`(?:^|[\s;])(?:global\s+|local\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(p?)(${LIST})`, 'gm');
  let m: RegExpExecArray | null;
  while ((m = assign.exec(content)) !== null) {
    const [, name, isPose, list] = m;
    const values = numbers(list);
    if (values.length !== 6) continue;
    const key = baseName(name);
    const wp = byName.get(key) ?? { name: key };
    if (isPose) wp.pose = values;
    else wp.q = values as Joints;
    byName.set(key, wp);
    varToWaypoint.set(name, key);
  }

  const tcpMatch = content.match(new RegExp(String.raw`set_tcp\s*\(\s*p(${LIST})`));
  const tcp = tcpMatch ? numbers(tcpMatch[1]) : undefined;

  // move calls, with their (possibly nested) arguments; the target is the first waypoint they name
  const sequence: { move: string; target: string }[] = [];
  const moveRe = /\b(move[jlp]|servoj)\s*\(/g;
  while ((m = moveRe.exec(content)) !== null) {
    let depth = 1, i = moveRe.lastIndex;
    while (i < content.length && depth > 0) {
      if (content[i] === '(') depth++;
      else if (content[i] === ')') depth--;
      i++;
    }
    const args = content.slice(moveRe.lastIndex, i - 1);
    const ident = (args.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).find((w) => varToWaypoint.has(w));
    if (ident) sequence.push({ move: m[1], target: varToWaypoint.get(ident)! });
  }

  return {
    waypoints: [...byName.values()],
    script: { sequence, tcp: tcp && tcp.length === 6 ? tcp : undefined },
  };
}
