/**
 * Centralized Configuration for Raspberry Pi WebRTC Stream & OCI ARM Backend
 *
 * Reads deployment settings from Vite build-time environment variables:
 *   - VITE_OCI_API_BASE_URL=https://<actual-duckdns-host>/api
 *   - VITE_WEBRTC_SIGNALING_URL=wss://<actual-duckdns-host>/ws/signaling
 *   - VITE_STUN_URL=stun:stun.l.google.com:19302
 *
 * Never stores API secrets (GEMINI_API_KEY, HF_TOKEN, TURN_SHARED_SECRET) in frontend bundles.
 * Does not silently fall back to the AI Studio app origin in production builds.
 */

import type { OciHealthStatus } from '../types/microscope.ts';

export interface TurnServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface MicroscopeAppConfig {
  /** WebRTC Signaling URL on OCI ARM VM (empty string if unconfigured in production) */
  webrtcSignalingUrl: string;
  /** Public STUN server list for initial ICE gathering */
  stunServers: RTCIceServer[];
  /** OCI ARM Backend API base URL (empty string if unconfigured in production) */
  ociApiBaseUrl: string;
  /** In-flight inference polling interval in milliseconds */
  inferencePollIntervalMs: number;
  /** Maximum inference timeout in milliseconds (separate from capture timeout) */
  inferenceTimeoutMs: number;
  /** WebRTC DataChannel still capture and Pi HTTPS upload timeout in milliseconds (30s) */
  captureTimeoutMs: number;
}

const DEFAULT_STUN_SERVER = 'stun:stun.l.google.com:19302';

export function isLocalDevHostname(hostname?: string): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h === '0.0.0.0';
}

/**
 * Resolves the OCI HTTP API base URL.
 * - Uses VITE_OCI_API_BASE_URL whenever configured.
 * - In local development on localhost only, falls back to '/api'.
 * - In production / non-local origins (such as Google AI Studio), returns '' so requests
 *   are NEVER silently sent to the AI Studio app's own origin.
 */
export function resolveOciApiBaseUrl(
  envValue?: string,
  options?: { isProd?: boolean; hostname?: string }
): string {
  const trimmed = (envValue || '').trim().replace(/\/+$/, '');
  if (trimmed) {
    return trimmed;
  }

  const isProd = options?.isProd ?? Boolean(import.meta.env?.PROD);
  const hostname =
    options?.hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '');

  if (!isProd && isLocalDevHostname(hostname)) {
    return '/api';
  }

  return '';
}

/**
 * Resolves the OCI WebRTC signaling WebSocket URL.
 * - Uses VITE_WEBRTC_SIGNALING_URL whenever configured.
 * - In local development on localhost only, falls back to ws(s)://<host>/ws/signaling.
 * - In production / non-local origins (such as Google AI Studio), returns '' so signaling
 *   never silently targets the AI Studio app's own origin.
 */
