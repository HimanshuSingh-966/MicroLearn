import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateInferenceResponse,
  formatModelConfidence,
  createLabObservation,
  filterSlides,
} from './microscopeLogic.ts';
import {
  computeContainedImageRect,
  mapScreenToMaskCoords,
  validateMaskMetadata,
  isPngSignature,
  loadLosslessMasks,
  resolveSemanticClasses,
  computeClassPixelStats,
  extractConnectedRegion,
  queryMaskPixel,
} from './maskProcessor.ts';
import type { DetectedStructure, PreparedSlide } from '../types/microscope.ts';
import {
  MICROSCOPE_CONFIG,
  resolveOciApiBaseUrl,
  resolveWebRtcSignalingUrl,
  resolveOciResourceUrl,
  isOciApiConfigured,
  isWebRtcSignalingConfigured,
  evaluateOciHealthPayload,
} from '../config/microscopeConfig.ts';
import {
  MAX_UPLOAD_IMAGE_BYTES,
  validateUploadImageFile,
  formatFileSize,
} from './imageUpload.ts';
import { OciInferenceClient } from '../services/ociInferenceClient.ts';

const mockDetectedStructures: DetectedStructure[] = [
  {
    id: 'struct-1',
    classId: 2,
    name: 'Nucleus',
    category: 'Genetic Compartment',
    confidence: 96.4,
    pixelCount: 1420,
    stainingAffinity: 'Basophilic',
    morphologicalSummary: 'Double-membrane bounded genetic storage.',
    biologicalFunction: 'Regulates gene expression and replication.',
  },
  {
    id: 'struct-2',
    classId: 1,
    cellId: 10,
    name: 'Cell Wall',
    category: 'Structural Boundary',
    confidence: 94.2,
    pixelCount: 3840,
    stainingAffinity: 'Cellulosic',
    morphologicalSummary: 'Rigid outer boundary.',
    biologicalFunction: 'Provides structural rigidity.',
    isWall: true,
  },
];

const mockSlide: PreparedSlide = {
  id: 'test-slide',
  index: 1,
  title: 'Allium Cepa Epidermis',
  shortName: 'Onion Cell',
  scientificName: 'Allium cepa',
  category: 'Plantae',
  magnificationDefault: 40,
  availableMagnifications: [10, 40, 100],
  stain: 'Toluidine Blue',
  imageUrl: '/onion.jpg',
  organelles: mockDetectedStructures,
  specimenNotes: 'Monolayer epidermal peeling.',
  stainingProtocol: 'Aqueous Toluidine Blue 0.1%',
  datePrepared: '2026-11-01',
};

test('validateInferenceResponse rejects null, empty, or missing jobId', () => {
  assert.equal(validateInferenceResponse(null).isValid, false);
  assert.equal(validateInferenceResponse({}).isValid, false);
  assert.equal(validateInferenceResponse({ jobId: '' }).isValid, false);
});

test('validateInferenceResponse rejects mismatched frame IDs to discard stale results', () => {
  const result = validateInferenceResponse(
    { jobId: 'job-123', frameId: 'frame-old', status: 'COMPLETED', detectedStructures: [] },
    'frame-current'
  );
  assert.equal(result.isValid, false);
  assert.match(result.error || '', /Frame ID mismatch/);
});

test('validateInferenceResponse rejects completed response with detections array alone (classMaskUrl required)', () => {
  const result = validateInferenceResponse(
    {
      jobId: 'job-123',
      frameId: 'frame-current',
      status: 'COMPLETED',
      detectedStructures: mockDetectedStructures,
    },
    'frame-current'
  );
  assert.equal(result.isValid, false);
  assert.match(result.error || '', /missing required classMaskUrl/);
});

