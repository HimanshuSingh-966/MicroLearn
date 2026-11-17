/**
 * Interactive Onion Epidermis (Allium cepa) Optical Simulation & Lossless Mask Engine
 *
 * Designed for live classroom demonstrations and presentations when physical
 * Raspberry Pi / OCI hardware is offline. Produces:
 * 1. An animated brightfield / Toluidine-Blue stained Allium cepa epidermal monolayer
 *    with cytoplasmic streaming (cyclosis), refractive cell walls, vacuoles, nuclei, and nucleoli.
 * 2. Pixel-aligned raw-uint8 class masks and raw-uint16-le cell-ID masks derived directly
 *    from the exact geometric tissue model so every click, hover, shared-wall disambiguation,
 *    and overlay highlight operates through the real segmentation pipeline.
 */

import type { DetectedStructure, ModelClassDefinition } from '../types/microscope.ts';

export const ONION_SIM_WIDTH = 1280;
export const ONION_SIM_HEIGHT = 800;

export const ONION_CLASS_DEFINITIONS: ModelClassDefinition[] = [
  { id: 1, name: 'Cell Wall', category: 'Structural Boundary', color: '#facc15', isWall: true },
  { id: 2, name: 'Nucleus', category: 'Genetic Compartment', color: '#4ade80', isWall: false },
  { id: 3, name: 'Central Vacuole', category: 'Osmoregulation & Storage', color: '#38bdf8', isWall: false },
  { id: 4, name: 'Cytoplasm', category: 'Cytosolic Matrix', color: '#c084fc', isWall: false },
  { id: 5, name: 'Nucleolus', category: 'Ribosomal Synthesis', color: '#fb7185', isWall: false },
];

export interface OnionCellSpec {
  cellId: number;
  polygon: Array<[number, number]>;
  nucleus?: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    angle: number;
    nucleolus: { cx: number; cy: number; r: number };
  };
  strandTarget?: [number, number];
  isEdgeClipped?: boolean;
}

/**
 * Interlocking polygonal epidermal cells of Allium cepa (1280 x 800 optical field).
 * Polygons share exact edges along the middle lamella so cell walls form a realistic
 * brick-like botanical tissue mosaic.
 */
export const ONION_CELLS: OnionCellSpec[] = [
  // Row 1 (Upper tier)
  {
    cellId: 101,
    polygon: [
      [-40, -30],
      [540, -30],
      [575, 115],
      [535, 255],
      [165, 270],
      [-40, 240],
    ],
    nucleus: {
      cx: 418,
      cy: 175,
      rx: 38,
      ry: 27,
      angle: -0.22,
      nucleolus: { cx: 425, cy: 173, r: 9 },
    },
    strandTarget: [140, 110],
    isEdgeClipped: true,
  },
  {
    cellId: 102,
    polygon: [
      [540, -30],
      [1320, -30],
      [1320, 235],
      [1045, 268],
      [535, 255],
      [575, 115],
    ],
    nucleus: {
      cx: 720,
      cy: 112,
      rx: 40,
      ry: 28,
      angle: 0.18,
      nucleolus: { cx: 714, cy: 114, r: 9.5 },
    },
    strandTarget: [1020, 145],
    isEdgeClipped: true,
  },
  // Row 2 (Middle tier — staggered brickwork, primary focal cells)
  {
    cellId: 105,
    polygon: [
      [-40, 240],
      [165, 270],
      [195, 405],
      [150, 540],
      [-40, 560],
    ],
    strandTarget: [65, 400],
    isEdgeClipped: true,
  },
  {
    cellId: 103,
    polygon: [
      [165, 270],
      [535, 255],
      [755, 262],
      [795, 398],
      [740, 536],
      [150, 540],
      [195, 405],
    ],
    nucleus: {
      cx: 545,
      cy: 392,
      rx: 42,
      ry: 30,
      angle: 0.12,
      nucleolus: { cx: 552, cy: 389, r: 10 },
    },
    strandTarget: [290, 412],
    isEdgeClipped: false,
  },
  {
    cellId: 104,
    polygon: [
      [755, 262],
      [1045, 268],
      [1320, 235],
      [1320, 558],
      [1080, 535],
      [740, 536],
      [795, 398],
    ],
    nucleus: {
      cx: 965,
      cy: 432,
      rx: 38,
      ry: 26,
      angle: -0.28,
      nucleolus: { cx: 959, cy: 434, r: 9 },
    },
    strandTarget: [1155, 370],
    isEdgeClipped: true,
  },
  // Row 3 (Lower tier)
  {
    cellId: 106,
    polygon: [
      [-40, 560],
      [150, 540],
      [625, 537],
      [660, 680],
      [615, 835],
      [-40, 835],
    ],
    nucleus: {
      cx: 325,
      cy: 642,
      rx: 39,
      ry: 27,
      angle: 0.24,
      nucleolus: { cx: 332, cy: 640, r: 9 },
    },
    strandTarget: [140, 705],
    isEdgeClipped: true,
  },
  {
    cellId: 107,
    polygon: [
      [625, 537],
      [1080, 535],
      [1320, 558],
      [1320, 835],
      [615, 835],
      [660, 680],
    ],
    nucleus: {
      cx: 882,
      cy: 678,
      rx: 37,
      ry: 26,
      angle: -0.15,
      nucleolus: { cx: 887, cy: 676, r: 9 },
    },
    strandTarget: [1105, 690],
    isEdgeClipped: true,
  },
];