export function resolveWebRtcSignalingUrl(
  envValue?: string,
  options?: { isProd?: boolean; protocol?: string; host?: string; hostname?: string }
): string {
  const trimmed = (envValue || '').trim();
  if (trimmed) {
    return trimmed;
  }

  const isProd = options?.isProd ?? Boolean(import.meta.env?.PROD);
  const hostname =
    options?.hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '');
  const protocol =
    options?.protocol ?? (typeof window !== 'undefined' ? window.location.protocol : 'http:');
  const host =
    options?.host ?? (typeof window !== 'undefined' ? window.location.host : 'localhost:3000');

  if (!isProd && isLocalDevHostname(hostname)) {
    return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/ws/signaling`;
  }

  return '';
}

/**
 * Resolves a mask or still image resource URL returned by OCI.
 * - Preserves fully qualified URLs (https://, http://, data:, blob:).
 * - Resolves root-relative paths (e.g. /api/captures/files/<filename>) against the
 *   configured OCI API host origin — NOT the Google AI Studio page origin.
 * - Resolves non-root relative paths against the configured OCI API base URL.
 */
export function resolveOciResourceUrl(
  resourceUrl: string,
  ociApiBaseUrl: string = MICROSCOPE_CONFIG.ociApiBaseUrl
): string {
  const trimmed = (resourceUrl || '').trim();
  if (!trimmed) return '';

  // Preserve fully qualified HTTP(S), data, and blob URLs
  if (/^(https?:\/\/|data:|blob:)/i.test(trimmed)) {
    return trimmed;
  }

  const cleanBase = (ociApiBaseUrl || '').trim().replace(/\/+$/, '');
  if (!cleanBase) {
    return trimmed;
  }

  // Extract OCI host origin when ociApiBaseUrl is a full URL (e.g. https://host.duckdns.org/api)
  if (/^https?:\/\//i.test(cleanBase)) {
    try {
      const parsed = new URL(cleanBase);
      if (trimmed.startsWith('/')) {
        return `${parsed.origin}${trimmed}`;
      }
      return `${cleanBase}/${trimmed.replace(/^\/+/, '')}`;
    } catch {
      return trimmed;
    }
  }

  // Local dev relative base (e.g. '/api')
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  return `${cleanBase}/${trimmed.replace(/^\/+/, '')}`;
}

export const MICROSCOPE_CONFIG: MicroscopeAppConfig = {
  webrtcSignalingUrl: resolveWebRtcSignalingUrl(import.meta.env?.VITE_WEBRTC_SIGNALING_URL),

  stunServers: [
    {
      urls: (import.meta.env?.VITE_STUN_URL || '').trim() || DEFAULT_STUN_SERVER,
    },
  ],

  ociApiBaseUrl: resolveOciApiBaseUrl(import.meta.env?.VITE_OCI_API_BASE_URL),

  inferencePollIntervalMs: 1000,
  inferenceTimeoutMs: 30000,
  captureTimeoutMs: 30000,
};

export function isOciApiConfigured(baseUrl: string = MICROSCOPE_CONFIG.ociApiBaseUrl): boolean {
  return Boolean(baseUrl && baseUrl.trim().length > 0);
}

export function isWebRtcSignalingConfigured(
  signalingUrl: string = MICROSCOPE_CONFIG.webrtcSignalingUrl
): boolean {
  return Boolean(signalingUrl && signalingUrl.trim().length > 0);
}

export interface IceServersFetchResult {
  iceServers: RTCIceServer[];
  fromBackend: boolean;
  warning?: string;
}

/**
 * Interprets a GET /health JSON payload from the OCI backend without assuming a single schema.
 * Treats explicit false / unavailable / offline / error flags on API or inference/model status as unavailable.
 */
export function evaluateOciHealthPayload(payload: unknown): OciHealthStatus {
  if (!payload || typeof payload !== 'object') {
    return {
      checked: true,
      apiAvailable: false,
      modelAvailable: false,
      error: 'OCI /health endpoint returned an invalid or empty response.',
    };
  }

  const data = payload as Record<string, any>;
  const normalizeFlag = (val: unknown): boolean | undefined => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
      const s = val.trim().toLowerCase();
      if (['ok', 'healthy', 'ready', 'available', 'loaded', 'online', 'up'].includes(s)) return true;
      if (['error', 'unhealthy', 'unavailable', 'offline', 'down', 'failed', 'not_loaded', 'missing', 'degraded'].includes(s)) {
        return false;
      }
    }
    return undefined;
  };

  const apiFlag =
    normalizeFlag(data.ok) ??
    normalizeFlag(data.healthy) ??
    normalizeFlag(data.apiAvailable) ??
    normalizeFlag(data.status);

  const inferenceObj = typeof data.inference === 'object' && data.inference !== null ? data.inference : null;
  const modelObj = typeof data.model === 'object' && data.model !== null ? data.model : null;

  const modelFlag =
    normalizeFlag(data.modelAvailable) ??
    normalizeFlag(data.inferenceAvailable) ??
    normalizeFlag(data.modelReady) ??
    normalizeFlag(data.modelLoaded) ??
    normalizeFlag(inferenceObj?.available) ??
    normalizeFlag(inferenceObj?.ready) ??
    normalizeFlag(inferenceObj?.modelAvailable) ??
    normalizeFlag(inferenceObj?.status) ??
    normalizeFlag(modelObj?.available) ??
    normalizeFlag(modelObj?.ready) ??
    normalizeFlag(modelObj?.loaded) ??
    normalizeFlag(modelObj?.status);

  const apiAvailable = apiFlag !== false;
  const modelAvailable = apiAvailable && modelFlag !== false;

  const backendReason =
    data.error ||
    data.message ||
    inferenceObj?.error ||
    inferenceObj?.message ||
    modelObj?.error ||
    modelObj?.message;

  if (!apiAvailable) {
    return {
      checked: true,
      apiAvailable: false,
      modelAvailable: false,
      statusText: typeof data.status === 'string' ? data.status : 'unavailable',
      error:
        typeof backendReason === 'string' && backendReason.trim()
          ? backendReason
          : 'OCI backend reported API status unavailable.',
    };
  }

  if (!modelAvailable) {
    return {
      checked: true,
      apiAvailable: true,
      modelAvailable: false,
      statusText: typeof data.status === 'string' ? data.status : 'model_unavailable',
      error:
        typeof backendReason === 'string' && backendReason.trim()
          ? backendReason
          : 'OCI segmentation model is currently reported unavailable by GET /health.',
    };
  }

  return {
    checked: true,
    apiAvailable: true,
    modelAvailable: true,
    statusText: typeof data.status === 'string' ? data.status : 'ok',
  };
}

/**
 * Probes GET /health on the configured OCI API base URL using normal CORS requests.
 */
export async function checkOciHealth(
  baseUrl: string = MICROSCOPE_CONFIG.ociApiBaseUrl,
  signal?: AbortSignal
): Promise<OciHealthStatus> {
  const cleanBase = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!isOciApiConfigured(cleanBase)) {
    return {
      checked: true,
      apiAvailable: false,
      modelAvailable: false,
      error:
        'OCI backend URL is not configured (VITE_OCI_API_BASE_URL is missing). Configure the DuckDNS HTTPS /api URL at build time.',
    };
  }

  const url = `${cleanBase}/health`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    return {
      checked: true,
      apiAvailable: false,
      modelAvailable: false,
      error: `Unable to reach OCI health endpoint (${url}) due to a network or CORS error. Verify the OCI server is online and allows CORS requests from this origin.`,
    };
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const detail = errBody?.error || errBody?.message;
    return {
      checked: true,
      apiAvailable: false,
      modelAvailable: false,
      error: detail
        ? `OCI health check failed (HTTP ${res.status}): ${detail}`
        : `OCI health endpoint (${url}) returned HTTP ${res.status} (${res.statusText}).`,
    };
  }

  const json = await res.json().catch(() => null);
  return evaluateOciHealthPayload(json);
}

/**
 * Obtains short-lived ICE servers (including ephemeral TURN credentials)
 * from the OCI backend service via GET /webrtc/ice-servers using normal CORS.
 * Never embeds long-lived TURN secrets in client bundles and never uses no-cors.
 */
export async function fetchIceServersWithStatus(
  baseUrl: string = MICROSCOPE_CONFIG.ociApiBaseUrl
): Promise<IceServersFetchResult> {
  const cleanBase = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!isOciApiConfigured(cleanBase)) {
    return {
      iceServers: MICROSCOPE_CONFIG.stunServers,
      fromBackend: false,
      warning:
        'OCI API URL is not configured (VITE_OCI_API_BASE_URL). Cannot fetch coturn ICE/TURN servers; using public STUN only.',
    };
  }

  const url = `${cleanBase}/webrtc/ice-servers`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return {
        iceServers: MICROSCOPE_CONFIG.stunServers,
        fromBackend: false,
        warning: `ICE server endpoint (${url}) returned HTTP ${res.status}. Using STUN fallback only; camera relay behind NAT/firewalls may fail.`,
      };
    }

    const data = await res.json().catch(() => null);
    if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      return {
        iceServers: data.iceServers,
        fromBackend: true,
      };
    }

    return {
      iceServers: MICROSCOPE_CONFIG.stunServers,
      fromBackend: false,
      warning: `ICE server endpoint (${url}) returned an invalid or empty iceServers list. Using STUN fallback only.`,
    };
  } catch {
    return {
      iceServers: MICROSCOPE_CONFIG.stunServers,
      fromBackend: false,
      warning: `Unable to fetch WebRTC ICE servers from ${url} (network or CORS error). Verify OCI backend availability and CORS allowlist.`,
    };
  }
}

export async function getIceServers(): Promise<RTCIceServer[]> {
  const result = await fetchIceServersWithStatus();
  return result.iceServers;
}
