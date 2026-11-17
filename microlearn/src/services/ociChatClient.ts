/**
 * OCI Backend Contextual Cytology Chat Client (Gemini 2.5/Flash text-only proxy)
 *
 * Enforces:
 * 1. Adult-only (18+) verification in both client verification & backend contract.
 * 2. Strict text-only context: NEVER sends images to Gemini.
 * 3. Graceful degradation: If chat fails or is offline, reviewed structure details remain visible with Retry.
 */

import { MICROSCOPE_CONFIG, isOciApiConfigured } from '../config/microscopeConfig.ts';
import type { DetectedStructure } from '../types/microscope.ts';

export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface CytologyChatRequest {
  message: string;
  selectedStructure?: Pick<DetectedStructure, 'name'> | null;
  isAdultConfirmed: boolean;
  frameId?: string;
  specimenType?: string;
  history?: ChatHistoryEntry[];
}

export interface CytologyChatResponse {
  text: string;
  modelRevision?: string;
  timestamp?: string;
}

export class OciChatClient {
  private baseUrl: string;

  constructor(baseUrl: string = MICROSCOPE_CONFIG.ociApiBaseUrl) {
    this.baseUrl = (baseUrl || '').trim().replace(/\/+$/, '');
  }

  /**
   * Send a contextual inquiry to OCI backend Gemini proxy.
   * Sends text context and prior conversation history only; never passes image buffers.
   */
  public async sendInquiry(req: CytologyChatRequest): Promise<CytologyChatResponse> {
    if (!isOciApiConfigured(this.baseUrl)) {
      throw new Error(
        'OCI backend URL is not configured (VITE_OCI_API_BASE_URL). Configure the DuckDNS OCI HTTPS API URL to use the Contextual Cytology Assistant.'
      );
    }

    // 1. Enforce adult self-confirmation at client boundary (authoritative check on backend)
    if (!req.isAdultConfirmed) {
      throw new Error(
        'Age Restriction (18+): Self-confirmation that you are 18 or older is required for the Contextual AI Cytology Assistant. Authoritative age verification is enforced by backend services.'
      );
    }

    if (!req.message.trim()) {
      throw new Error('Inquiry message cannot be empty.');
    }

    const url = `${this.baseUrl}/chat`;

    // 2. Prepare text-only payload per OCI contract (never sends images)
    const payload: Record<string, unknown> = {
      message: req.message.trim(),
      isAdultConfirmed: true,
      specimenType: req.specimenType || 'Microscope Optical Slide',
      frameId: req.frameId,
      history: req.history || [],
    };

    if (req.selectedStructure?.name) {
      payload.selectedStructure = {
        name: req.selectedStructure.name,
      };
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (netErr: any) {
      throw new Error(
        `Unable to reach OCI Chat service at ${url} due to a network or CORS error (${netErr?.message || 'Failed to fetch'}). Verify the OCI backend is online and allows CORS requests from this origin.`
      );
    }

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      const message =
        errJson?.error ||
        errJson?.message ||
        `OCI Chat service returned status ${response.status} (${response.statusText}). Click Retry to re-query.`;
      throw new Error(message);
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data.text !== 'string' || !data.text.trim()) {
      throw new Error('OCI Chat service returned an empty or invalid response.');
    }

    return {
      text: data.text,
      modelRevision: data.modelRevision,
      timestamp: data.timestamp,
    };
  }
}

export const ociChatClient = new OciChatClient();
