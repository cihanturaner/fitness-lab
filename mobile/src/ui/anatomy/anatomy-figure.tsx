import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import type { MuscleGroup } from '@/data/home-facts';
import { color, space } from '@/theme/tokens';

import { BACK, CENTER, FRONT, VIEWBOX, type FigureArt } from './anatomy-art';

type Props = {
  /** Groups to highlight — only ever a focus a source states; empty draws a neutral body. */
  groups: readonly MuscleGroup[];
  /** Height of each figure in points; the width follows the artwork's aspect ratio. */
  height: number;
};

/**
 * Front and back figures side by side, trained groups in emerald on a neutral body. It is
 * decoration for sighted users only: the caller must state the same focus in text (and as
 * the accessibility label of the area around it).
 */
export function AnatomyFigure({ groups, height }: Props) {
  const on = new Set(groups);
  // One set of gradients per instance; ids must be valid in a url(#…) reference on web.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ids = { trained: `muscle-${id}`, resting: `plate-${id}`, skin: `skin-${id}` };
  const width = (height * VIEWBOX.width) / VIEWBOX.height;
  return (
    <View
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="anatomy-figure">
      <Figure art={FRONT} on={on} ids={ids} width={width} height={height} />
      <Figure art={BACK} on={on} ids={ids} width={width} height={height} />
    </View>
  );
}

type FigureProps = {
  art: FigureArt;
  on: ReadonlySet<MuscleGroup>;
  ids: { trained: string; resting: string; skin: string };
  width: number;
  height: number;
};

function Figure({ art, on, ids, width, height }: FigureProps) {
  const half = (
    <>
      {art.silhouette.map((d, i) => (
        <Path key={`s${i}`} d={d} fill={`url(#${ids.skin})`} />
      ))}
      {art.plates.map((plate, i) => (
        <Path
          key={`p${i}`}
          d={plate.d}
          fill={`url(#${plate.group && on.has(plate.group) ? ids.trained : ids.resting})`}
          stroke={color.card}
          strokeWidth={1.3}
          strokeLinejoin="round"
        />
      ))}
    </>
  );
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}>
      <Defs>
        {/* Each plate is lit from the upper left, so the body reads as rounded muscle. */}
        <RadialGradient id={ids.trained} cx="0.4" cy="0.35" r="0.75">
          <Stop offset="0" stopColor={color.muscleLight} />
          <Stop offset="1" stopColor={color.muscleDeep} />
        </RadialGradient>
        <RadialGradient id={ids.resting} cx="0.4" cy="0.35" r="0.75">
          <Stop offset="0" stopColor={color.bodyPlateLight} />
          <Stop offset="1" stopColor={color.bodyPlate} />
        </RadialGradient>
        <LinearGradient id={ids.skin} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={color.bodyShade} />
          <Stop offset="1" stopColor={color.body} />
        </LinearGradient>
      </Defs>
      <Ellipse cx={CENTER} cy={VIEWBOX.height - 10} rx={48} ry={6} fill={color.bodyFloor} />
      <G>{half}</G>
      <G transform={`matrix(-1 0 0 1 ${2 * CENTER} 0)`}>{half}</G>
    </Svg>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: space.xl },
});