export const ONION_DETECTED_STRUCTURES: DetectedStructure[] = [
  {
    id: 'onion-nucleus-103',
    classId: 2,
    cellId: 103,
    name: 'Nucleus',
    latinName: 'Nucleus cellulae (Allium cepa)',
    category: 'Genetic Compartment',
    confidence: 98.4,
    pixelCount: 15820,
    stainingAffinity: 'Basophilic (Toluidine Blue / Methylene Blue)',
    morphologicalSummary:
      'Prominent oval, darkly stained organelle pushed near the peripheral cytoplasm by the turgid central vacuole.',
    biologicalFunction:
      'Houses chromosomal DNA, regulates gene transcription, and coordinates cellular metabolism and mitosis.',
    keyMolecules: ['Genomic DNA', 'Histone Proteins', 'Nuclear Pore Complexes', 'RNA Polymerase'],
    rubricRef: 'Rubric #2.1: Plant Cell Nucleus & Chromatin',
    isBoundaryIncomplete: false,
    color: '#4ade80',
  },
  {
    id: 'onion-wall-103',
    classId: 1,
    cellId: 103,
    name: 'Cell Wall & Middle Lamella',
    latinName: 'Murus cellulae',
    category: 'Structural Boundary',
    confidence: 97.1,
    pixelCount: 44120,
    stainingAffinity: 'Polychromatic Cellulosic / Pectin Rim',
    morphologicalSummary:
      'Thick, rigid rectangular-hexagonal cellulose boundary joined to neighboring epidermal cells along the middle lamella.',
    biologicalFunction:
      'Maintains hexagonal brick-like tissue architecture, resists osmotic turgor pressure, and prevents cell lysis.',
    keyMolecules: ['Cellulose Microfibrils', 'Calcium Pectate', 'Hemicellulose', 'Extensins'],
    rubricRef: 'Rubric #2.2: Primary Cell Wall & Middle Lamella',
    isBoundaryIncomplete: false,
    isWall: true,
    color: '#facc15',
  },
  {
    id: 'onion-vacuole-103',
    classId: 3,
    cellId: 103,
    name: 'Central Vacuole',
    latinName: 'Vacuola centralis',
    category: 'Osmoregulation & Storage',
    confidence: 95.8,
    pixelCount: 184200,
    stainingAffinity: 'Translucent Lumen (Tonoplast-bounded)',
    morphologicalSummary:
      'Expansive clear sap-filled compartment occupying ~85% of cell volume, pressing organelles toward the cell periphery.',
    biologicalFunction:
      'Generates hydrostatic turgor pressure against the cell wall, stores water and solutes, and maintains cytosolic pH.',
    keyMolecules: ['Cell Sap Solutes', 'Tonoplast Aquaporins', 'V-type H+ ATPase'],
    rubricRef: 'Rubric #2.3: Turgor Pressure & Vacuolar Lumen',
    isBoundaryIncomplete: false,
    color: '#38bdf8',
  },
  {
    id: 'onion-cytoplasm-103',
    classId: 4,
    cellId: 103,
    name: 'Peripheral Cytoplasm & Strands',
    latinName: 'Cytoplasma',
    category: 'Cytosolic Matrix',
    confidence: 91.6,
    pixelCount: 38400,
    stainingAffinity: 'Faint Pale-Violet Granular Matrix',
    morphologicalSummary:
      'Thin granular cytosolic layer lining the inner cell wall with delicate transvacuolar strands exhibiting cytoplasmic streaming.',
    biologicalFunction:
      'Suspends organelles, drives actin-myosin cyclosis (streaming) to distribute nutrients, and hosts glycolysis.',
    keyMolecules: ['Actin Filaments', 'Myosin XI', 'Cytosolic Enzymes', 'Ribosomes'],
    rubricRef: 'Rubric #2.4: Cytosolic Layer & Cyclosis',
    isBoundaryIncomplete: false,
    color: '#c084fc',
  },
  {
    id: 'onion-nucleolus-103',
    classId: 5,
    cellId: 103,
    name: 'Nucleolus',
    latinName: 'Nucleolus',
    category: 'Ribosomal Synthesis',
    confidence: 94.9,
    pixelCount: 1620,
    stainingAffinity: 'Intense Basophilic (Dense RNA-rich Core)',
    morphologicalSummary:
      'Compact, deeply stained spherical body situated within the nuclear matrix with high optical density.',
    biologicalFunction:
      'Transcribes ribosomal RNA (rRNA) and assembles 40S and 60S ribosomal subunits prior to nuclear export.',
    keyMolecules: ['rRNA Transcripts', 'Fibrillarin', 'Ribosomal Proteins'],
    rubricRef: 'Rubric #2.5: Sub-nuclear Organelles',
    isBoundaryIncomplete: false,
    color: '#fb7185',
  },
];

