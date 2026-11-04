// What sits in a component's slots, for drawing: a vial, an SBS plate, or a slide.
import type { DeckComponent } from './deck';

export type ItemKind = 'vial' | 'plate' | 'slide';

export function itemKind(c: DeckComponent): ItemKind | null {
  if (c.kind === 'block') return null;
  if (c.kind === 'side_rack') return 'slide';
  return c.gripHeight < 0.015 ? 'plate' : 'vial';
}

export function vialRadius(c: DeckComponent): number {
  const pitch = c.kind === 'tray' ? Math.min(c.colPitch, c.cols > 1 ? c.colPitch : 1, c.rows > 1 ? c.rowPitch : 1) : 1;
  return Math.max(0.004, Math.min(0.011, pitch * 0.36));
}
