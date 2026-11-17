import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ONION_SIM_WIDTH,
  ONION_SIM_HEIGHT,
  ONION_CLASS_DEFINITIONS,
  ONION_DETECTED_STRUCTURES,
  classifyOnionPixel,
  buildOnionEpidermisMaskBuffers,
  getStructureAnchorPoint,
} from './onionSimulation.ts';
import { loadLosslessMasks, queryMaskPixel } from './maskProcessor.ts';

test('classifyOnionPixel accurately classifies Cell #103 organelles and cell wall', () => {
  // Nucleus center of Cell #103 (545, 392) - offset slightly from nucleolus (552, 389, r=10)
  const nuc = classifyOnionPixel(520, 392);
  assert.equal(nuc.classId, 2);
  assert.equal(nuc.cellId, 103);

  // Nucleolus center of Cell #103 (552, 389)
  const nucl = classifyOnionPixel(552, 389);
  assert.equal(nucl.classId, 5);
  assert.equal(nucl.cellId, 103);

  // Central Vacuole lumen of Cell #103 (430, 340)
  const vac = classifyOnionPixel(430, 340);
  assert.equal(vac.classId, 3);
  assert.equal(vac.cellId, 103);

  // Transvacuolar Cytoplasmic Strand midpoint between (545, 392) and (290, 412) -> (417, 402)
  const cyto = classifyOnionPixel(417, 402);
  assert.equal(cyto.classId, 4);
  assert.equal(cyto.cellId, 103);

  // Cell Wall along boundary between Cell #101 and Cell #103 (edge from [165,270] to [535,255])
  const wall = classifyOnionPixel(350, 262);
  assert.equal(wall.classId, 1);
  assert.ok(wall.cellId === 101 || wall.cellId === 103);
});

test('buildOnionEpidermisMaskBuffers decodes losslessly and supports shared-wall & organelle hit testing', async () => {
  const buffers = buildOnionEpidermisMaskBuffers();
  assert.equal(buffers.width, ONION_SIM_WIDTH);
  assert.equal(buffers.height, ONION_SIM_HEIGHT);
  assert.equal(buffers.classMaskBuffer.byteLength, ONION_SIM_WIDTH * ONION_SIM_HEIGHT);
  assert.equal(buffers.cellIdMaskBuffer.byteLength, ONION_SIM_WIDTH * ONION_SIM_HEIGHT * 2);

  const loaded = await loadLosslessMasks({
    frameId: 'onion-test-1',
    classMaskBufferOrUrl: buffers.classMaskBuffer,
    cellIdMaskBufferOrUrl: buffers.cellIdMaskBuffer,
    width: buffers.width,
    height: buffers.height,
    classMaskEncoding: buffers.classMaskEncoding,
    cellIdMaskEncoding: buffers.cellIdMaskEncoding,
  });

  // Nucleus hit in Cell #102 (720, 112) -> offset from nucleolus (714, 114, r=9.5)
  const nucHit = queryMaskPixel(
    loaded,
    740,
    112,
    ONION_DETECTED_STRUCTURES,
    ONION_CLASS_DEFINITIONS
  );
  assert.equal(nucHit.classId, 2);
  assert.equal(nucHit.cellId, 102);
  assert.equal(nucHit.structure?.name, 'Nucleus');
  assert.equal(nucHit.isSharedWall, false);

  // Shared wall hit between Cell #101 and Cell #103 at (350, 262)
  const sharedWallHit = queryMaskPixel(
    loaded,
    350,
    262,
    ONION_DETECTED_STRUCTURES,
    ONION_CLASS_DEFINITIONS
  );
  assert.equal(sharedWallHit.classId, 1);
  assert.equal(sharedWallHit.isSharedWall, true);
  assert.deepEqual(sharedWallHit.candidateCellIds, [101, 103]);
});

test('getStructureAnchorPoint returns coordinates matching each structure class', () => {
  for (const structure of ONION_DETECTED_STRUCTURES) {
    const pt = getStructureAnchorPoint(structure);
    assert.ok(pt.maskX >= 0 && pt.maskX < ONION_SIM_WIDTH);
    assert.ok(pt.maskY >= 0 && pt.maskY < ONION_SIM_HEIGHT);
    const classified = classifyOnionPixel(pt.maskX, pt.maskY);
    assert.equal(
      classified.classId,
      structure.classId,
      `Anchor for ${structure.name} expected class ${structure.classId}, got ${classified.classId}`
    );
  }
});