/**
 * Pure geometry: point-in-polygon using ray casting
 */
export function isPointInPolygon(x: number, y: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Pure geometry: minimum Euclidean distance from point (px, py) to polygon boundary
 */
export function distanceToPolygonBoundary(
  px: number,
  py: number,
  polygon: Array<[number, number]>
): number {
  let minSq = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const ax = polygon[j][0];
    const ay = polygon[j][1];
    const bx = polygon[i][0];
    const by = polygon[i][1];

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;

    const projX = ax + t * dx;
    const projY = ay + t * dy;
    const distSq = (px - projX) * (px - projX) + (py - projY) * (py - projY);
    if (distSq < minSq) minSq = distSq;
  }
  return Math.sqrt(minSq);
}

/**
 * Pure geometry: minimum distance from point (px, py) to a line segment AB
 */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Pure pixel classifier matching the exact rendered Onion Epidermis visual layout.
 * Returns { classId, cellId } for any pixel (x, y) in 1280x800 coordinates.
 */
export function classifyOnionPixel(x: number, y: number): { classId: number; cellId: number } {
  const wallThickness = 8.5;
  const cytoplasmRimWidth = 22;

  for (const cell of ONION_CELLS) {
    if (!isPointInPolygon(x, y, cell.polygon)) continue;

    const wallDist = distanceToPolygonBoundary(x, y, cell.polygon);
    if (wallDist <= wallThickness) {
      return { classId: 1, cellId: cell.cellId }; // Cell Wall
    }

    if (cell.nucleus) {
      const n = cell.nucleus;
      // Check Nucleolus first
      const dNucleolus = Math.hypot(x - n.nucleolus.cx, y - n.nucleolus.cy);
      if (dNucleolus <= n.nucleolus.r) {
        return { classId: 5, cellId: cell.cellId }; // Nucleolus
      }

      // Check rotated ellipse for Nucleus
      const cosA = Math.cos(-n.angle);
      const sinA = Math.sin(-n.angle);
      const dx = x - n.cx;
      const dy = y - n.cy;
      const rxLocal = dx * cosA - dy * sinA;
      const ryLocal = dx * sinA + dy * cosA;
      if ((rxLocal * rxLocal) / (n.rx * n.rx) + (ryLocal * ryLocal) / (n.ry * n.ry) <= 1) {
        return { classId: 2, cellId: cell.cellId }; // Nucleus
      }

      // Check transvacuolar cytoplasmic strand connecting nucleus to strandTarget
      if (cell.strandTarget) {
        const dStrand = distanceToSegment(
          x,
          y,
          n.cx,
          n.cy,
          cell.strandTarget[0],
          cell.strandTarget[1]
        );
        if (dStrand <= 7.5) {
          return { classId: 4, cellId: cell.cellId }; // Cytoplasmic strand
        }
      }
    }

    if (wallDist <= cytoplasmRimWidth) {
      return { classId: 4, cellId: cell.cellId }; // Peripheral Cytoplasm
    }

    return { classId: 3, cellId: cell.cellId }; // Central Vacuole
  }

  return { classId: 0, cellId: 0 };
}

