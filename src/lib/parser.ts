import type { ParsedLocation } from '../types';

export const parseScript = (content: string): ParsedLocation[] => {
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

  return parsedLocations;
};
