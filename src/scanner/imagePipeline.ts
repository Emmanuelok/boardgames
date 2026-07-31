import type { ScanCell, ScanCrop, ScanResult, ScannerGame } from './types';

const DEFAULT_CROP: ScanCrop = { top: 0.03, right: 0.03, bottom: 0.03, left: 0.03 };

type Rgb = { r: number; g: number; b: number; luma: number };

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeCrop(crop: Partial<ScanCrop> | undefined): ScanCrop {
  const next = {
    top: clamp(Number(crop?.top ?? DEFAULT_CROP.top), 0, 0.35),
    right: clamp(Number(crop?.right ?? DEFAULT_CROP.right), 0, 0.35),
    bottom: clamp(Number(crop?.bottom ?? DEFAULT_CROP.bottom), 0, 0.35),
    left: clamp(Number(crop?.left ?? DEFAULT_CROP.left), 0, 0.35),
  };
  if (next.left + next.right > 0.7) next.right = 0.7 - next.left;
  if (next.top + next.bottom > 0.7) next.bottom = 0.7 - next.top;
  return next;
}

function averagePatch(
  image: ImageData,
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
): { color: Rgb; variance: number } {
  const x0 = Math.max(0, Math.floor(cx - radiusX));
  const x1 = Math.min(image.width - 1, Math.ceil(cx + radiusX));
  const y0 = Math.max(0, Math.floor(cy - radiusY));
  const y1 = Math.min(image.height - 1, Math.ceil(cy + radiusY));
  let r = 0;
  let g = 0;
  let b = 0;
  let luma = 0;
  let lumaSq = 0;
  let n = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const offset = (y * image.width + x) * 4;
      if (image.data[offset + 3] < 16) continue;
      const pr = image.data[offset];
      const pg = image.data[offset + 1];
      const pb = image.data[offset + 2];
      const pl = pr * 0.2126 + pg * 0.7152 + pb * 0.0722;
      r += pr;
      g += pg;
      b += pb;
      luma += pl;
      lumaSq += pl * pl;
      n += 1;
    }
  }
  if (!n) return { color: { r: 0, g: 0, b: 0, luma: 0 }, variance: 0 };
  const mean = luma / n;
  return {
    color: { r: r / n, g: g / n, b: b / n, luma: mean },
    variance: Math.max(0, lumaSq / n - mean * mean),
  };
}

function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * Samples the centre of every square/intersection against four nearby
 * background patches. It deliberately reports uncertainty instead of claiming
 * to recognize arbitrary piece silhouettes.
 */
export function sampleBoardImage(
  image: ImageData,
  game: ScannerGame,
  cropInput?: Partial<ScanCrop>,
): ScanResult {
  const crop = normalizeCrop(cropInput);
  const left = crop.left * image.width;
  const top = crop.top * image.height;
  const usableWidth = image.width * (1 - crop.left - crop.right);
  const usableHeight = image.height * (1 - crop.top - crop.bottom);
  const spanX = usableWidth / (game.sampling === 'intersections' ? Math.max(1, game.cols - 1) : game.cols);
  const spanY = usableHeight / (game.sampling === 'intersections' ? Math.max(1, game.rows - 1) : game.rows);

  const raw: Array<{
    index: number;
    row: number;
    col: number;
    score: number;
    luma: number;
  }> = [];

  for (let row = 0; row < game.rows; row += 1) {
    for (let col = 0; col < game.cols; col += 1) {
      const cx = game.sampling === 'intersections'
        ? left + col * spanX
        : left + (col + 0.5) * spanX;
      const cy = game.sampling === 'intersections'
        ? top + row * spanY
        : top + (row + 0.5) * spanY;
      const centre = averagePatch(image, cx, cy, spanX * 0.17, spanY * 0.17);
      const offsets: Array<[number, number]> = [
        [-0.33, -0.33],
        [0.33, -0.33],
        [-0.33, 0.33],
        [0.33, 0.33],
      ];
      const backgrounds = offsets.map(([dx, dy]) => (
        averagePatch(image, cx + dx * spanX, cy + dy * spanY, spanX * 0.08, spanY * 0.08)
      ));
      const background: Rgb = {
        r: backgrounds.reduce((sum, patch) => sum + patch.color.r, 0) / backgrounds.length,
        g: backgrounds.reduce((sum, patch) => sum + patch.color.g, 0) / backgrounds.length,
        b: backgrounds.reduce((sum, patch) => sum + patch.color.b, 0) / backgrounds.length,
        luma: backgrounds.reduce((sum, patch) => sum + patch.color.luma, 0) / backgrounds.length,
      };
      const contrast = colorDistance(centre.color, background);
      const texture = Math.sqrt(centre.variance);
      const score = clamp(contrast / 92 + texture / 78, 0, 1);
      raw.push({ index: row * game.cols + col, row, col, score, luma: centre.color.luma });
    }
  }

  // Use a conservative threshold. The correction grid is an intentional part
  // of the workflow because board materials and lighting vary greatly.
  const occupied = raw.filter((sample) => sample.score >= 0.46);
  let dark = 70;
  let light = 185;
  if (occupied.length >= 2) {
    dark = Math.min(...occupied.map((sample) => sample.luma));
    light = Math.max(...occupied.map((sample) => sample.luma));
  }
  const midpoint = (dark + light) / 2;
  const separation = Math.max(18, light - dark);

  const cells: ScanCell[] = raw.map((sample) => {
    const present = sample.score >= 0.46;
    const occupant = !present
      ? 'empty'
      : sample.luma >= midpoint
        ? (game.lighterPlayer === 0 ? 'player0' : 'player1')
        : (game.lighterPlayer === 0 ? 'player1' : 'player0');
    const occupancyConfidence = clamp(Math.abs(sample.score - 0.46) / 0.54);
    const sideConfidence = present ? clamp(Math.abs(sample.luma - midpoint) / (separation / 2)) : 1;
    return {
      index: sample.index,
      row: sample.row,
      col: sample.col,
      occupant,
      kind: present ? game.defaultKind : '',
      confidence: clamp(occupancyConfidence * 0.7 + sideConfidence * 0.3),
      occupancyScore: sample.score,
    };
  });
  const averageConfidence = cells.reduce((sum, cell) => sum + cell.confidence, 0) / Math.max(1, cells.length);
  return {
    cells,
    averageConfidence,
    lowConfidenceCount: cells.filter((cell) => cell.confidence < 0.55).length,
  };
}

export interface DecodedBoardImage {
  imageData: ImageData;
  width: number;
  height: number;
}

/**
 * Decodes and downscales a local File. The caller owns any preview object URL;
 * this helper creates no persistent data and performs no network request.
 */
export async function decodeBoardImage(file: File, maxDimension = 1200): Promise<DecodedBoardImage> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 18 * 1024 * 1024) throw new Error('Choose an image smaller than 18 MB.');

  let source: CanvasImageSource;
  let sourceWidth: number;
  let sourceHeight: number;
  let bitmap: ImageBitmap | null = null;
  if (typeof createImageBitmap === 'function') {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    source = bitmap;
    sourceWidth = bitmap.width;
    sourceHeight = bitmap.height;
  } else {
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('The image could not be decoded.'));
        element.src = url;
      });
      source = image;
      sourceWidth = image.naturalWidth;
      sourceHeight = image.naturalHeight;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap?.close();
    throw new Error('This browser cannot prepare the image.');
  }
  context.drawImage(source, 0, 0, width, height);
  bitmap?.close();
  return { imageData: context.getImageData(0, 0, width, height), width, height };
}