test('validateInferenceResponse accepts semantic-only response with classMaskUrl and metadata but no cellIdMaskUrl or detectedStructures', () => {
  const semanticOnly = validateInferenceResponse(
    {
      jobId: 'job-sem-1',
      frameId: 'frame-current',
      status: 'COMPLETED',
      classMaskUrl: '/api/masks/class.png',
      metadata: {
        width: 512,
        height: 512,
        maskEncoding: 'grayscale-png',
      },
    },
    'frame-current'
  );
  assert.equal(semanticOnly.isValid, true);

  // Also valid when cellIdMaskUrl is explicitly null
  const semanticNullCellId = validateInferenceResponse(
    {
      jobId: 'job-sem-2',
      frameId: 'frame-current',
      status: 'COMPLETED',
      classMaskUrl: '/api/masks/class.png',
      cellIdMaskUrl: null,
      metadata: {
        width: 512,
        height: 512,
      },
    },
    'frame-current'
  );
  assert.equal(semanticNullCellId.isValid, true);
});

test('validateInferenceResponse accepts completed response with both class and cell-ID masks', () => {
  const result = validateInferenceResponse(
    {
      jobId: 'job-123',
      frameId: 'frame-current',
      status: 'COMPLETED',
      classMaskUrl: '/api/masks/class.raw',
      cellIdMaskUrl: '/api/masks/cellid.raw',
      metadata: {
        width: 1280,
        height: 800,
        maskEncoding: 'raw-uint8',
      },
      detectedStructures: mockDetectedStructures,
    },
    'frame-current'
  );
  assert.equal(result.isValid, true);
});

test('formatModelConfidence formats valid percentages and handles unmeasured states', () => {
  assert.equal(formatModelConfidence(97.34), '97.3%');
  assert.equal(formatModelConfidence(undefined), 'Unmeasured');
  assert.equal(formatModelConfidence(null), 'Unmeasured');
});

test('computeContainedImageRect computes accurate letterbox and pillarbox boundaries', () => {
  const letterbox = computeContainedImageRect(800, 600, 1920, 1080);
  assert.equal(letterbox.left, 0);
  assert.equal(letterbox.width, 800);
  assert.equal(letterbox.height, 450);
  assert.equal(letterbox.top, 75);

  const pillarbox = computeContainedImageRect(1200, 800, 800, 800);
  assert.equal(pillarbox.top, 0);
  assert.equal(pillarbox.height, 800);
  assert.equal(pillarbox.width, 800);
  assert.equal(pillarbox.left, 200);
});

test('mapScreenToMaskCoords correctly maps client clicks to mask pixel dimensions', () => {
  const mockRect = { left: 100, top: 100, width: 800, height: 600, right: 900, bottom: 700 } as DOMRect;

  const center = mapScreenToMaskCoords(500, 400, mockRect, 1920, 1080, 'contain');
  assert.ok(center);
  assert.equal(center?.maskX, 960);
  assert.equal(center?.maskY, 540);

  const letterboxTop = mapScreenToMaskCoords(500, 120, mockRect, 1920, 1080, 'contain');
  assert.equal(letterboxTop, null);

  const oob = mapScreenToMaskCoords(1000, 800, mockRect, 1920, 1080, 'contain');
  assert.equal(oob, null);
});

test('validateMaskMetadata supports semantic-only metadata and still rejects mismatches', () => {
  const frameMismatch = validateMaskMetadata({
    expectedFrameId: 'frame-100',
    actualFrameId: 'frame-099',
    expectedWidth: 1280,
    expectedHeight: 800,
    classMaskWidth: 1280,
    classMaskHeight: 800,
  });
  assert.equal(frameMismatch.isValid, false);
  assert.match(frameMismatch.error || '', /Frame identity mismatch/);

  const dimMismatch = validateMaskMetadata({
    expectedFrameId: 'frame-100',
    actualFrameId: 'frame-100',
    expectedWidth: 1280,
    expectedHeight: 800,
    classMaskWidth: 640,
    classMaskHeight: 480,
  });
  assert.equal(dimMismatch.isValid, false);
  assert.match(dimMismatch.error || '', /Class mask dimensions/);

  // Semantic-only valid metadata (no cellIdMask dimensions)
  const semanticValid = validateMaskMetadata({
    expectedFrameId: 'frame-100',
    actualFrameId: 'frame-100',
    expectedWidth: 512,
    expectedHeight: 512,
    classMaskWidth: 512,
    classMaskHeight: 512,
    hasCellIdMask: false,
    maskEncoding: 'grayscale-png',
  });
  assert.equal(semanticValid.isValid, true);

  // Instance mode with cell-ID dimension mismatch must still fail
  const cellMismatch = validateMaskMetadata({
    expectedFrameId: 'frame-100',
    actualFrameId: 'frame-100',
    expectedWidth: 1280,
    expectedHeight: 800,
    classMaskWidth: 1280,
    classMaskHeight: 800,
    hasCellIdMask: true,
    cellIdMaskWidth: 640,
    cellIdMaskHeight: 400,
  });
  assert.equal(cellMismatch.isValid, false);
  assert.match(cellMismatch.error || '', /Cell ID mask dimensions/);
});

