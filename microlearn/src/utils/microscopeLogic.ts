/**
 * MicroLearn Laboratory Logic & Validation Utilities
 *
 * Implements real validation for OCI compact U-Net segmentation outputs,
 * coordinate boundaries, and lab notebook record generation.
 * (Synthetic micrograph generation and radius placeholder hit targets removed per project rules)
 */

import type {
  DetectedStructure,
  PreparedSlide,
  LabObservation,
  InferenceJobResponse,
} from '../types/microscope.ts';

/**
 * Validates an asynchronous inference response from the OCI ARM backend.
 * Ensures the response belongs to the matching frame ID and contains verified masks.
 */
export function validateInferenceResponse(
  response: any,
  expectedFrameId?: string
): { isValid: boolean; error?: string } {
  if (!response || typeof response !== 'object') {
    return { isValid: false, error: 'Invalid or empty response object from OCI backend' };
  }

  if (!response.jobId || typeof response.jobId !== 'string') {
    return { isValid: false, error: 'Missing jobId in OCI response' };
  }

  if (expectedFrameId && response.frameId !== expectedFrameId) {
    return {
      isValid: false,
      error: `Frame ID mismatch: expected ${expectedFrameId}, received ${response.frameId}`,
    };
  }

  if (response.status === 'COMPLETED') {
    // STRICT REQUIREMENT: A detections array alone cannot pass as a valid segmentation result.
    // A valid classMaskUrl and positive integer pixel dimensions are always mandatory.
    if (!response.classMaskUrl || typeof response.classMaskUrl !== 'string') {
      return {
        isValid: false,
        error:
          'Completed inference response missing required classMaskUrl. A valid class mask is mandatory for segmentation inspection.',
      };
    }

    // cellIdMaskUrl is optional for semantic-only segmentation responses.
    // If present (non-null/non-undefined), it must be a valid string URL.
    if (
      response.cellIdMaskUrl !== undefined &&
      response.cellIdMaskUrl !== null &&
      typeof response.cellIdMaskUrl !== 'string'
    ) {
      return {
        isValid: false,
        error: 'Completed inference response has an invalid cellIdMaskUrl value.',
      };
    }

    if (!response.metadata || typeof response.metadata !== 'object') {
      return {
        isValid: false,
        error: 'Completed inference response missing model metadata declaration.',
      };
    }

    if (
      response.metadata.frameId !== undefined &&
      response.metadata.frameId !== null &&
      ((expectedFrameId && response.metadata.frameId !== expectedFrameId) ||
        (response.frameId && response.metadata.frameId !== response.frameId))
    ) {
      return {
        isValid: false,
        error: `Metadata frame ID mismatch: expected ${expectedFrameId || response.frameId}, received ${response.metadata.frameId}`,
      };
    }

    if (
      typeof response.metadata.width !== 'number' ||
      !Number.isInteger(response.metadata.width) ||
      response.metadata.width <= 0 ||
      typeof response.metadata.height !== 'number' ||
      !Number.isInteger(response.metadata.height) ||
      response.metadata.height <= 0
    ) {
      return {
        isValid: false,
        error:
          'Completed inference response missing valid pixel dimensions in metadata (width and height must be positive integers).',
      };
    }

    const declaredEncoding = response.metadata.classMaskEncoding || response.metadata.maskEncoding;
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
    if (
      typeof declaredEncoding === 'string' &&
      declaredEncoding.trim() !== '' &&
      !supportedEncodings.includes(declaredEncoding.trim().toLowerCase())
    ) {
      return {
        isValid: false,
        error: `Unsupported mask encoding "${declaredEncoding}". Expected grayscale-png, indexed-png, png, or supported raw integer buffer.`,
      };
    }

    // detectedStructures is optional for semantic-only responses; if supplied it must be an array.
    if (
      response.detectedStructures !== undefined &&
      response.detectedStructures !== null &&
      !Array.isArray(response.detectedStructures)
    ) {
      return {
        isValid: false,
        error: 'Completed inference response has invalid detectedStructures field (expected array).',
      };
    }
  }

  return { isValid: true };
}

/**
 * Formats a verified model confidence percentage
 */
export function formatModelConfidence(confidence: number | undefined | null): string {
  if (confidence === undefined || confidence === null || Number.isNaN(confidence)) {
    return 'Unmeasured';
  }
  return `${confidence.toFixed(1)}%`;
}

/**
 * Creates a validated lab observation record to pin into the student's notebook.
 */
export function createLabObservation(params: {
  slide?: PreparedSlide | null;
  slideTitle?: string;
  organelle?: DetectedStructure | null;
  studentNotes: string;
  benchId: string;
  magnification?: number;
  capturedImageUrl?: string;
}): LabObservation {
  const timestamp = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return {
    id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    slideId: params.slide?.id || 'live-feed',
    slideTitle: params.slide?.title || params.slideTitle || 'Captured Specimen Micrograph',
    organelleId: params.organelle?.id,
    organelleName: params.organelle?.name || 'Selected Cellular Region',
    magnification: params.magnification || 40,
    timestamp,
    studentNotes: params.studentNotes.trim() || 'Qualitative microscopy observation recorded.',
    benchId: params.benchId || 'Bench Unassigned',
    rubricCode: params.organelle?.rubricRef || 'Rubric #4.0 General Microscopy',
    capturedImageUrl: params.capturedImageUrl,
  };
}

/**
 * Filter slides list by category or search query.
 */
export function filterSlides(
  slides: PreparedSlide[],
  categoryFilter: string,
  searchQuery: string
): PreparedSlide[] {
  return slides.filter((slide) => {
    const matchesCategory =
      categoryFilter === 'all' || slide.category.toLowerCase() === categoryFilter.toLowerCase();
    const query = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !query ||
      slide.title.toLowerCase().includes(query) ||
      slide.scientificName.toLowerCase().includes(query) ||
      slide.organelles.some((o) => o.name.toLowerCase().includes(query));

    return matchesCategory && matchesQuery;
  });
}
