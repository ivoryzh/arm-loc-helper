import type { ParsedLocation, MoveSequenceItem } from '../types';

export const parseScript = (content: string): { locations: ParsedLocation[], sequence: MoveSequenceItem[] } => {
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
      
    const elementsCount = cleanCoords.replace('[', '').replace(']', '').split(',').length;
    if (elementsCount !== 6) {
      continue;
    }
      
    parsedLocations.push({
      name,
      type: rawCoords.startsWith('p') ? 'p' : 'q',
      coordinates: cleanCoords
    });
  }

  const sequenceRegex = /(move[ljp])\s*\(\s*([a-zA-Z0-9_]+)\s*(?:,.*)?\)/g;
  const sequence: MoveSequenceItem[] = [];
  let seqMatch;
  while ((seqMatch = sequenceRegex.exec(content)) !== null) {
    const moveType = seqMatch[1];
    const targetName = seqMatch[2];
    sequence.push({ moveType, target: targetName });
  }

  return { locations: parsedLocations, sequence };
};