test('isPngSignature correctly identifies PNG header and rejects non-PNG', () => {
  const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]).buffer;
  assert.equal(isPngSignature(pngHeader), true);

  const nonPng = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]).buffer;
  assert.equal(isPngSignature(nonPng), false);
});

test('loadLosslessMasks supports semantic-only class masks without inventing cell IDs', async () => {
  const width = 4;
  const height = 4;
  const classBuf = new Uint8Array([
    0, 1, 1, 0,
    1, 2, 2, 1,
    1, 2, 3, 1,
    0, 1, 1, 0,
  ]);

  const result = await loadLosslessMasks({
    frameId: 'semantic-frame',
    classMaskBufferOrUrl: classBuf.buffer,
    width,
    height,
    classMaskEncoding: 'raw-uint8',
  });

  assert.equal(result.frameId, 'semantic-frame');
  assert.equal(result.hasCellIdMask, false);
  assert.equal(result.cellIdData, null);
  assert.equal(result.getClassAt(2, 2), 3);
  assert.equal(result.getCellIdAt(2, 2), null);

  // Clicking a cell wall pixel in semantic-only mode must NOT invent cell IDs or shared-wall candidates
  const wallClick = queryMaskPixel(result, 1, 0, []);
  assert.equal(wallClick.hasCellIdMask, false);
  assert.equal(wallClick.cellId, null);
  assert.equal(wallClick.isSharedWall, false);
  assert.equal(wallClick.candidateCellIds, undefined);
  assert.equal(wallClick.structure, null);
});

test('loadLosslessMasks decodes raw-uint8 and raw-uint16 buffers losslessly when both masks exist', async () => {
  const width = 4;
  const height = 4;
  const pixels = width * height;

  const classBuf = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) classBuf[i] = i % 5;

  const cellIdBuf = new Uint16Array(pixels);
  for (let i = 0; i < pixels; i++) cellIdBuf[i] = 100 + i;

  const result = await loadLosslessMasks({
    frameId: 'test-frame',
    classMaskBufferOrUrl: classBuf.buffer,
    cellIdMaskBufferOrUrl: cellIdBuf.buffer,
    width,
    height,
    classMaskEncoding: 'raw-uint8',
    cellIdMaskEncoding: 'raw-uint16-le',
  });

  assert.equal(result.frameId, 'test-frame');
  assert.equal(result.hasCellIdMask, true);
  assert.equal(result.width, 4);
  assert.equal(result.height, 4);
  assert.equal(result.getClassAt(1, 1), (1 * 4 + 1) % 5);
  assert.equal(result.getCellIdAt(2, 2), 100 + (2 * 4 + 2));
  assert.equal(result.getClassAt(-1, 0), 0);
});

