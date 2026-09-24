import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import type { MuscleGroup } from '@/data/home-facts';

import { BACK, CENTER, FRONT } from '../anatomy-art';
import { AnatomyFigure } from '../anatomy-figure';
import { MuscleFocus } from '../muscle-focus';

const ALL: MuscleGroup[] = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'abs',
];

type Brush = { type: number } | undefined;

/**
 * The fill of every muscle plate drawn (both halves of both figures). Plates are the paths
 * with a stroke; react-native-svg hands the native view a brush whose type is 1 for a
 * `url(#…)` gradient (a highlight) and 0 for a plain colour.
 */
async function plateBrushes(groups: MuscleGroup[]): Promise<Brush[]> {
  const { container } = await render(<AnatomyFigure groups={groups} height={200} />);
  return container
    .queryAll((node) => node.type === 'RNSVGPath' && node.props.stroke != null)
    .map((node) => node.props.fill as Brush);
}

const highlighted = (brushes: Brush[]) => brushes.filter((b) => b?.type === 1).length;

describe('anatomy artwork', () => {
  it('can draw every muscle group, on at least one of the two figures', () => {
    const drawn = new Set([...FRONT.plates, ...BACK.plates].map((p) => p.group));
    for (const group of ALL) expect([group, drawn.has(group)]).toEqual([group, true]);
  });

  it('draws only the left half (the renderer mirrors it)', () => {
    for (const d of [...FRONT.silhouette, ...BACK.silhouette, ...[...FRONT.plates, ...BACK.plates].map((p) => p.d)]) {
      const xs = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
      expect(Math.max(...xs)).toBeLessThanOrEqual(CENTER);
    }
  });
});

describe('AnatomyFigure', () => {
  it('highlights exactly the plates of the stated groups', async () => {
    const brushes = await plateBrushes(['chest', 'biceps']);
    const stated = [...FRONT.plates, ...BACK.plates].filter((p) => p.group === 'chest' || p.group === 'biceps');
    expect(brushes).toHaveLength(2 * (FRONT.plates.length + BACK.plates.length));
    expect(highlighted(brushes)).toBe(2 * stated.length);
  });

  it('draws a neutral body when no focus is stated', async () => {
    const brushes = await plateBrushes([]);
    expect(brushes.length).toBeGreaterThan(0);
    expect(highlighted(brushes)).toBe(0);
  });

  it('is hidden from assistive technology — the focus is stated in text instead', async () => {
    await render(<AnatomyFigure groups={['back']} height={200} />);
    expect(screen.queryByTestId('anatomy-figure')).toBeNull();
    const figure = screen.getByTestId('anatomy-figure', { includeHiddenElements: true });
    expect(figure.props.accessibilityElementsHidden).toBe(true);
  });
});

describe('MuscleFocus', () => {
  it('names the stated focus in text and in its accessibility label', async () => {
    await render(<MuscleFocus groups={['back', 'biceps']} labels={['Back', 'Biceps']} height={200} />);
    expect(screen.getByLabelText('Focus: Back, Biceps')).toBeOnTheScreen();
    expect(screen.getByText('Back · Biceps')).toBeOnTheScreen();
  });

  it('says so, rather than inventing one, when no focus is stated', async () => {
    await render(<MuscleFocus groups={[]} labels={[]} height={200} />);
    expect(screen.getByText('No muscle focus stated for this workout')).toBeOnTheScreen();
  });
});
