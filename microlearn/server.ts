import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHmac } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { WebSocketServer, WebSocket as WsClient } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnv = [path.join(__dirname, '.env'), path.resolve(__dirname, '..', '.env'), path.resolve(__dirname, '..', '..', '.env')]
  .find((candidate) => existsSync(candidate));
dotenv.config(rootEnv ? { path: rootEnv, override: false } : undefined);

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);
const dataDir = path.resolve(process.env.MICROLEARN_DATA_DIR || './data');
const maxImageBytes = Number.parseInt(process.env.MAX_IMAGE_BYTES || `${12 * 1024 * 1024}`, 10);
const jsonLimitBytes = Math.ceil(maxImageBytes * 4 / 3) + 256 * 1024;
const inferenceUrl = (process.env.INFERENCE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const inferenceTimeoutMs = Number.parseInt(process.env.INFERENCE_TIMEOUT_MS || '120000', 10);
const maxActiveJobs = Number.parseInt(process.env.MAX_ACTIVE_INFERENCE_JOBS || '2', 10);
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean));
const allowedImageTypes = new Set(['image/jpeg', 'image/png']);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
});

type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
interface InferenceJob {
  jobId: string;
  frameId: string;
  status: JobStatus;
  progressPercent: number;
  createdAt: number;
  stillImageUrl: string;
  classMaskUrl?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}
interface InferenceOutput {
  frameId: string;
  width: number;
  height: number;
  classMaskEncoding: string;
  classMaskPngBase64: string;
  classes?: unknown;
  modelRevision?: string;
}

const inferenceJobs = new Map<string, InferenceJob>();
const uploadTickets = new Map<string, { frameId: string; expiresAt: number }>();

// Exact-origin CORS. The Pi agent and command-line tools do not send Origin and remain allowed.
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.get('Origin');
  if (origin) {
    if (!allowedOrigins.has(origin)) return res.status(403).json({ error: 'Origin is not allowed by this backend.' });
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: jsonLimitBytes }));

function isValidFilename(filename: string): boolean {
  return /^(capture-[0-9a-f-]+\.(?:jpg|png)|mask-[0-9a-f-]+\.png)$/i.test(filename);
}

function publicFileUrl(filename: string, req?: Request): string {
  const publicOrigin = process.env.MICROLEARN_PUBLIC_URL?.trim();
  const configuredDomain = process.env.MICROLEARN_DOMAIN?.trim();
  const base = publicOrigin || (configuredDomain ? `https://${configuredDomain}` : undefined) ||
    `${req?.protocol || 'http'}://${req?.get('host') || 'localhost'}`;
  return new URL(`/api/captures/files/${encodeURIComponent(filename)}`, base).toString();
}

function validateImageBytes(bytes: Buffer, declaredMime?: string): string {
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const mime = png ? 'image/png' : jpeg ? 'image/jpeg' : '';
  if (!mime || (declaredMime && mime !== declaredMime)) throw new Error('Image content must be valid JPEG or PNG matching its declared MIME type.');
  if (!bytes.length || bytes.length > maxImageBytes) throw new Error(`Image is empty or exceeds the ${maxImageBytes}-byte limit.`);
  return mime;
}

function decodeBase64Image(value: unknown): { bytes: Buffer; mime: string } {
  if (typeof value !== 'string' || !value.trim()) throw new Error('imageBase64 must contain an image.');
  let encoded = value.trim();
  let declaredMime: string | undefined;
  const match = encoded.match(/^data:(image\/(?:jpeg|png));base64,([\s\S]+)$/i);
  if (match) {
    declaredMime = match[1].toLowerCase();
    encoded = match[2];
  }
  if (declaredMime && !allowedImageTypes.has(declaredMime)) throw new Error('Only JPEG and PNG images are supported.');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('imageBase64 is malformed.');
  const bytes = Buffer.from(encoded, 'base64');
  const mime = validateImageBytes(bytes, declaredMime);
  return { bytes, mime };
}