test('resolveSemanticClasses and computeClassPixelStats resolve canonical and backend-declared classes accurately', async () => {
  const defaults = resolveSemanticClasses(undefined);
  assert.deepEqual(
    defaults.map((c) => c.name),
    ['Background', 'Cell Wall', 'Cytoplasm', 'Nucleus']
  );
  assert.equal(defaults[0].defaultVisible, false);
  assert.equal(defaults[1].isWall, true);
  assert.equal(defaults[1].defaultVisible, true);

  const fromLabelMap = resolveSemanticClasses({
    width: 2,
    height: 2,
    labelMap: { '0': 'background', '1': 'cell_wall', '2': 'cytoplasm', '3': 'nucleus' },
  });
  assert.deepEqual(
    fromLabelMap.map((c) => c.name),
    ['Background', 'Cell Wall', 'Cytoplasm', 'Nucleus']
  );

  // Undeclared class ID in actual mask is reported truthfully as Class #<id>
  const classData = new Uint8Array([0, 1, 2, 7]);
  const withUnknown = resolveSemanticClasses(undefined, classData);
  assert.equal(withUnknown.find((c) => c.id === 7)?.name, 'Class #7');

  const mask = await loadLosslessMasks({
    frameId: 'stats-frame',
    classMaskBufferOrUrl: classData.buffer,
    width: 2,
    height: 2,
    classMaskEncoding: 'raw-uint8',
  });
  const stats = computeClassPixelStats(mask);
  assert.equal(stats[0].pixelCount, 1);
  assert.equal(stats[0].percentage, 25);
  assert.equal(stats[1].percentage, 25);
});

test('extractConnectedRegion isolates exact 4-connected foreground region and returns null for background', async () => {
  // 5x5 mask with two separate nucleus (class 3) components:
  // Top-left 2x2 blob at (1,1)-(2,2) not touching edge, plus single pixel at (4,4) touching edge
  const classBuf = new Uint8Array([
    0, 0, 0, 0, 0,
    0, 3, 3, 0, 0,
    0, 3, 3, 0, 0,
    0, 0, 0, 2, 0,
    0, 0, 0, 0, 3,
  ]);

  const mask = await loadLosslessMasks({
    frameId: 'cc-frame',
    classMaskBufferOrUrl: classBuf.buffer,
    width: 5,
    height: 5,
    classMaskEncoding: 'raw-uint8',
  });

  // Background click returns null (no region highlighted)
  assert.equal(extractConnectedRegion(mask, 0, 0), null);

  // Click inside interior 2x2 nucleus blob
  const region = extractConnectedRegion(mask, 1, 1);
  assert.ok(region);
  assert.equal(region.classId, 3);
  assert.equal(region.pixelCount, 4);
  assert.equal(region.touchesEdge, false);
  assert.deepEqual(region.bounds, { minX: 1, minY: 1, maxX: 2, maxY: 2 });
  assert.equal(region.regionMask[4 * 5 + 4], 0); // disconnected pixel at (4,4) excluded

  // Click corner pixel at (4,4)
  const edgeRegion = extractConnectedRegion(mask, 4, 4);
  assert.ok(edgeRegion);
  assert.equal(edgeRegion.pixelCount, 1);
  assert.equal(edgeRegion.touchesEdge, true);
});

test('createLabObservation generates complete record', () => {
  const observation = createLabObservation({
    slide: mockSlide,
    organelle: mockDetectedStructures[0],
    studentNotes: 'Prominent sphere observed in cell center.',
    benchId: 'Bench #04-B',
    magnification: 40,
  });

  assert.ok(observation.id.startsWith('obs-'));
  assert.equal(observation.organelleName, 'Nucleus');
  assert.equal(observation.benchId, 'Bench #04-B');
});

test('filterSlides filters by category and search term correctly', () => {
  const slides = [
    mockSlide,
    {
      ...mockSlide,
      id: 'slide-2',
      title: 'Human Blood Smear',
      category: 'Animalia' as const,
    },
  ];

  const plantaeOnly = filterSlides(slides, 'Plantae', '');
  assert.equal(plantaeOnly.length, 1);
  assert.equal(plantaeOnly[0].id, 'test-slide');
});

