/**
 * A QR code drawn with plain views, so it needs no native module or SVG library and ships in an
 * over-the-air update. Each row is drawn as runs of dark modules (one view per run, not per
 * square), which keeps even a large code to a few thousand views.
 *
 * Always black on white with a quiet zone, whatever the theme: scanners need the contrast.
 */
import makeQR from 'qrcode-generator';
import { memo, useMemo } from 'react';
import { PixelRatio, View } from 'react-native';

const QUIET = 4;

export const QRCode = memo(function QRCode({ value, size, label }: { value: string; size: number; label?: string }) {
  const { count, runs } = useMemo(() => {
    const qr = makeQR(0, 'L');
    qr.addData(value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const out: { row: number; col: number; len: number }[] = [];
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!qr.isDark(r, c)) {
          c++;
          continue;
        }
        const start = c;
        while (c < n && qr.isDark(r, c)) c++;
        out.push({ row: r, col: start, len: c - start });
      }
    }
    return { count: n, runs: out };
  }, [value]);

  // Whole device pixels per module: crisp edges scan far better than blurry fractional ones.
  const cell = PixelRatio.roundToNearestPixel(Math.max(1 / PixelRatio.get(), Math.floor((size / (count + QUIET * 2)) * PixelRatio.get()) / PixelRatio.get()));
  size = cell * (count + QUIET * 2);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label ?? 'QR code'}
      style={{ width: size, height: size, backgroundColor: '#FFFFFF', borderRadius: cell * 2 }}
    >
      {runs.map((r, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: (r.col + QUIET) * cell,
            top: (r.row + QUIET) * cell,
            width: r.len * cell,
            height: cell,
            backgroundColor: '#000000',
          }}
        />
      ))}
    </View>
  );
});
