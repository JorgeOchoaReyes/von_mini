/**
 * Ben-Day halftone dots: the printed-comic shading texture. A grid of dots that shrink with
 * distance from one corner, drawn with plain Views so it renders the same on Android and the web
 * without an SVG dependency. Purely decorative: position it in a panel's corner, away from text.
 */
import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

export const Halftone = memo(function Halftone({
  color,
  cols = 9,
  rows = 7,
  spacing = 14,
  maxDot = 9,
  from = 'top-right',
  opacity = 1,
  style,
}: {
  color: string;
  cols?: number;
  rows?: number;
  spacing?: number;
  maxDot?: number;
  /** The corner the dots grow from. */
  from?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  opacity?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const dots = [];
  const maxDist = Math.hypot(cols - 1, rows - 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Distance from the growth corner, 0..1.
      const dx = from.endsWith('right') ? cols - 1 - c : c;
      const dy = from.startsWith('bottom') ? rows - 1 - r : r;
      const t = Math.hypot(dx, dy) / maxDist;
      const size = maxDot * (1 - t);
      if (size < 1.5) continue;
      // Offset every other row, like a printed screen.
      const x = c * spacing + (r % 2 ? spacing / 2 : 0);
      dots.push(
        <View
          key={`${r}:${c}`}
          style={{
            position: 'absolute',
            left: x - size / 2,
            top: r * spacing - size / 2,
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
          }}
        />,
      );
    }
  }
  return (
    <View
      pointerEvents="none"
      style={[{ position: 'absolute', width: cols * spacing, height: rows * spacing, opacity }, style]}
    >
      {dots}
    </View>
  );
});