test('resolveOciApiBaseUrl and resolveWebRtcSignalingUrl enforce explicit OCI config off localhost', () => {
  assert.equal(
    resolveOciApiBaseUrl('https://microlearn.duckdns.org/api/', {
      hostname: 'ais-app.run.app',
    }),
    'https://microlearn.duckdns.org/api'
  );

  // Off localhost (e.g. Google AI Studio published origin), missing env var must NOT silently target app origin
  assert.equal(
    resolveOciApiBaseUrl(undefined, {
      hostname: 'ais-app.run.app',
    }),
    ''
  );
  assert.equal(isOciApiConfigured(''), false);

  // Local dev fallback still works on localhost
  assert.equal(
    resolveOciApiBaseUrl(undefined, {
      hostname: 'localhost',
    }),
    '/api'
  );

  assert.equal(
    resolveWebRtcSignalingUrl('wss://microlearn.duckdns.org/ws/signaling', {
      hostname: 'ais-app.run.app',
      protocol: 'https:',
      host: 'ais-app.run.app',
    }),
    'wss://microlearn.duckdns.org/ws/signaling'
  );

  assert.equal(
    resolveWebRtcSignalingUrl(undefined, {
      hostname: 'ais-app.run.app',
      protocol: 'https:',
      host: 'ais-app.run.app',
    }),
    ''
  );
  assert.equal(isWebRtcSignalingConfigured(''), false);

  assert.equal(
    resolveWebRtcSignalingUrl(undefined, {
      hostname: '127.0.0.1',
      protocol: 'http:',
      host: '127.0.0.1:3000',
    }),
    'ws://127.0.0.1:3000/ws/signaling'
  );
});

test('resolveOciResourceUrl resolves relative OCI paths against OCI host and preserves absolute/data URLs', () => {
  const ociApiBase = 'https://microlearn.duckdns.org/api';

  // Root-relative path from OCI backend resolves to OCI origin, never AI Studio origin
  assert.equal(
    resolveOciResourceUrl('/api/captures/files/frame-123.png', ociApiBase),
    'https://microlearn.duckdns.org/api/captures/files/frame-123.png'
  );

  // API-relative path resolves under OCI API base
  assert.equal(
    resolveOciResourceUrl('captures/files/mask-123.png', ociApiBase),
    'https://microlearn.duckdns.org/api/captures/files/mask-123.png'
  );

  // Fully qualified URLs and Data URLs are preserved untouched
  assert.equal(
    resolveOciResourceUrl('https://cdn.example.org/masks/m1.png', ociApiBase),
    'https://cdn.example.org/masks/m1.png'
  );
  assert.equal(
    resolveOciResourceUrl('data:image/png;base64,iVBORw0KGgo=', ociApiBase),
    'data:image/png;base64,iVBORw0KGgo='
  );
});

test('MICROSCOPE_CONFIG uses 30-second still-capture timeout separate from inference timeout', () => {
  assert.equal(MICROSCOPE_CONFIG.captureTimeoutMs, 30000);
  assert.equal(typeof MICROSCOPE_CONFIG.inferenceTimeoutMs, 'number');
  assert.ok(MICROSCOPE_CONFIG.inferenceTimeoutMs > 0);
});

test('validateUploadImageFile enforces JPEG/PNG and 7 MB raw limit (for 10 MB JSON ceiling) without altering files', () => {
  assert.equal(
    validateUploadImageFile({ name: 'onion.jpg', type: 'image/jpeg', size: 1024 * 500 }).isValid,
    true
  );
  assert.equal(
    validateUploadImageFile({ name: 'slide.png', type: 'image/png', size: MAX_UPLOAD_IMAGE_BYTES }).isValid,
    true
  );

  const unsupported = validateUploadImageFile({
    name: 'anim.gif',
    type: 'image/gif',
    size: 2048,
  });
  assert.equal(unsupported.isValid, false);
  assert.match(unsupported.error || '', /JPEG.*PNG/i);

  const empty = validateUploadImageFile({
    name: 'empty.png',
    type: 'image/png',
    size: 0,
  });
  assert.equal(empty.isValid, false);
  assert.match(empty.error || '', /empty/i);

  const oversized = validateUploadImageFile({
    name: 'huge.png',
    type: 'image/png',
    size: MAX_UPLOAD_IMAGE_BYTES + 1,
  });
  assert.equal(oversized.isValid, false);
  assert.match(oversized.error || '', /10 MiB/i);

  assert.equal(formatFileSize(1536), '1.5 KiB');
  assert.equal(formatFileSize(2 * 1024 * 1024), '2.00 MiB');
});