/**
 * Returns a clean anchor coordinate (in mask pixel space) for a structure so clicking
 * a chip in the quick selector bar places an on-canvas annotation pin cleanly.
 */
export function getStructureAnchorPoint(structure: DetectedStructure): { maskX: number; maskY: number } {
  const cell =
    ONION_CELLS.find((c) => c.cellId === (structure.cellId || 103)) || ONION_CELLS[3];

  if (structure.classId === 5 && cell.nucleus) {
    return { maskX: Math.round(cell.nucleus.nucleolus.cx), maskY: Math.round(cell.nucleus.nucleolus.cy) };
  }
  if (structure.classId === 2 && cell.nucleus) {
    return {
      maskX: Math.round(cell.nucleus.cx - cell.nucleus.rx * 0.5),
      maskY: Math.round(cell.nucleus.cy),
    };
  }
  if (structure.classId === 1) {
    // Top wall midpoint of cell
    const p0 = cell.polygon[0];
    const p1 = cell.polygon[1];
    return {
      maskX: Math.round(Math.min(Math.max((p0[0] + p1[0]) / 2, 40), ONION_SIM_WIDTH - 40)),
      maskY: Math.round(Math.min(Math.max((p0[1] + p1[1]) / 2 + 2, 20), ONION_SIM_HEIGHT - 20)),
    };
  }
  if (structure.classId === 4 && cell.strandTarget && cell.nucleus) {
    return {
      maskX: Math.round((cell.nucleus.cx + cell.strandTarget[0]) / 2),
      maskY: Math.round((cell.nucleus.cy + cell.strandTarget[1]) / 2),
    };
  }

  // Central vacuole centroid
  let sumX = 0;
  let sumY = 0;
  for (const [px, py] of cell.polygon) {
    sumX += px;
    sumY += py;
  }
  const cx = Math.round(Math.min(Math.max(sumX / cell.polygon.length - 60, 80), ONION_SIM_WIDTH - 80));
  const cy = Math.round(Math.min(Math.max(sumY / cell.polygon.length, 80), ONION_SIM_HEIGHT - 80));
  return { maskX: cx, maskY: cy };
}

/**
 * Renders the realistic Allium cepa Onion Epidermis micrograph onto a 2D canvas.
 * Supports animated cytoplasmic streaming (cyclosis) when timeMs > 0 in live mode.
 */