async function getStoredCapture(stillUrl: string, req: Request): Promise<{ bytes: Buffer; filename: string; mime: string }> {
  let url: URL;
  try {
    url = new URL(stillUrl, `${req.protocol}://${req.get('host')}`);
  } catch {
    throw new Error('stillUrl must be a valid backend capture URL.');
  }
  const requestHost = (req.get('host') || '').toLowerCase();
  const domainHost = (process.env.MICROLEARN_DOMAIN || '').toLowerCase();
  if (url.host.toLowerCase() !== requestHost && url.host.toLowerCase() !== domainHost) {
    throw new Error('stillUrl must point to an image stored by this backend.');
  }
  const prefix = '/api/captures/files/';
  if (!url.pathname.startsWith(prefix)) throw new Error('stillUrl must use /api/captures/files/<filename>.');
  const filename = decodeURIComponent(url.pathname.slice(prefix.length));
  if (!isValidFilename(filename) || !filename.startsWith('capture-')) throw new Error('stillUrl does not reference a valid stored capture.');
  const bytes = await readFile(path.join(dataDir, filename));
  const mime = validateImageBytes(bytes);
  return { bytes, filename, mime };
}

async function executeInference(job: InferenceJob, image: Buffer, filename: string, mime: string): Promise<void> {
  job.status = 'PROCESSING';
  job.progressPercent = 20;
  const form = new FormData();
  form.set('frame_id', job.frameId);
  form.set('image', new Blob([Uint8Array.from(image)], { type: mime }), filename);

  let response: globalThis.Response;
  try {
    response = await fetch(`${inferenceUrl}/v1/predict`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(inferenceTimeoutMs),
    });
  } catch (error) {
    throw new Error(`Inference service is unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = await response.json().catch(() => ({})) as InferenceOutput & { detail?: unknown; error?: string };
  if (!response.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail || body.error || 'Prediction failed');
    throw new Error(`Inference service returned HTTP ${response.status}: ${detail}`);
  }
  if (body.frameId !== job.frameId || !Number.isInteger(body.width) || body.width <= 0 ||
      !Number.isInteger(body.height) || body.height <= 0 || body.classMaskEncoding !== 'grayscale-png' ||
      typeof body.classMaskPngBase64 !== 'string' || !body.classMaskPngBase64) {
    throw new Error('Inference service returned a mismatched frame or invalid semantic mask metadata.');
  }

  const maskBytes = Buffer.from(body.classMaskPngBase64, 'base64');
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!maskBytes.subarray(0, 8).equals(pngSignature) || maskBytes.length > maxImageBytes) {
    throw new Error('Inference returned an invalid or oversized lossless PNG mask.');
  }
  const maskFilename = `mask-${randomUUID()}.png`;
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, maskFilename), maskBytes, { flag: 'wx' });
  job.classMaskUrl = publicFileUrl(maskFilename);
  job.metadata = {
    frameId: body.frameId,
    width: body.width,
    height: body.height,
    maskEncoding: body.classMaskEncoding,
    modelRevision: body.modelRevision,
    classMap: body.classes,
  };
  job.status = 'COMPLETED';
  job.progressPercent = 100;
}

function activeJobCount(): number {
  return [...inferenceJobs.values()].filter((job) => job.status === 'QUEUED' || job.status === 'PROCESSING').length;
}

app.get('/api/health', async (_req, res) => {
  try {
    const response = await fetch(`${inferenceUrl}/health`, { signal: AbortSignal.timeout(3000) });
    const inference = await response.json().catch(() => ({}));
    return res.json({ status: 'ok', service: 'microlearn-api', inference });
  } catch (error) {
    return res.json({
      status: 'ok', service: 'microlearn-api',
      inference: { status: 'unreachable', modelAvailable: false, error: error instanceof Error ? error.message : String(error) },
    });
  }
});

app.post('/api/captures/upload-ticket', (req, res) => {
  const frameId = req.body?.frameId;
  if (typeof frameId !== 'string' || !frameId.trim() || frameId.length > 128) {
    return res.status(400).json({ error: 'frameId must be a non-empty string up to 128 characters.' });
  }
  for (const [id, entry] of uploadTickets) if (entry.expiresAt < Date.now()) uploadTickets.delete(id);
  const ticket = randomUUID();
  uploadTickets.set(ticket, { frameId, expiresAt: Date.now() + 5 * 60 * 1000 });
  return res.status(201).json({ ticket, frameId, uploadUrl: `/api/captures/${ticket}`, expiresInSeconds: 300 });
});

app.put('/api/captures/:ticket', express.raw({ type: ['image/jpeg', 'image/png'], limit: maxImageBytes }), async (req, res) => {
  const ticketId = req.params.ticket;
  const ticket = uploadTickets.get(ticketId);
  if (!ticket || ticket.expiresAt < Date.now()) {
    uploadTickets.delete(ticketId);
    return res.status(404).json({ error: 'Upload ticket is invalid or expired.' });
  }
  const mime = (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!allowedImageTypes.has(mime) || !Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'Upload must be JPEG or PNG.' });
  try {
    validateImageBytes(req.body, mime);
    const filename = `capture-${ticketId}.${mime === 'image/png' ? 'png' : 'jpg'}`;
    await mkdir(dataDir, { recursive: true });
    await writeFile(path.join(dataDir, filename), req.body, { flag: 'wx' });
    uploadTickets.delete(ticketId);
    return res.status(201).json({ frameId: ticket.frameId, stillUrl: publicFileUrl(filename, req) });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/captures/files/:filename', async (req, res) => {
  const filename = req.params.filename;
  if (!isValidFilename(filename)) return res.status(400).json({ error: 'Invalid file name.' });
  try {
    const bytes = await readFile(path.join(dataDir, filename));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.type(filename.endsWith('.png') ? 'image/png' : 'image/jpeg');
    return res.send(bytes);
  } catch {
    return res.status(404).json({ error: 'Capture or mask file not found.' });
  }
});

app.post('/api/inference/jobs', async (req, res) => {
  const { frameId, stillUrl, imageBase64 } = req.body || {};
  if (typeof frameId !== 'string' || !frameId.trim() || frameId.length > 128) {
    return res.status(400).json({ error: 'frameId must be a non-empty string up to 128 characters.' });
  }
  if (activeJobCount() >= maxActiveJobs) return res.status(429).json({ error: 'Inference queue is busy; try again shortly.' });
  if ((typeof stillUrl === 'string' && typeof imageBase64 === 'string') || (!stillUrl && !imageBase64)) {
    return res.status(400).json({ error: 'Provide exactly one of stillUrl or imageBase64.' });
  }

  let image: Buffer;
  let filename: string;
  let mime: string;
  let resolvedStillUrl: string;
  try {
    if (typeof stillUrl === 'string') {
      const capture = await getStoredCapture(stillUrl, req);
      ({ bytes: image, filename, mime } = capture);
      resolvedStillUrl = stillUrl;
    } else {
      const decoded = decodeBase64Image(imageBase64);
      image = decoded.bytes;
      mime = decoded.mime;
      filename = `capture-${randomUUID()}.${mime === 'image/png' ? 'png' : 'jpg'}`;
      await mkdir(dataDir, { recursive: true });
      await writeFile(path.join(dataDir, filename), image, { flag: 'wx' });
      resolvedStillUrl = publicFileUrl(filename, req);
    }
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }

  // Recheck after async image loading/storage so concurrent requests cannot exceed the queue cap.
  if (activeJobCount() >= maxActiveJobs) {
    return res.status(429).json({ error: 'Inference queue is busy; try again shortly.' });
  }

  const job: InferenceJob = {
    jobId: randomUUID(), frameId, status: 'QUEUED', progressPercent: 0,
    createdAt: Date.now(), stillImageUrl: resolvedStillUrl,
  };
  inferenceJobs.set(job.jobId, job);
  void executeInference(job, image, filename, mime).catch((error: unknown) => {
    job.status = 'FAILED';
    job.error = error instanceof Error ? error.message : String(error);
    console.error(`[inference ${job.jobId}] ${job.error}`);
  });
  return res.status(202).json({ jobId: job.jobId, status: job.status, frameId: job.frameId });
});

app.get('/api/inference/jobs/:jobId', (req, res) => {
  const job = inferenceJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Inference job not found; it may have expired or the API restarted.' });
  return res.json(job);
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, selectedStructure, isAdultConfirmed, specimenType, frameId, history } = req.body || {};
    if (!isAdultConfirmed) return res.status(403).json({ error: 'Age confirmation is required to use contextual cytology chat.' });
    if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'A text message query is required.' });
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'Gemini API service is not configured.', chatUnavailable: true });

    const details = selectedStructure
      ? `Selected semantic class: ${String(selectedStructure.name || 'Unknown class')}.`
      : 'No specific semantic class is selected.';
    const systemInstruction = `You are a concise educational assistant for plant-cell microscopy. The model output is semantic classes only and does not provide individual cell IDs or assign shared walls to cells. Do not claim unsupported observations. Active specimen: ${String(specimenType || 'onion epidermis')}. Frame: ${String(frameId || 'unspecified')}. ${details}`;
    const priorHistory = Array.isArray(history) ? history
      .filter((item: any) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string' && item.content.trim())
      .map((item: any) => ({ role: item.role === 'assistant' ? 'model' as const : 'user' as const, parts: [{ text: item.content.trim() }] })) : [];
    while (priorHistory.length && priorHistory[0].role !== 'user') priorHistory.shift();

    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const chat = ai.chats.create({ model: modelName, config: { systemInstruction }, history: priorHistory });
    const result = await Promise.race([
      chat.sendMessage({ message: message.trim() }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Cytology query timed out.')), 25000)),
    ]);
    return res.json({ text: result.text || '', modelRevision: modelName, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[API /api/chat]', error);
    return res.status(503).json({ error: error instanceof Error ? error.message : 'Contextual chat is unavailable.', chatUnavailable: true });
  }
});

app.get('/api/webrtc/ice-servers', (_req, res) => {
  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [];
  const stunUrls = (process.env.STUN_URL || 'stun:stun.l.google.com:19302').split(',').map((v) => v.trim()).filter(Boolean);
  if (stunUrls.length) iceServers.push({ urls: stunUrls });
  const turnUrls = (process.env.TURN_URLS || '').split(',').map((v) => v.trim()).filter(Boolean);
  const secret = process.env.TURN_SHARED_SECRET || '';
  if (turnUrls.length && secret) {
    const username = `${Math.floor(Date.now() / 1000) + 3600}:microlearn`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    iceServers.push({ urls: turnUrls, username, credential });
  }
  return res.json({ iceServers });
});

// Normalize JSON/body-parser errors so clients get predictable messages.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status) : 500;
  console.error('[request error]', error);
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    error: status === 413 ? `Request exceeds the configured ${maxImageBytes}-byte image limit.` : 'Request could not be processed.',
  });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

async function startServer() {
  await mkdir(dataDir, { recursive: true });
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws/signaling' });
  const peers = new Set<WsClient>();

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      ws.close(1008, 'Origin is not allowed');
      return;
    }
    peers.add(ws);
    ws.send(JSON.stringify({
      type: 'STATUS', peer: 'rpi4-csi-camera', status: 'CAMERA_OFFLINE',
      message: 'Waiting for the Raspberry Pi camera peer.',
    }));
    ws.on('message', (data) => {
      for (const peer of peers) if (peer !== ws && peer.readyState === peer.OPEN) peer.send(data.toString());
    });
    ws.on('close', () => peers.delete(ws));
  });

  if (process.env.NODE_ENV === 'production') {
    app.use('/assets', express.static(path.join(__dirname, 'assets'), { fallthrough: false }));
    app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
    app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR === 'true' ? false : { server } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }
  server.listen(port, '0.0.0.0', () => console.log(`MicroLearn API listening on port ${port}`));
}

startServer().catch((error) => {
  console.error('Could not start MicroLearn API:', error);
  process.exitCode = 1;
});