test('evaluateOciHealthPayload detects healthy, model-unavailable, and API-unavailable payloads', () => {
  const healthy = evaluateOciHealthPayload({ status: 'ok', modelAvailable: true });
  assert.equal(healthy.apiAvailable, true);
  assert.equal(healthy.modelAvailable, true);

  const modelOff = evaluateOciHealthPayload({ status: 'ok', modelAvailable: false });
  assert.equal(modelOff.apiAvailable, true);
  assert.equal(modelOff.modelAvailable, false);
  assert.match(modelOff.error || '', /unavailable/i);

  const nestedModelOff = evaluateOciHealthPayload({
    status: 'ok',
    inference: { status: 'unavailable', message: 'U-Net weights not loaded' },
  });
  assert.equal(nestedModelOff.apiAvailable, true);
  assert.equal(nestedModelOff.modelAvailable, false);
  assert.match(nestedModelOff.error || '', /U-Net weights not loaded/);

  const apiDown = evaluateOciHealthPayload({ ok: false, error: 'Backend degraded' });
  assert.equal(apiDown.apiAvailable, false);
  assert.equal(apiDown.modelAvailable, false);
  assert.match(apiDown.error || '', /Backend degraded/);

  const invalid = evaluateOciHealthPayload(null);
  assert.equal(invalid.apiAvailable, false);
  assert.equal(invalid.modelAvailable, false);
});

test('validateInferenceResponse rejects metadata.frameId mismatch and unsupported maskEncoding', () => {
  const metaMismatch = validateInferenceResponse(
    {
      jobId: 'job-meta-1',
      frameId: 'frame-new',
      status: 'COMPLETED',
      classMaskUrl: '/api/captures/files/mask.png',
      metadata: {
        frameId: 'frame-stale',
        width: 512,
        height: 512,
        maskEncoding: 'grayscale-png',
      },
    },
    'frame-new'
  );
  assert.equal(metaMismatch.isValid, false);
  assert.match(metaMismatch.error || '', /metadata frame id mismatch/i);

  const badEncoding = validateInferenceResponse(
    {
      jobId: 'job-enc-1',
      frameId: 'frame-new',
      status: 'COMPLETED',
      classMaskUrl: '/api/captures/files/mask.jpg',
      metadata: {
        frameId: 'frame-new',
        width: 512,
        height: 512,
        maskEncoding: 'jpeg' as any,
      },
    },
    'frame-new'
  );
  assert.equal(badEncoding.isValid, false);
  assert.match(badEncoding.error || '', /Unsupported mask encoding/i);
});

test('resolveSemanticClasses accurately handles OCI contract classMap with "cell walls"', () => {
  const classes = resolveSemanticClasses({
    width: 512,
    height: 512,
    maskEncoding: 'grayscale-png',
    classMap: {
      '0': 'background',
      '1': 'cell walls',
      '2': 'cytoplasm',
      '3': 'nucleus',
    },
  });
  assert.deepEqual(
    classes.map((c) => ({ id: c.id, name: c.name, isWall: c.isWall, isBackground: c.isBackground })),
    [
      { id: 0, name: 'Background', isWall: false, isBackground: true },
      { id: 1, name: 'Cell Wall', isWall: true, isBackground: false },
      { id: 2, name: 'Cytoplasm', isWall: false, isBackground: false },
      { id: 3, name: 'Nucleus', isWall: false, isBackground: false },
    ]
  );
});

test('OciInferenceClient.submitJob requires exactly one image source (stillUrl XOR imageBase64)', async () => {
  const client = new OciInferenceClient('https://microlearn.duckdns.org/api');

  await assert.rejects(
    () =>
      client.submitJob({
        frameId: 'frame-1',
        stillUrl: '/api/captures/files/a.png',
        imageBase64: 'data:image/png;base64,AAAA',
      }),
    /exactly one image source/i
  );

  await assert.rejects(
    () =>
      client.submitJob({
        frameId: 'frame-2',
      }),
    /exactly one image source/i
  );
});