export function drawOnionEpidermisFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  timeMs: number = 0,
  options: { showReticle?: boolean } = {}
): void {
  const scaleX = width / ONION_SIM_WIDTH;
  const scaleY = height / ONION_SIM_HEIGHT;

  ctx.save();
  ctx.scale(scaleX, scaleY);

  // 1. Brightfield Köhler Illumination Background (subtle radial falloff)
  const bgGrad = ctx.createRadialGradient(
    ONION_SIM_WIDTH * 0.5,
    ONION_SIM_HEIGHT * 0.48,
    120,
    ONION_SIM_WIDTH * 0.5,
    ONION_SIM_HEIGHT * 0.5,
    ONION_SIM_WIDTH * 0.72
  );
  bgGrad.addColorStop(0, '#f4f7f9');
  bgGrad.addColorStop(0.55, '#e7eef4');
  bgGrad.addColorStop(1, '#cfdae5');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, ONION_SIM_WIDTH, ONION_SIM_HEIGHT);

  // Subtle optical slide drift in live simulation
  const driftX = timeMs > 0 ? Math.sin(timeMs * 0.00055) * 1.6 : 0;
  const driftY = timeMs > 0 ? Math.cos(timeMs * 0.00042) * 1.1 : 0;
  ctx.translate(driftX, driftY);

  // 2. Render each epidermal cell interior (Vacuole, Cytoplasmic rim, Strands, Nucleus, Nucleolus)
  for (let cIdx = 0; cIdx < ONION_CELLS.length; cIdx++) {
    const cell = ONION_CELLS[cIdx];

    ctx.save();
    ctx.beginPath();
    cell.polygon.forEach(([px, py], i) => {
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.clip();

    // Central Vacuole translucent tint (slight cell-to-cell hydration variation)
    const vacGrad = ctx.createLinearGradient(
      cell.polygon[0][0],
      cell.polygon[0][1],
      cell.polygon[2]?.[0] ?? 600,
      cell.polygon[3]?.[1] ?? 500
    );
    vacGrad.addColorStop(0, cIdx % 2 === 0 ? 'rgba(222, 236, 248, 0.78)' : 'rgba(228, 240, 250, 0.82)');
    vacGrad.addColorStop(0.5, 'rgba(241, 247, 252, 0.9)');
    vacGrad.addColorStop(1, 'rgba(213, 229, 244, 0.78)');
    ctx.fillStyle = vacGrad;
    ctx.fillRect(0, 0, ONION_SIM_WIDTH, ONION_SIM_HEIGHT);

    // Peripheral Cytoplasmic Rim (soft Toluidine-Blue/violet translucent halo lining the cell wall)
    ctx.lineWidth = 38;
    ctx.strokeStyle = 'rgba(139, 128, 189, 0.22)';
    ctx.stroke();

    ctx.lineWidth = 22;
    ctx.strokeStyle = 'rgba(116, 108, 172, 0.26)';
    ctx.stroke();

    // Fine cytoplasmic granules scattered in peripheral rim
    for (let g = 0; g < 18; g++) {
      const pA = cell.polygon[g % cell.polygon.length];
      const pB = cell.polygon[(g + 1) % cell.polygon.length];
      const t = ((g * 37) % 100) / 100;
      const gx = pA[0] + (pB[0] - pA[0]) * t + Math.sin(g * 4.1 + timeMs * 0.001) * 4;
      const gy = pA[1] + (pB[1] - pA[1]) * t + Math.cos(g * 3.3 + timeMs * 0.001) * 4;
      ctx.fillStyle = 'rgba(92, 84, 148, 0.28)';
      ctx.beginPath();
      ctx.arc(gx, gy, 1.8 + (g % 2), 0, Math.PI * 2);
      ctx.fill();
    }

    // Transvacuolar Cytoplasmic Strand & Streaming Plastids / Vesicles (Cyclosis)
    if (cell.nucleus && cell.strandTarget) {
      const [sx, sy] = [cell.nucleus.cx, cell.nucleus.cy];
      const [tx, ty] = cell.strandTarget;

      ctx.strokeStyle = 'rgba(118, 112, 176, 0.34)';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(155, 148, 204, 0.28)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      // Animated streaming vesicles along the strand
      for (let p = 0; p < 5; p++) {
        const phase = ((timeMs * 0.00018 + p * 0.2 + cIdx * 0.13) % 1 + 1) % 1;
        const px = sx + (tx - sx) * phase;
        const py = sy + (ty - sy) * phase + Math.sin(phase * Math.PI * 2) * 1.5;
        ctx.fillStyle = 'rgba(72, 65, 132, 0.55)';
        ctx.beginPath();
        ctx.arc(px, py, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Nucleus & Nucleolus (Toluidine Blue stained prominent lenticular/oval organelle)
    if (cell.nucleus) {
      const n = cell.nucleus;
      ctx.save();
      ctx.translate(n.cx, n.cy);
      ctx.rotate(n.angle);

      // Nuclear halo in cytoplasm
      const haloGrad = ctx.createRadialGradient(0, 0, n.ry * 0.6, 0, 0, n.rx * 1.45);
      haloGrad.addColorStop(0, 'rgba(98, 92, 166, 0.32)');
      haloGrad.addColorStop(1, 'rgba(98, 92, 166, 0)');
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, n.rx * 1.45, n.ry * 1.45, 0, 0, Math.PI * 2);
      ctx.fill();

      // Nuclear body
      const nucGrad = ctx.createRadialGradient(-n.rx * 0.2, -n.ry * 0.2, 4, 0, 0, n.rx);
      nucGrad.addColorStop(0, '#5a6ad6');
      nucGrad.addColorStop(0.58, '#3f49ab');
      nucGrad.addColorStop(1, '#262d7a');
      ctx.fillStyle = nucGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, n.rx, n.ry, 0, 0, Math.PI * 2);
      ctx.fill();

      // Nuclear envelope refraction edge
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = 'rgba(25, 30, 88, 0.85)';
      ctx.stroke();

      // Chromatin speckles inside nucleus
      const chromatinOffsets = [
        [-14, -6],
        [10, 9],
        [-18, 8],
        [16, -9],
        [2, -13],
        [-4, 12],
      ];
      ctx.fillStyle = 'rgba(22, 26, 78, 0.45)';
      for (const [ox, oy] of chromatinOffsets) {
        ctx.beginPath();
        ctx.arc(ox, oy, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // Nucleolus (dark RNA-rich core)
      const nuclGrad = ctx.createRadialGradient(
        n.nucleolus.cx - 2,
        n.nucleolus.cy - 2,
        1,
        n.nucleolus.cx,
        n.nucleolus.cy,
        n.nucleolus.r
      );
      nuclGrad.addColorStop(0, '#373e9e');
      nuclGrad.addColorStop(0.6, '#181c59');
      nuclGrad.addColorStop(1, '#0d1038');
      ctx.fillStyle = nuclGrad;
      ctx.beginPath();
      ctx.arc(n.nucleolus.cx, n.nucleolus.cy, n.nucleolus.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // 3. Render Primary Cell Walls & Middle Lamella across all cell polygons
  for (const cell of ONION_CELLS) {
    ctx.beginPath();
    cell.polygon.forEach(([px, py], i) => {
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();

    // Outer primary cellulose wall (refractive pale-blue/indigo rim)
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(89, 108, 152, 0.42)';
    ctx.stroke();

    // Crisp wall inner bevel highlight
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(224, 234, 246, 0.55)';
    ctx.stroke();

    // Middle lamella dark refractive boundary line
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = 'rgba(46, 62, 102, 0.88)';
    ctx.stroke();
  }

  // 4. Optional optical reticle & calibrated 100 µm scale bar (clear of bottom-left HUD button)
  if (options.showReticle) {
    ctx.save();
    ctx.strokeStyle = 'rgba(30, 50, 80, 0.5)';
    ctx.lineWidth = 2;
    const barX = 108;
    const barY = ONION_SIM_HEIGHT - 36;
    ctx.beginPath();
    ctx.moveTo(barX, barY - 6);
    ctx.lineTo(barX, barY);
    ctx.lineTo(barX + 120, barY);
    ctx.lineTo(barX + 120, barY - 6);
    ctx.stroke();

    ctx.fillStyle = 'rgba(25, 42, 70, 0.78)';
    ctx.font = '600 13px "JetBrains Mono", monospace';
    ctx.fillText('100 µm • 400x Brightfield (Allium cepa)', barX, barY - 12);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * High-performance live renderer for the simulated optical stage:
 * Renders the static cellular tissue (vacuoles, walls, nuclei, nucleoli) once onto an
 * offscreen canvas, then composites only lightweight cyclosis streaming vesicles per tick.
 */
export function createOnionLiveRenderer(): {
  render: (ctx: CanvasRenderingContext2D, width: number, height: number, timeMs: number) => void;
} {
  let staticCanvas: HTMLCanvasElement | null = null;

  return {
    render(ctx: CanvasRenderingContext2D, width: number, height: number, timeMs: number) {
      if (!staticCanvas && typeof document !== 'undefined') {
        staticCanvas = document.createElement('canvas');
        staticCanvas.width = ONION_SIM_WIDTH;
        staticCanvas.height = ONION_SIM_HEIGHT;
        const sCtx = staticCanvas.getContext('2d');
        if (sCtx) {
          drawOnionEpidermisFrame(sCtx, ONION_SIM_WIDTH, ONION_SIM_HEIGHT, 0, {
            showReticle: true,
          });
        }
      }

      if (!staticCanvas) {
        drawOnionEpidermisFrame(ctx, width, height, timeMs, { showReticle: true });
        return;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(staticCanvas, 0, 0, width, height);

      // Lightweight overlay: moving cytoplasmic streaming vesicles along transvacuolar strands
      const scaleX = width / ONION_SIM_WIDTH;
      const scaleY = height / ONION_SIM_HEIGHT;
      ctx.save();
      ctx.scale(scaleX, scaleY);
      for (let cIdx = 0; cIdx < ONION_CELLS.length; cIdx++) {
        const cell = ONION_CELLS[cIdx];
        if (!cell.nucleus || !cell.strandTarget) continue;
        const sx = cell.nucleus.cx;
        const sy = cell.nucleus.cy;
        const [tx, ty] = cell.strandTarget;

        for (let p = 0; p < 5; p++) {
          const phase = ((timeMs * 0.00018 + p * 0.2 + cIdx * 0.13) % 1 + 1) % 1;
          const px = sx + (tx - sx) * phase;
          const py = sy + (ty - sy) * phase + Math.sin(phase * Math.PI * 2) * 1.5;
          ctx.fillStyle = 'rgba(72, 65, 132, 0.58)';
          ctx.beginPath();
          ctx.arc(px, py, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    },
  };
}

/**
 * Generates pixel-exact raw-uint8 class mask and raw-uint16-le cell-ID mask buffers
 * plus metadata matching the exact 1280x800 rendered Onion Epidermis frame.
 */
export function buildOnionEpidermisMaskBuffers(): {
  width: number;
  height: number;
  classMaskBuffer: ArrayBuffer;
  cellIdMaskBuffer: ArrayBuffer;
  classMaskEncoding: 'raw-uint8';
  cellIdMaskEncoding: 'raw-uint16-le';
} {
  const width = ONION_SIM_WIDTH;
  const height = ONION_SIM_HEIGHT;
  const totalPixels = width * height;

  const classArr = new Uint8Array(totalPixels);
  const cellIdArr = new Uint16Array(totalPixels);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const { classId, cellId } = classifyOnionPixel(x, y);
      const idx = rowOffset + x;
      classArr[idx] = classId;
      cellIdArr[idx] = cellId;
    }
  }

  return {
    width,
    height,
    classMaskBuffer: classArr.buffer,
    cellIdMaskBuffer: cellIdArr.buffer,
    classMaskEncoding: 'raw-uint8',
    cellIdMaskEncoding: 'raw-uint16-le',
  };
}
