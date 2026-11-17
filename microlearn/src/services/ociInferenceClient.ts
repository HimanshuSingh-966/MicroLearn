/**
 * OCI ARM Backend Inference Client
 *
 * Interacts with the asynchronous compact U-Net segmentation pipeline hosted on
 * the OCI ARM VM. Submits captured frame inference requests and polls job status
 * until real class & instance mask maps and detected structure metadata are available.
 */

import { MICROSCOPE_CONFIG, isOciApiConfigured } from '../config/microscopeConfig.ts';
import type { InferenceJobResponse } from '../types/microscope.ts';

export interface SubmitInferenceParams {
  frameId: string;
  stillUrl?: string;
  imageBase64?: string;
}

export class OciInferenceClient {
  private baseUrl: string;

  constructor(baseUrl: string = MICROSCOPE_CONFIG.ociApiBaseUrl) {
    this.baseUrl = (baseUrl || '').trim().replace(/\/+$/, '');
  }

  private assertConfigured(): string {
    if (!isOciApiConfigured(this.baseUrl)) {
      throw new Error(
        'OCI backend API URL is not configured (VITE_OCI_API_BASE_URL is missing). Set VITE_OCI_API_BASE_URL to your OCI DuckDNS HTTPS /api endpoint.'
      );
    }
    return this.baseUrl;
  }

  /**
   * Submit a captured still or uploaded local image to OCI compact U-Net segmentation queue.
   * Accepts exactly one image source: stillUrl (Pi capture) OR imageBase64 (local upload).
   */
  public async submitJob(params: SubmitInferenceParams): Promise<{ jobId: string; frameId: string }> {
    const base = this.assertConfigured();
    const url = `${base}/inference/jobs`;

    const hasStillUrl = Boolean(params.stillUrl && params.stillUrl.trim());
    const hasImageBase64 = Boolean(params.imageBase64 && params.imageBase64.trim());
    if (hasStillUrl === hasImageBase64) {
      throw new Error(
        'Inference job submission requires exactly one image source (either stillUrl or imageBase64).'
      );
    }

    const requestBody = hasStillUrl
      ? { frameId: params.frameId, stillUrl: params.stillUrl!.trim() }
      : { frameId: params.frameId, imageBase64: params.imageBase64!.trim() };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
    } catch (netErr: any) {
      throw new Error(
        `Unable to reach OCI inference endpoint (${url}) due to a network or CORS error (${netErr?.message || 'Failed to fetch'}). Ensure the OCI backend is reachable and allows CORS requests from this origin.`
      );
    }

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      if (response.status === 413) {
        throw new Error(
          'Uploaded image exceeds the OCI backend 10 MiB JSON request limit (HTTP 413 Payload Too Large). Choose a smaller JPEG or PNG file.'
        );
      }

      const backendError = errJson?.error || errJson?.message;
      if (
        hasImageBase64 &&
        (response.status === 400 || response.status === 422 || response.status === 501)
      ) {
        throw new Error(
          backendError
            ? `OCI backend could not process uploaded imageBase64 (HTTP ${response.status}): ${backendError}`
            : `OCI backend does not currently accept uploaded imageBase64 requests (HTTP ${response.status} ${response.statusText}).`
        );
      }

      const message =
        backendError ||
        `OCI Inference service returned HTTP ${response.status} (${response.statusText}).`;
      throw new Error(message);
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data.jobId !== 'string' || !data.jobId.trim()) {
      throw new Error('OCI backend did not return a valid jobId in submission response.');
    }

    if (data.frameId !== undefined && data.frameId !== params.frameId) {
      throw new Error(
        `Inference submission frameId mismatch: expected "${params.frameId}", received "${data.frameId}".`
      );
    }

    return { jobId: data.jobId, frameId: data.frameId || params.frameId };
  }

  /**
   * Poll asynchronous inference job on OCI until completion or timeout.
   * Supports AbortSignal to immediately discard stale job results when
   * user captures a new frame, clears upload, disconnects, or returns to Live preview.
   */
  public async pollJob(
    jobId: string,
    options: {
      onProgress?: (progress: InferenceJobResponse) => void;
      signal?: AbortSignal;
    } = {}
  ): Promise<InferenceJobResponse> {
    const base = this.assertConfigured();
    const { onProgress, signal } = options;
    const startTime = Date.now();
    const pollInterval = MICROSCOPE_CONFIG.inferencePollIntervalMs;
    const timeout = MICROSCOPE_CONFIG.inferenceTimeoutMs;

    while (true) {
      // Check if caller aborted (e.g. user returned to live)
      if (signal?.aborted) {
        throw new DOMException('Inference job aborted by user.', 'AbortError');
      }

      if (Date.now() - startTime > timeout) {
        throw new Error(
          `Inference job (${jobId}) timed out after ${timeout / 1000}s on OCI ARM VM.`
        );
      }

      const pollUrl = `${base}/inference/jobs/${encodeURIComponent(jobId)}`;
      let res: Response;
      try {
        res = await fetch(pollUrl, { method: 'GET', mode: 'cors', signal });
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw err;
        }
        throw new Error(
          `Unable to poll OCI inference status at ${pollUrl} (network or CORS error: ${err?.message || 'Failed to fetch'}).`
        );
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          errJson?.error ||
            errJson?.message ||
            `OCI poll endpoint returned HTTP ${res.status} (${res.statusText})`
        );
      }

      const jobData = (await res.json().catch(() => null)) as InferenceJobResponse | null;
      if (!jobData || typeof jobData !== 'object') {
        throw new Error('OCI inference poll endpoint returned an invalid JSON response.');
      }

      if (onProgress) {
        onProgress(jobData);
      }

      if (jobData.status === 'COMPLETED') {
        return jobData;
      }

      if (jobData.status === 'FAILED') {
        throw new Error(
          jobData.error || 'Compact U-Net segmentation failed on OCI ARM VM.'
        );
      }

      // Wait before next poll tick
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, pollInterval);
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('Inference job aborted by user.', 'AbortError'));
            },
            { once: true }
          );
        }
      });
    }
  }
}

export const ociInferenceClient = new OciInferenceClient();
