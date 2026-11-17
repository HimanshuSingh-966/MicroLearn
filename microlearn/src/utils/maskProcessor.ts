/**
 * Real Mask Processor & Pixel Coordinate Hit-Testing for OCI U-Net Output
 *
 * Implements:
 * 1. Lossless mask decoding for declared PNG label masks and explicit raw buffer formats
 *    without browser canvas 2D sRGB color conversion distortion.
 * 2. Dimension and frame identity validation (strictly rejects mismatched / resized masks).
 * 3. Exact screen-to-mask mapping taking letterboxing / object-fit into account (never clamps OOB clicks).
 * 4. Cell wall selection highlighting visible wall pixels only (never filling cell interiors).
 * 5. Two-click candidate disambiguation for shared walls and incomplete boundary handling.
 * 6. Dynamic model class definition metadata (no hardcoded class IDs).
 */

import type {
  ApproximateConnectedRegion,
  DetectedStructure,
  InferenceJobResponse,
  MaskClickResult,
  ModelClassDefinition,
  SemanticClassEntry,
} from '../types/microscope.ts';
import { MICROSCOPE_CONFIG, resolveOciResourceUrl } from '../config/microscopeConfig.ts';

export interface ContainedRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LoadedMaskData {
  frameId: string;
  width: number;
  height: number;
  classData: Uint8Array;
  cellIdData: Uint32Array | Uint16Array | null;
  hasCellIdMask: boolean;
  maskEncoding: string;
  getClassAt: (x: number, y: number) => number;
  getCellIdAt: (x: number, y: number) => number | null;
}

export interface MaskValidationParams {
  expectedFrameId: string;
  actualFrameId: string;
  expectedWidth: number;
  expectedHeight: number;
  classMaskWidth: number;
  classMaskHeight: number;
  hasCellIdMask?: boolean;
  cellIdMaskWidth?: number;
  cellIdMaskHeight?: number;
  maskEncoding?: string;
}

export interface ClassPixelStat {
  pixelCount: number;
  percentage: number;
}

export const DEFAULT_SEMANTIC_CLASSES: SemanticClassEntry[] = [
  {
    id: 0,
    name: 'Background',
    key: 'background',
    color: '#64748b',
    rgb: { r: 100, g: 116, b: 139 },
    isBackground: true,
    isWall: false,
    defaultVisible: false,
  },
  {
    id: 1,
    name: 'Cell Wall',
    key: 'cell-wall',
    color: '#f59e0b',
    rgb: { r: 245, g: 158, b: 11 },
    isBackground: false,
    isWall: true,
    defaultVisible: true,
  },
  {
    id: 2,
    name: 'Cytoplasm',
    key: 'cytoplasm',
    color: '#10b981',
    rgb: { r: 16, g: 185, b: 129 },
    isBackground: false,
    isWall: false,
    defaultVisible: true,
  },
  {
    id: 3,
    name: 'Nucleus',
    key: 'nucleus',
    color: '#8b5cf6',
    rgb: { r: 139, g: 92, b: 246 },
    isBackground: false,
    isWall: false,
    defaultVisible: true,
  },
];

const FALLBACK_EXTRA_CLASS_COLORS: Array<{ color: string; rgb: { r: number; g: number; b: number } }> = [
  { color: '#06b6d4', rgb: { r: 6, g: 182, b: 212 } },
  { color: '#ec4899', rgb: { r: 236, g: 72, b: 153 } },
  { color: '#eab308', rgb: { r: 234, g: 179, b: 8 } },
  { color: '#f97316', rgb: { r: 249, g: 115, b: 22 } },
];

export function parseHexColor(hex?: string): { r: number; g: number; b: number } | null {
  if (!hex || typeof hex !== 'string') return null;
  const cleaned = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return {
      r: parseInt(cleaned.slice(0, 2), 16),
      g: parseInt(cleaned.slice(2, 4), 16),
      b: parseInt(cleaned.slice(4, 6), 16),
    };
  }
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return {
      r: parseInt(cleaned[0] + cleaned[0], 16),
      g: parseInt(cleaned[1] + cleaned[1], 16),
      b: parseInt(cleaned[2] + cleaned[2], 16),
    };
  }
  return null;
}

function normalizeSemanticClassEntry(
  id: number,
  rawName: string,
  opts?: { color?: string; isWall?: boolean; isBackground?: boolean }
): SemanticClassEntry {
  const normalized = rawName.trim().toLowerCase().replace(/[_-]+/g, ' ');
  let key: SemanticClassEntry['key'] = 'other';
  let displayName = rawName.trim();
  let defaultColor = FALLBACK_EXTRA_CLASS_COLORS[id % FALLBACK_EXTRA_CLASS_COLORS.length].color;
  let defaultRgb = FALLBACK_EXTRA_CLASS_COLORS[id % FALLBACK_EXTRA_CLASS_COLORS.length].rgb;
  let isBackground = opts?.isBackground ?? false;
  let isWall = opts?.isWall ?? false;
  let defaultVisible = true;

  if (normalized === 'background' || normalized === 'bg' || (id === 0 && !rawName.trim())) {
    key = 'background';
    displayName = 'Background';
    defaultColor = '#64748b';
    defaultRgb = { r: 100, g: 116, b: 139 };
    isBackground = true;
    isWall = false;
    defaultVisible = false;
  } else if (normalized.includes('cell wall') || normalized === 'wall') {
    key = 'cell-wall';
    displayName = 'Cell Wall';
    defaultColor = '#f59e0b';
    defaultRgb = { r: 245, g: 158, b: 11 };
    isWall = true;
  } else if (normalized.includes('cytoplasm')) {
    key = 'cytoplasm';
    displayName = 'Cytoplasm';
    defaultColor = '#10b981';
    defaultRgb = { r: 16, g: 185, b: 129 };
  } else if (normalized.includes('nucleus') || normalized.includes('nuclei')) {
    key = 'nucleus';
    displayName = 'Nucleus';
    defaultColor = '#8b5cf6';
    defaultRgb = { r: 139, g: 92, b: 246 };
  } else if (normalized.includes('boundary')) {
    isWall = true;
  }

  const parsedRgb = parseHexColor(opts?.color);
  return {
    id,
    name: displayName || `Class #${id}`,
    key,
    color: parsedRgb && opts?.color ? opts.color : defaultColor,
    rgb: parsedRgb || defaultRgb,
    isBackground,
    isWall,
    defaultVisible,
  };
}

