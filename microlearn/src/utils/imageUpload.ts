/**
 * Local Microscope Image Upload Validation & Encoding Helpers
 *
 * Supports local JPEG and PNG files as an alternative input to live Pi camera capture.
 * Enforces the backend's current 10 MB JSON request body limit (approx. 7 MB raw file
 * before base64 encoding overhead) and NEVER silently resizes or alters microscope imagery.
 */

/**
 * Conservative raw image byte ceiling so base64-encoded JSON (~4/3x overhead + metadata)
 * stays safely below the backend's current 10 MB JSON request limit.
 */
export const MAX_UPLOAD_IMAGE_BYTES = 7 * 1024 * 1024; // 7 MB

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const ALLOWED_IMAGE_EXTENSIONS = /\.(jpe?g|png)$/i;

export interface UploadFileDescriptor {
  name: string;
  type: string;
  size: number;
}

export interface UploadFileValidationResult {
  isValid: boolean;
  error?: string;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/**
 * Validates that a user-selected local file is a supported JPEG or PNG image within
 * the backend's current 10 MiB JSON payload limit (7 MiB raw file before Base64 expansion).
 * Does NOT silently resize, recompress, or alter the file.
 */
export function validateUploadImageFile(file: UploadFileDescriptor | null | undefined): UploadFileValidationResult {
  if (!file) {
    return { isValid: false, error: 'No image file was selected.' };
  }

  const normalizedType = (file.type || '').toLowerCase().trim();
  const hasAllowedMime = ALLOWED_IMAGE_MIME_TYPES.has(normalizedType);
  const hasAllowedExtension = ALLOWED_IMAGE_EXTENSIONS.test(file.name || '');

  // Accept only JPEG or PNG (reject other MIME types even if renamed, and require matching extension when MIME is blank)
  const isSupportedFormat = normalizedType ? hasAllowedMime : hasAllowedExtension;
  if (!isSupportedFormat) {
    return {
      isValid: false,
      error: `Unsupported file type ("${file.type || file.name}"). Please choose a local JPEG (.jpg, .jpeg) or PNG (.png) microscope image.`,
    };
  }

  if (file.size <= 0) {
    return {
      isValid: false,
      error: 'The selected image file is empty. Please choose a valid JPEG or PNG file.',
    };
  }

  if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
    return {
      isValid: false,
      error: `Image file is too large (${formatFileSize(file.size)}). The backend limits JSON requests to 10 MiB, so raw images must be ${formatFileSize(
        MAX_UPLOAD_IMAGE_BYTES
      )} or smaller before Base64 encoding. Export a smaller JPEG/PNG or crop to the specimen region before uploading—MicroLearn does not silently resize microscopy imagery.`,
    };
  }

  return { isValid: true };
}

/**
 * Reads an untouched local JPEG or PNG File into a base64 Data URL string
 * (data:image/jpeg;base64,... or data:image/png;base64,...) for preview and POST /inference/jobs.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image file as a valid base64 data URL.'));
      }
    };
    reader.onerror = () => {
      reject(new Error('Could not read the selected image file from disk.'));
    };
    reader.readAsDataURL(file);
  });
}
