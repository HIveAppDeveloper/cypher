/*
 * The Open GrokBot brand mark: a ribbon of binary digits folded into a sine
 * wave, drawn from the supplied reference artwork. Pure canvas drawing with no
 * React and no internal state, so the animated mark and a single settled frame
 * share one code path.
 */

export type BinaryWaveFrame = {
  width: number;
  height: number;
  /** Radians travelled along the ribbon; the caller advances this over time. */
  phase: number;
  /** 0-1 entrance progress. 1 is the settled mark. */
  reveal: number;
  /** 0-1 eased pointer presence. */
  hover: number;
  /** Pointer position across the ribbon (0 left, 1 right), or NaN when away. */
  pointer: number;
  /** 0-1 energy: the ribbon runs faster and darker while work is underway. */
  energy: number;
  /** Seconds the mark has been running; only drives the occasional digit flip. */
  time: number;
  /** Draw the ribbon in light ink for a dark surface. */
  invert?: boolean;
};

export type BinaryWaveMetrics = {
  fontSize: number;
  columns: number;
  rows: number;
  padX: number;
  bandWidth: number;
};

const TAU = Math.PI * 2;
const WAVES = 1.15;
const FONT = '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif';

/** Geometry for a mark of the given size; the component reuses it for pointer math. */
export function binaryWaveMetrics(width: number, height: number): BinaryWaveMetrics {
  const fontSize = Math.max(4, Math.min(11, height / 7));
  const padX = fontSize * 0.75;
  const bandWidth = Math.max(fontSize * 3, width - padX * 2);
  return {
    fontSize,
    padX,
    bandWidth,
    columns: Math.max(5, Math.round(bandWidth / (fontSize * 0.72))),
    rows: fontSize >= 7 ? 4 : 3,
  };
}

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}

/** Stable per-cell randomness so a digit never flickers between frames. */
function noise(a: number, b: number, c: number) {
  let h = Math.imul(a * 73856093 ^ b * 19349663 ^ (c + 1) * 83492791, 2246822519);
  h ^= h >>> 15;
  h = Math.imul(h, 2654435761);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}

export function drawBinaryWave(context: CanvasRenderingContext2D, frame: BinaryWaveFrame) {
  const { width, height, phase, reveal, hover, pointer, energy, time, invert = false } = frame;
  const { fontSize, columns, rows, padX, bandWidth } = binaryWaveMetrics(width, height);
  context.clearRect(0, 0, width, height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const reach = clamp(hover, 0, 1);
  const pointing = reach > 0.002 && Number.isFinite(pointer);
  const amplitude = height * 0.17 * (1 + 0.06 * Math.sin(phase * 0.7)) * (0.85 + 0.3 * energy) * (1 + 0.3 * reach);
  const centre = height * 0.54;

  for (let column = 0; column < columns; column++) {
    const across = columns === 1 ? 0.5 : column / (columns - 1);
    const angle = across * TAU * WAVES + phase;
    const wave = Math.sin(angle);
    const slope = Math.cos(angle);
    const depth = (wave + 1) / 2; // 1 at the far crest, 0 in the near trough
    const edge = clamp((Math.min(across, 1 - across) - 0.03) / 0.2, 0, 1);
    const near = pointing ? Math.exp(-Math.pow((across - pointer) * 3.1, 2)) * reach : 0;
    const spine = centre - amplitude * wave * (1 + 0.4 * near);
    const rowGap = fontSize * 0.95 * (0.55 + 0.55 * (1 - depth));

    for (let row = 0; row < rows; row++) {
      const rank = rows === 1 ? 0 : (row / (rows - 1)) * 2 - 1; // -1 top .. 1 bottom
      const arrival = clamp((reveal * 1.35 - across * 0.9) / 0.45, 0, 1);
      if (arrival <= 0) continue;

      const cell = noise(column, row, 0);
      const size = fontSize * (0.78 + 0.34 * (1 - depth)) * (1 + 0.05 * near) * (0.9 + 0.1 * arrival);
      const x = padX + 0.35 * fontSize + across * (bandWidth - 0.7 * fontSize) + rank * fontSize * 0.4 * slope * (0.5 + 0.5 * (1 - depth));
      const y = spine + rank * rowGap * ((rows - 1) / 2) + (1 - arrival) * fontSize * 2.2;
      // Near and middle digits stay dark and dense; far, outer and edge digits lighten and thin out.
      const ink = clamp(0.18 + 0.42 * depth + 0.2 * Math.pow(Math.abs(rank), 1.3) + (1 - edge) * 0.22 - 0.1 * near - 0.05 * energy, 0.08, 0.86);
      const alpha = arrival * (1 - 0.55 * Math.abs(rank)) * (0.35 + 0.65 * edge) * (0.7 + 0.3 * (1 - depth)) * (1 + 0.25 * near);
      const shade = Math.round((invert ? 1 - ink : ink) * 255);
      // Roughly one digit in nine flips while the ribbon runs: live data, not a frozen pattern.
      const glyph = cell < 0.11 ? (Math.floor(time * 0.8 + noise(column, row, 3) * 8) % 2 !== 0 ? '1' : '0') : cell < 0.55 ? '1' : '0';
      const tilt = slope * (0.05 + 0.28 * noise(column, row, 1)) * (0.35 + 0.65 * depth);

      context.save();
      context.translate(x, y);
      if (tilt) context.rotate(tilt);
      context.font = `${size < 6 ? 600 : 550} ${size.toFixed(2)}px ${FONT}`;
      context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${clamp(alpha, 0, 1).toFixed(3)})`;
      context.fillText(glyph, 0, 0);
      context.restore();
    }
  }
}