/**
 * Resolves the semantic class legend from backend inference metadata.
 * Respects metadata.classes, metadata.classMap, metadata.labelMap, or metadata.classNames when present;
 * falls back to the 4 canonical semantic classes (background, cell wall, cytoplasm, nucleus) otherwise.
 * Never invents biological names for unexpected class IDs present in classData.
 */
export function resolveSemanticClasses(
  metadata?: InferenceJobResponse['metadata'],
  classData?: Uint8Array
): SemanticClassEntry[] {
  const byId = new Map<number, SemanticClassEntry>();

  if (metadata?.classes && Array.isArray(metadata.classes) && metadata.classes.length > 0) {
    for (const c of metadata.classes) {
      if (typeof c.id === 'number' && Number.isInteger(c.id)) {
        byId.set(
          c.id,
          normalizeSemanticClassEntry(c.id, c.name || `Class #${c.id}`, {
            color: c.color,
            isWall: c.isWall,
            isBackground: c.isBackground,
          })
        );
      }
    }
  } else if (metadata?.classMap && typeof metadata.classMap === 'object') {
    for (const [k, v] of Object.entries(metadata.classMap)) {
      const id = Number(k);
      if (!Number.isInteger(id)) continue;
      if (typeof v === 'string') {
        byId.set(id, normalizeSemanticClassEntry(id, v));
      } else if (v && typeof v === 'object') {
        byId.set(
          id,
          normalizeSemanticClassEntry(typeof v.id === 'number' ? v.id : id, v.name || `Class #${id}`, {
            color: v.color,
            isWall: v.isWall,
            isBackground: v.isBackground,
          })
        );
      }
    }
  } else if (metadata?.labelMap && typeof metadata.labelMap === 'object') {
    for (const [k, v] of Object.entries(metadata.labelMap)) {
      const id = Number(k);
      if (!Number.isInteger(id) || typeof v !== 'string') continue;
      byId.set(id, normalizeSemanticClassEntry(id, v));
    }
  } else if (metadata?.classNames && Array.isArray(metadata.classNames) && metadata.classNames.length > 0) {
    metadata.classNames.forEach((name, idx) => {
      if (typeof name === 'string') {
        byId.set(idx, normalizeSemanticClassEntry(idx, name));
      }
    });
  }

  // If backend metadata did not enumerate classes, use canonical 4-class semantic legend
  if (byId.size === 0) {
    for (const def of DEFAULT_SEMANTIC_CLASSES) {
      byId.set(def.id, { ...def });
    }
  }

  // If actual decoded classData contains any undeclared class ID, report it truthfully as "Class #<id>"
  if (classData) {
    for (let i = 0; i < classData.length; i++) {
      const cid = classData[i];
      if (!byId.has(cid)) {
        const fallback = FALLBACK_EXTRA_CLASS_COLORS[cid % FALLBACK_EXTRA_CLASS_COLORS.length];
        byId.set(cid, {
          id: cid,
          name: `Class #${cid}`,
          key: 'other',
          color: fallback.color,
          rgb: fallback.rgb,
          isBackground: false,
          isWall: false,
          defaultVisible: true,
        });
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

/**
 * Computes truthful pixel counts and area percentages for every class ID in a decoded class mask.
 */
export function computeClassPixelStats(mask: LoadedMaskData): Record<number, ClassPixelStat> {
  const counts = new Map<number, number>();
  const total = mask.classData.length;

  for (let i = 0; i < total; i++) {
    const cid = mask.classData[i];
    counts.set(cid, (counts.get(cid) || 0) + 1);
  }

  const stats: Record<number, ClassPixelStat> = {};
  counts.forEach((pixelCount, cid) => {
    stats[cid] = {
      pixelCount,
      percentage: total > 0 ? (pixelCount / total) * 100 : 0,
    };
  });

  return stats;
}

/**
 * Extracts an approximate 4-connected region of pixels matching the clicked semantic class.
 * Returns null if the clicked pixel is background or out of bounds.
 * NOTE: In a semantic class mask without cell IDs, a connected region is an approximation
 * and does NOT represent a verified individual cell or one cell's complete border.
 */
export function extractConnectedRegion(
  mask: LoadedMaskData,
  startX: number,
  startY: number,
  isBackgroundClass: (classId: number) => boolean = (cid) => cid === 0
): ApproximateConnectedRegion | null {
  const { width, height, classData } = mask;
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) {
    return null;
  }

  const seedIdx = startY * width + startX;
  const targetClass = classData[seedIdx];
  if (isBackgroundClass(targetClass)) {
    return null;
  }

  const totalPixels = width * height;
  const regionMask = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);

  let head = 0;
  let tail = 0;
  regionMask[seedIdx] = 1;
  queue[tail++] = seedIdx;

  let pixelCount = 0;
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  let touchesEdge = false;

  while (head < tail) {
    const idx = queue[head++];
    pixelCount++;

    const x = idx % width;
    const y = (idx - x) / width;

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
      touchesEdge = true;
    }

    // 4-connected neighbors
    if (x > 0) {
      const nIdx = idx - 1;
      if (regionMask[nIdx] === 0 && classData[nIdx] === targetClass) {
        regionMask[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
    if (x + 1 < width) {
      const nIdx = idx + 1;
      if (regionMask[nIdx] === 0 && classData[nIdx] === targetClass) {
        regionMask[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
    if (y > 0) {
      const nIdx = idx - width;
      if (regionMask[nIdx] === 0 && classData[nIdx] === targetClass) {
        regionMask[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
    if (y + 1 < height) {
      const nIdx = idx + width;
      if (regionMask[nIdx] === 0 && classData[nIdx] === targetClass) {
        regionMask[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
  }

  return {
    classId: targetClass,
    seedX: startX,
    seedY: startY,
    pixelCount,
    touchesEdge,
    bounds: { minX, minY, maxX, maxY },
    regionMask,
  };
}

/**
 * Computes exact letterboxed or pillarboxed image rectangle within a container element
 * when styled with object-fit: contain.
 */
export function computeContainedImageRect(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number
): ContainedRect {
  if (containerWidth <= 0 || containerHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const containerAspect = containerWidth / containerHeight;
  const imageAspect = imageWidth / imageHeight;

  let width = containerWidth;
  let height = containerHeight;
  let left = 0;
  let top = 0;

  if (containerAspect > imageAspect) {
    // Pillarboxed (letterbox padding on left and right)
    height = containerHeight;
    width = containerHeight * imageAspect;
    left = (containerWidth - width) / 2;
    top = 0;
  } else {
    // Letterboxed (padding on top and bottom)
    width = containerWidth;
    height = containerWidth / imageAspect;
    left = 0;
    top = (containerHeight - height) / 2;
  }

  return { left, top, width, height };
}

/**
 * Validates mask dimensions and frame identity before producing any selections.
 * Silent resizing or mismatched frame IDs are strictly rejected.
 */
export function validateMaskMetadata(
  params: MaskValidationParams
): { isValid: boolean; error?: string } {
  if (params.actualFrameId !== params.expectedFrameId) {
    return {
      isValid: false,
      error: `Frame identity mismatch: mask belongs to frame "${params.actualFrameId}", but active frame is "${params.expectedFrameId}". Stale mask rejected.`,
    };
  }

  if (
    params.classMaskWidth !== params.expectedWidth ||
    params.classMaskHeight !== params.expectedHeight
  ) {
    return {
      isValid: false,
      error: `Class mask dimensions (${params.classMaskWidth}x${params.classMaskHeight}) do not match model declared dimensions (${params.expectedWidth}x${params.expectedHeight}). Silent resizing is rejected.`,
    };
  }

  const expectsCellIdMask =
    params.hasCellIdMask === true ||
    params.cellIdMaskWidth !== undefined ||
    params.cellIdMaskHeight !== undefined;

  if (expectsCellIdMask) {
    if (
      params.cellIdMaskWidth === undefined ||
      params.cellIdMaskHeight === undefined
    ) {
      return {
        isValid: false,
        error: 'Missing cell-ID mask dimensions in metadata for provided cell-ID mask.',
      };
    }

    if (
      params.cellIdMaskWidth !== params.classMaskWidth ||
      params.cellIdMaskHeight !== params.classMaskHeight
    ) {
      return {
        isValid: false,
        error: `Cell ID mask dimensions (${params.cellIdMaskWidth}x${params.cellIdMaskHeight}) do not match Class mask dimensions (${params.classMaskWidth}x${params.classMaskHeight}). Silent mask resizing is rejected.`,
      };
    }
  }

  const supportedEncodings = [
    'raw-uint8',
    'raw-uint16-le',
    'raw-uint16-be',
    'raw-uint16',
    'raw-uint32-le',
    'raw-uint32-be',
    'raw-uint32',
    'png',
    'indexed-png',
    'grayscale-png',
    'png-lossless',
    'buffer',
  ];

  if (params.maskEncoding && !supportedEncodings.includes(params.maskEncoding.toLowerCase())) {
    return {
      isValid: false,
      error: `Unsupported mask encoding format "${params.maskEncoding}". Cannot decode raw integer label values without loss. Supported encodings: ${supportedEncodings.join(', ')}`,
    };
  }

  return { isValid: true };
}

/**
 * Checks whether an ArrayBuffer starts with the standard 8-byte PNG signature:
 * [137, 80, 78, 71, 13, 10, 26, 10]
 */
export function isPngSignature(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 8) return false;
  const header = new Uint8Array(buffer, 0, 8);
  return (
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  );
}

/**
 * Losslessly decodes an 8-bit or 16-bit Grayscale or Indexed PNG mask without browser
 * canvas color conversion. Unfilters scanlines to preserve raw integer label values.
 */
export async function decodeLosslessPng(
  buffer: ArrayBuffer,
  expectedWidth: number,
  expectedHeight: number
): Promise<{ width: number; height: number; bitDepth: number; data: Uint8Array | Uint16Array }> {
  if (!isPngSignature(buffer)) {
    throw new Error('Data does not start with valid PNG header signature.');
  }

  const view = new DataView(buffer);
  let offset = 8;
  let ihdrFound = false;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Uint8Array[] = [];

  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, false);
    const chunkType = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    );
    offset += 8;

    if (chunkType === 'IHDR') {
      width = view.getUint32(offset, false);
      height = view.getUint32(offset + 4, false);
      bitDepth = view.getUint8(offset + 8);
      colorType = view.getUint8(offset + 9);
      const compression = view.getUint8(offset + 10);
      const filter = view.getUint8(offset + 11);
      const interlace = view.getUint8(offset + 12);

      if (compression !== 0 || filter !== 0) {
        throw new Error('Unsupported PNG compression or filter method in label mask.');
      }
      if (interlace !== 0) {
        throw new Error('Interlaced PNG masks are not supported for raw label decoding.');
      }
      // Color type 0 = grayscale, 3 = indexed palette
      if (colorType !== 0 && colorType !== 3) {
        throw new Error(`Unsupported PNG color type ${colorType} for label mask. Expected 0 (grayscale) or 3 (indexed).`);
      }
      if (bitDepth !== 8 && bitDepth !== 16) {
        throw new Error(`Unsupported PNG bit depth ${bitDepth}. Expected 8 or 16.`);
      }
      ihdrFound = true;
    } else if (chunkType === 'IDAT') {
      idatChunks.push(new Uint8Array(buffer, offset, chunkLength));
    } else if (chunkType === 'IEND') {
      break;
    }

    offset += chunkLength + 4; // skip chunk data and 4-byte CRC
  }

  if (!ihdrFound) {
    throw new Error('Missing IHDR chunk in PNG mask.');
  }

  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `PNG mask dimensions (${width}x${height}) do not match expected dimensions (${expectedWidth}x${expectedHeight}). Silent resizing rejected.`
    );
  }

  // Concatenate all IDAT chunks
  let totalIdatBytes = 0;
  for (const c of idatChunks) totalIdatBytes += c.byteLength;
  const combinedIdat = new Uint8Array(totalIdatBytes);
  let idatPos = 0;
  for (const c of idatChunks) {
    combinedIdat.set(c, idatPos);
    idatPos += c.byteLength;
  }

  // Decompress zlib stream using standard DecompressionStream('deflate')
  let uncompressedBytes: Uint8Array;
  try {
    const ds = new DecompressionStream('deflate');
    const decompressedStream = new Response(
      new Blob([combinedIdat]).stream().pipeThrough(ds)
    );
    const decompressedBuffer = await decompressedStream.arrayBuffer();
    uncompressedBytes = new Uint8Array(decompressedBuffer);
  } catch (decompErr: any) {
    throw new Error(`Failed to decompress PNG IDAT stream: ${decompErr?.message || decompErr}`);
  }

  const bytesPerPixel = bitDepth === 16 ? 2 : 1;
  const rowBytes = width * bytesPerPixel;
  const expectedScanlineLength = 1 + rowBytes; // 1 filter byte + rowBytes
  const expectedTotalBytes = expectedScanlineLength * height;

  if (uncompressedBytes.byteLength < expectedTotalBytes) {
    throw new Error(
      `Decompressed PNG byte length (${uncompressedBytes.byteLength}) is less than expected scanline size (${expectedTotalBytes}).`
    );
  }

  // Unfilter PNG scanlines losslessly
  const totalPixels = width * height;
  const result8 = bitDepth === 8 ? new Uint8Array(totalPixels) : null;
  const result16 = bitDepth === 16 ? new Uint16Array(totalPixels) : null;

  const prevRow = new Uint8Array(rowBytes);
  const currentRow = new Uint8Array(rowBytes);

  function paethPredictor(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  let inOffset = 0;
  for (let y = 0; y < height; y++) {
    const filterType = uncompressedBytes[inOffset++];

    for (let i = 0; i < rowBytes; i++) {
      const raw = uncompressedBytes[inOffset++];
      const left = i >= bytesPerPixel ? currentRow[i - bytesPerPixel] : 0;
      const up = prevRow[i];
      const upLeft = i >= bytesPerPixel ? prevRow[i - bytesPerPixel] : 0;

      let val = raw;
      switch (filterType) {
        case 0: // None
          val = raw;
          break;
        case 1: // Sub
          val = (raw + left) & 0xff;
          break;
        case 2: // Up
          val = (raw + up) & 0xff;
          break;
        case 3: // Average
          val = (raw + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4: // Paeth
          val = (raw + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG scanline filter type: ${filterType}`);
      }

      currentRow[i] = val;
    }

    // Copy currentRow into result
    if (bitDepth === 8 && result8) {
      const rowStart = y * width;
      for (let x = 0; x < width; x++) {
        result8[rowStart + x] = currentRow[x];
      }
    } else if (bitDepth === 16 && result16) {
      const rowStart = y * width;
      for (let x = 0; x < width; x++) {
        // Big-endian 16-bit
        result16[rowStart + x] = (currentRow[x * 2] << 8) | currentRow[x * 2 + 1];
      }
    }

    prevRow.set(currentRow);
  }

  return {
    width,
    height,
    bitDepth,
    data: (bitDepth === 16 ? result16 : result8)!,
  };
}

/**
 * Decodes raw integer label masks from ArrayBuffers or direct binary endpoints
 * without passing through browser canvas 2D sRGB color conversion.
 */
export async function loadLosslessMasks(params: {
  frameId: string;
  classMaskBufferOrUrl: ArrayBuffer | string;
  cellIdMaskBufferOrUrl?: ArrayBuffer | string | null;
  width: number;
  height: number;
  maskEncoding?: string;
  classMaskEncoding?: string;
  cellIdMaskEncoding?: string;
  ociApiBaseUrl?: string;
}): Promise<LoadedMaskData> {
  const { frameId, width, height } = params;
  const apiBaseUrl = params.ociApiBaseUrl ?? MICROSCOPE_CONFIG.ociApiBaseUrl;
  const rawDeclaredClassEncoding = (params.classMaskEncoding || params.maskEncoding)?.toLowerCase();
  const rawDeclaredCellIdEncoding = (params.cellIdMaskEncoding || params.maskEncoding)?.toLowerCase();
  const declaredClassEncoding = rawDeclaredClassEncoding || 'auto';
  const declaredCellIdEncoding = rawDeclaredCellIdEncoding || 'auto';

  // 1. Fetch Class Mask Buffer (resolve relative OCI paths against OCI host; always use normal CORS)
  let classBuffer: ArrayBuffer;
  let fetchedClassContentType = '';
  if (typeof params.classMaskBufferOrUrl === 'string') {
    const resolvedClassUrl = resolveOciResourceUrl(params.classMaskBufferOrUrl, apiBaseUrl);
    let res: Response;
    try {
      res = await fetch(resolvedClassUrl, { method: 'GET', mode: 'cors' });
    } catch (fetchErr: any) {
      throw new Error(
        `Unable to fetch semantic class mask from ${resolvedClassUrl} due to a network or CORS error (${fetchErr?.message || 'Failed to fetch'}). Ensure the OCI backend allows CORS requests from this origin.`
      );
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch class mask (${resolvedClassUrl}): HTTP ${res.status} ${res.statusText}`);
    }
    fetchedClassContentType = (res.headers.get('content-type') || '').toLowerCase();
    classBuffer = await res.arrayBuffer();
  } else {
    classBuffer = params.classMaskBufferOrUrl;
  }

  const expectedPixels = width * height;
  let classData: Uint8Array;

  const isPngClass = isPngSignature(classBuffer);

  // If buffer is PNG:
  if (isPngClass) {
    if (rawDeclaredClassEncoding && rawDeclaredClassEncoding.startsWith('raw-')) {
      throw new Error(
        `Class mask buffer contains compressed PNG file data, but encoding was declared as "${rawDeclaredClassEncoding}". Decoding compressed bytes as raw pixels would corrupt class label integers. Declare encoding as "indexed-png" or "grayscale-png".`
      );
    }
    const decodedPng = await decodeLosslessPng(classBuffer, width, height);
    if (decodedPng.bitDepth === 8) {
      classData = decodedPng.data as Uint8Array;
    } else {
      // 16-bit to 8-bit check
      const u8 = new Uint8Array(expectedPixels);
      const u16 = decodedPng.data as Uint16Array;
      for (let i = 0; i < expectedPixels; i++) u8[i] = u16[i] & 0xff;
      classData = u8;
    }
  } else {
    // Raw binary buffer
    if (rawDeclaredClassEncoding && rawDeclaredClassEncoding.includes('png')) {
      throw new Error(
        `Class mask encoding was declared as "${rawDeclaredClassEncoding}", but buffer does not contain a valid PNG signature.`
      );
    }
    if (
      fetchedClassContentType &&
      (fetchedClassContentType.includes('text/html') ||
        fetchedClassContentType.includes('application/json') ||
        fetchedClassContentType.includes('image/jpeg'))
    ) {
      throw new Error(
        `Class mask endpoint returned unexpected content type "${fetchedClassContentType}" instead of a lossless PNG or raw integer label mask.`
      );
    }
    if (classBuffer.byteLength >= expectedPixels) {
      classData = new Uint8Array(classBuffer, 0, expectedPixels);
    } else {
      throw new Error(
        `Class mask buffer length (${classBuffer.byteLength} bytes) is insufficient for declared resolution ${width}x${height} (${expectedPixels} pixels). Mask decoding rejected.`
      );
    }
  }

  // 2. Fetch and Decode Optional Cell-ID Mask
  // Semantic-only segmentation responses omit cellIdMaskUrl; never invent fake cell IDs.
  if (!params.cellIdMaskBufferOrUrl) {
    return {
      frameId,
      width,
      height,
      classData,
      cellIdData: null,
      hasCellIdMask: false,
      maskEncoding: isPngClass ? 'grayscale-png' : declaredClassEncoding === 'auto' ? 'raw-uint8' : declaredClassEncoding,
      getClassAt: (x: number, y: number) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return 0;
        return classData[y * width + x];
      },
      getCellIdAt: () => null,
    };
  }

  let cellBuffer: ArrayBuffer;
  if (typeof params.cellIdMaskBufferOrUrl === 'string') {
    const resolvedCellUrl = resolveOciResourceUrl(params.cellIdMaskBufferOrUrl, apiBaseUrl);
    const res = await fetch(resolvedCellUrl, { method: 'GET', mode: 'cors' });
    if (!res.ok) {
      throw new Error(`Failed to fetch cell-ID mask (${resolvedCellUrl}): HTTP ${res.status} ${res.statusText}`);
    }
    cellBuffer = await res.arrayBuffer();
  } else {
    cellBuffer = params.cellIdMaskBufferOrUrl;
  }

  let cellIdData: Uint32Array | Uint16Array;
  const isPngCell = isPngSignature(cellBuffer);

  if (isPngCell) {
    if (rawDeclaredCellIdEncoding && rawDeclaredCellIdEncoding.startsWith('raw-')) {
      throw new Error(
        `Cell-ID mask buffer contains compressed PNG file data, but encoding was declared as "${rawDeclaredCellIdEncoding}". Declare encoding as "grayscale-png".`
      );
    }
    const decodedCellPng = await decodeLosslessPng(cellBuffer, width, height);
    if (decodedCellPng.bitDepth === 16) {
      cellIdData = decodedCellPng.data as Uint16Array;
    } else {
      const u32 = new Uint32Array(expectedPixels);
      const u8 = decodedCellPng.data as Uint8Array;
      for (let i = 0; i < expectedPixels; i++) u32[i] = u8[i];
      cellIdData = u32;
    }
  } else {
    if (rawDeclaredCellIdEncoding && rawDeclaredCellIdEncoding.includes('png')) {
      throw new Error(
        `Cell-ID mask encoding was declared as "${rawDeclaredCellIdEncoding}", but buffer does not contain a valid PNG signature.`
      );
    }
    // Decode based on explicit encoding / endianness metadata (do NOT guess from buffer size alone)
    if (declaredCellIdEncoding === 'raw-uint32-le' || declaredCellIdEncoding === 'raw-uint32') {
      if (cellBuffer.byteLength < expectedPixels * 4) {
        throw new Error(
          `Cell-ID mask buffer length (${cellBuffer.byteLength} bytes) is insufficient for declared 32-bit resolution ${width}x${height} (${expectedPixels * 4} bytes required).`
        );
      }
      cellIdData = new Uint32Array(cellBuffer, 0, expectedPixels);
    } else if (declaredCellIdEncoding === 'raw-uint32-be') {
      if (cellBuffer.byteLength < expectedPixels * 4) {
        throw new Error(
          `Cell-ID mask buffer length (${cellBuffer.byteLength} bytes) is insufficient for declared 32-bit resolution ${width}x${height}.`
        );
      }
      const dv = new DataView(cellBuffer);
      const u32 = new Uint32Array(expectedPixels);
      for (let i = 0; i < expectedPixels; i++) {
        u32[i] = dv.getUint32(i * 4, false); // false = big-endian
      }
      cellIdData = u32;
    } else if (declaredCellIdEncoding === 'raw-uint16-be') {
      if (cellBuffer.byteLength < expectedPixels * 2) {
        throw new Error(
          `Cell-ID mask buffer length (${cellBuffer.byteLength} bytes) is insufficient for declared 16-bit resolution ${width}x${height}.`
        );
      }
      const dv = new DataView(cellBuffer);
      const u16 = new Uint16Array(expectedPixels);
      for (let i = 0; i < expectedPixels; i++) {
        u16[i] = dv.getUint16(i * 2, false); // false = big-endian
      }
      cellIdData = u16;
    } else if (declaredCellIdEncoding === 'raw-uint16-le' || declaredCellIdEncoding === 'raw-uint16') {
      if (cellBuffer.byteLength < expectedPixels * 2) {
        throw new Error(
          `Cell-ID mask buffer length (${cellBuffer.byteLength} bytes) is insufficient for declared 16-bit resolution ${width}x${height}.`
        );
      }
      cellIdData = new Uint16Array(cellBuffer, 0, expectedPixels);
    } else if (declaredCellIdEncoding === 'raw-uint8') {
      if (cellBuffer.byteLength < expectedPixels) {
        throw new Error(
          `Cell-ID mask buffer length (${cellBuffer.byteLength} bytes) is insufficient for declared 8-bit resolution ${width}x${height}.`
        );
      }
      const u8 = new Uint8Array(cellBuffer, 0, expectedPixels);
      const u32 = new Uint32Array(expectedPixels);
      for (let i = 0; i < expectedPixels; i++) u32[i] = u8[i];
      cellIdData = u32;
    } else {
      throw new Error(
        `Cell-ID mask raw buffer requires explicit encoding metadata (raw-uint8, raw-uint16-le/be, or raw-uint32-le/be). Received "${declaredCellIdEncoding}".`
      );
    }
  }

  return {
    frameId,
    width,
    height,
    classData,
    cellIdData,
    hasCellIdMask: true,
    maskEncoding: isPngClass ? 'indexed-png' : declaredClassEncoding === 'auto' ? 'raw-uint8' : declaredClassEncoding,
    getClassAt: (x: number, y: number) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return 0;
      return classData[y * width + x];
    },
    getCellIdAt: (x: number, y: number) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return 0;
      return cellIdData[y * width + x];
    },
  };
}

/**
 * Maps screen coordinates (clientX, clientY) on an HTML element to exact mask pixel coordinates.
 * Accurately calculates actual rendered image bounds under object-fit: contain (letterbox / pillarbox).
 *
 * STRICT RULE: A click outside the displayed image bounds returns null and is NOT clamped to edge pixels.
 */
export function mapScreenToMaskCoords(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  maskWidth: number,
  maskHeight: number,
  objectFit: 'contain' | 'cover' | 'fill' = 'contain'
): { maskX: number; maskY: number } | null {
  if (
    containerRect.width <= 0 ||
    containerRect.height <= 0 ||
    maskWidth <= 0 ||
    maskHeight <= 0
  ) {
    return null;
  }

  // Check if click is outside the bounding box of the container element
  if (
    clientX < containerRect.left ||
    clientX > containerRect.right ||
    clientY < containerRect.top ||
    clientY > containerRect.bottom
  ) {
    return null;
  }

  const rect = computeContainedImageRect(
    containerRect.width,
    containerRect.height,
    maskWidth,
    maskHeight
  );

  const imageLeft = containerRect.left + rect.left;
  const imageTop = containerRect.top + rect.top;
  const imageRight = imageLeft + rect.width;
  const imageBottom = imageTop + rect.height;

  // STRICT REQUIREMENT: If click is in the letterbox/pillarbox area outside the rendered image,
  // do NOT clamp! Return null to indicate out-of-bounds click.
  if (
    clientX < imageLeft ||
    clientX >= imageRight ||
    clientY < imageTop ||
    clientY >= imageBottom
  ) {
    return null;
  }

  const relX = (clientX - imageLeft) / rect.width;
  const relY = (clientY - imageTop) / rect.height;

  const maskX = Math.floor(relX * maskWidth);
  const maskY = Math.floor(relY * maskHeight);

  if (maskX < 0 || maskX >= maskWidth || maskY < 0 || maskY >= maskHeight) {
    return null;
  }

  return { maskX, maskY };
}

/**
 * Evaluates clicked pixel against model class and instance maps.
 * Handles:
 * 1. Shared cell walls: identifies neighboring candidate cells
 * 2. Field edge clipping: detects if boundary touches image borders
 * 3. Dynamic model class metadata: no hardcoded class IDs
 */
export function queryMaskPixel(
  mask: LoadedMaskData,
  maskX: number,
  maskY: number,
  structures: DetectedStructure[],
  classDefinitions?: ModelClassDefinition[],
  wallAssociations?: Record<string, { wallClassId: number; cellIds: number[] }>
): MaskClickResult {
  const classId = mask.getClassAt(maskX, maskY);
  const cellId = mask.hasCellIdMask ? mask.getCellIdAt(maskX, maskY) : null;

  // Check if pixel is at the image border (clipped / partial boundary)
  const isClippedBoundary =
    maskX <= 2 || maskX >= mask.width - 3 || maskY <= 2 || maskY >= mask.height - 3;

  // Semantic-only mode (no cellIdMask): do NOT invent cell IDs or shared-wall candidate cells.
  if (!mask.hasCellIdMask) {
    const matched = classId !== 0 ? structures.find((s) => s.classId === classId) || null : null;
    return {
      maskX,
      maskY,
      classId,
      cellId: null,
      hasCellIdMask: false,
      structure: matched,
      isSharedWall: false,
      candidateCellIds: undefined,
      isClippedBoundary,
    };
  }

  // Determine whether this class represents a wall or boundary from model metadata
  const classDef = classDefinitions?.find((c) => c.id === classId);
  const isWallClass =
    classDef?.isWall ??
    (classDef?.name.toLowerCase().includes('wall') ||
      classDef?.name.toLowerCase().includes('boundary') ||
      structures.some((s) => s.classId === classId && (s.isWall || s.name.toLowerCase().includes('wall'))));

  // Shared wall detection: if clicking a wall, check association metadata first, then neighborhood
  let isSharedWall = false;
  let candidateCellIds: number[] = [];

  if (isWallClass) {
    // 1. Check if model response provides declared association metadata for this wall class or cell
    const declaredWallAssoc = wallAssociations
      ? Object.values(wallAssociations).find((w) => w.wallClassId === classId)
      : undefined;

    const declaredStructure = structures.find(
      (s) =>
        s.classId === classId &&
        ((s.candidateSharedCells && s.candidateSharedCells.length > 0) ||
          (s.associatedCellIds && s.associatedCellIds.length > 0))
    );

    if (declaredWallAssoc && declaredWallAssoc.cellIds.length > 1) {
      isSharedWall = true;
      candidateCellIds = [...declaredWallAssoc.cellIds].sort((a, b) => a - b);
    } else if (declaredStructure?.candidateSharedCells && declaredStructure.candidateSharedCells.length > 1) {
      isSharedWall = true;
      candidateCellIds = [...declaredStructure.candidateSharedCells].sort((a, b) => a - b);
    } else if (declaredStructure?.associatedCellIds && declaredStructure.associatedCellIds.length > 1) {
      isSharedWall = true;
      candidateCellIds = [...declaredStructure.associatedCellIds].sort((a, b) => a - b);
    } else {
      // 2. Fallback to pixel neighborhood inspection when association metadata is not declared
      const neighborCellIds = new Set<number>();
      const radius = 5;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = maskX + dx;
          const ny = maskY + dy;
          const neighborId = mask.getCellIdAt(nx, ny);
          if (neighborId !== null && neighborId > 0) {
            neighborCellIds.add(neighborId);
          }
        }
      }

      if (neighborCellIds.size > 1) {
        isSharedWall = true;
        candidateCellIds = Array.from(neighborCellIds).sort((a, b) => a - b);
      }
    }
  }

  // Find structure metadata matching the queried class or cell
  let matched = structures.find(
    (s) => s.classId === classId && (cellId === null || cellId === 0 || !s.cellId || s.cellId === cellId)
  );

  if (!matched && classId !== 0) {
    matched = structures.find((s) => s.classId === classId);
  }

  return {
    maskX,
    maskY,
    classId,
    cellId,
    hasCellIdMask: true,
    structure: matched || null,
    isSharedWall,
    candidateCellIds: candidateCellIds.length > 0 ? candidateCellIds : undefined,
    isClippedBoundary,
  };
}

/**
 * Renders semi-transparent semantic class-mask overlays onto the aligned canvas
 * while keeping the original captured micrograph clearly visible underneath.
 * Optionally highlights an approximate 4-connected region and clicked reticle point.
 */
export function renderSemanticClassOverlay(params: {
  canvas: HTMLCanvasElement;
  mask: LoadedMaskData;
  semanticClasses: SemanticClassEntry[];
  visibleClassIds: Set<number>;
  connectedRegion?: ApproximateConnectedRegion | null;
  clickedPoint?: { maskX: number; maskY: number } | null;
}): void {
  const {
    canvas,
    mask,
    semanticClasses,
    visibleClassIds,
    connectedRegion = null,
    clickedPoint = null,
  } = params;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height, classData } = mask;
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);

  // Precompute 256-entry RGB + Alpha lookup tables for fast linear pixel rendering
  const lutR = new Uint8Array(256);
  const lutG = new Uint8Array(256);
  const lutB = new Uint8Array(256);
  const lutA = new Uint8Array(256);

  for (const cls of semanticClasses) {
    if (cls.id >= 0 && cls.id < 256) {
      lutR[cls.id] = cls.rgb.r;
      lutG[cls.id] = cls.rgb.g;
      lutB[cls.id] = cls.rgb.b;
      if (visibleClassIds.has(cls.id)) {
        // Keep original captured micrograph clearly visible through semi-transparent tint
        lutA[cls.id] = cls.isBackground ? 72 : cls.isWall ? 120 : 102;
      }
    }
  }

  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;
  const regionMask = connectedRegion?.regionMask || null;
  const regionClassId = connectedRegion?.classId ?? -1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      const pIdx = idx * 4;

      if (regionMask && regionMask[idx] === 1) {
        // Detect 4-connected perimeter of the approximate connected region
        const isEdge =
          x === 0 ||
          x === width - 1 ||
          y === 0 ||
          y === height - 1 ||
          regionMask[idx - 1] === 0 ||
          regionMask[idx + 1] === 0 ||
          regionMask[idx - width] === 0 ||
          regionMask[idx + width] === 0;

        if (isEdge) {
          // Crisp bright outline around approximate connected region
          data[pIdx] = 255;
          data[pIdx + 1] = 255;
          data[pIdx + 2] = 255;
          data[pIdx + 3] = 235;
        } else {
          data[pIdx] = lutR[regionClassId] || 74;
          data[pIdx + 1] = lutG[regionClassId] || 222;
          data[pIdx + 2] = lutB[regionClassId] || 128;
          data[pIdx + 3] = 155;
        }
        continue;
      }

      const cid = classData[idx];
      const alpha = lutA[cid];
      if (alpha > 0) {
        data[pIdx] = lutR[cid];
        data[pIdx + 1] = lutG[cid];
        data[pIdx + 2] = lutB[cid];
        data[pIdx + 3] = alpha;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Draw crisp reticle crosshair at clicked mask coordinates
  if (clickedPoint) {
    const { maskX, maskY } = clickedPoint;
    const radius = Math.max(2, Math.min(8, Math.round(Math.min(width, height) * 0.012)));
    const lineWidth = Math.max(1, radius / 4);

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = lineWidth + 1.5;
    ctx.beginPath();
    ctx.arc(maskX + 0.5, maskY + 0.5, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(maskX + 0.5, maskY + 0.5, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(maskX + 0.5, maskY + 0.5, Math.max(1, lineWidth * 0.65), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Renders high-visibility mask highlight onto overlay canvas (instance + cell-ID mode).
 *
 * STRICT RULES:
 * - A cell-wall selection highlights that cell's visible WALL pixels only; it never fills the cell interior.
 * - Incomplete/edge boundaries highlight supported wall pixels only.
 * - Shared wall disambiguation: when a shared wall click is pending, indicates only the relevant
 *   candidate boundary segment (not every wall of that class across the entire micrograph).
 */
export function renderMaskOverlay(params: {
  canvas: HTMLCanvasElement;
  mask: LoadedMaskData;
  selectedClassId?: number | null;
  selectedCellId?: number | null;
  pendingSharedWall?: {
    candidateCellIds: number[];
    firstClickCoords: { maskX: number; maskY: number };
    wallClassId: number;
  } | null;
  isWallSelection?: boolean;
  highlightColor?: { r: number; g: number; b: number };
}): void {
  const {
    canvas,
    mask,
    selectedClassId,
    selectedCellId,
    pendingSharedWall,
    isWallSelection = false,
    highlightColor,
  } = params;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = mask.width;
  canvas.height = mask.height;
  ctx.clearRect(0, 0, mask.width, mask.height);

  const activeClassId = pendingSharedWall ? pendingSharedWall.wallClassId : selectedClassId;

  if (activeClassId === undefined || activeClassId === null || activeClassId === 0) {
    return;
  }

  const imgData = ctx.createImageData(mask.width, mask.height);
  const data = imgData.data;

  // Use model-declared color if supplied, else sensible fluorescent defaults
  const r = highlightColor?.r ?? (pendingSharedWall ? 245 : isWallSelection ? 250 : 74);
  const g = highlightColor?.g ?? (pendingSharedWall ? 158 : isWallSelection ? 204 : 222);
  const b = highlightColor?.b ?? (pendingSharedWall ? 11 : isWallSelection ? 21 : 128);

  // If pending shared wall: only highlight the relevant candidate boundary segment
  // (within neighborhood of first click and bordering the candidate cells)
  const isPending = !!pendingSharedWall;
  const clickX = pendingSharedWall?.firstClickCoords.maskX ?? 0;
  const clickY = pendingSharedWall?.firstClickCoords.maskY ?? 0;
  const sharedRadiusSq = 45 * 45; // limit highlight to the clicked interface region

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const idx = y * mask.width + x;
      const pixelClass = mask.classData[idx];
      const pixelCell = mask.cellIdData ? mask.cellIdData[idx] : 0;

      let isSelected = false;
      let alpha = 140;

      if (isPending) {
        // Shared wall pending disambiguation:
        // Highlight ONLY the clicked boundary segment bordering the candidate cells
        if (pixelClass === activeClassId) {
          const dx = x - clickX;
          const dy = y - clickY;
          if (dx * dx + dy * dy <= sharedRadiusSq) {
            isSelected = true;
            alpha = 190;
          }
        }
      } else if (isWallSelection) {
        // STRICT REQUIREMENT: Cell-wall selection highlights that cell's visible wall pixels ONLY!
        // Never fill the cell interior.
        if (pixelClass === activeClassId) {
          if (!selectedCellId || selectedCellId === 0 || pixelCell === selectedCellId) {
            isSelected = true;
            alpha = 180;
          }
        }
      } else {
        // Standard organelle selection (e.g. nucleus, vacuole, chloroplast)
        if (pixelClass === activeClassId) {
          if (!selectedCellId || selectedCellId === 0 || pixelCell === selectedCellId) {
            isSelected = true;
            alpha = 130;
          }
        }
      }

      if (isSelected) {
        const pIdx = idx * 4;
        data[pIdx] = r;
        data[pIdx + 1] = g;
        data[pIdx + 2] = b;
        data[pIdx + 3] = alpha;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}
