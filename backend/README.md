# Backend and inference

The API server lives at `microlearn/server.ts`. It provides short-lived Pi upload tickets, capture/mask file serving, asynchronous inference jobs that call the separate FastAPI service, text-only Gemini chat, ICE configuration, WebSocket signaling, and an exact-origin CORS allowlist. There is no checked-in OCI provisioning bundle in this checkout; configure and run the Node API and inference service on the OCI VM.

The isolated ARM64-capable PyTorch runtime is in `inference/`. It loads `best.pt` plus `metadata.json` from `/models` and serves `/health` and `/v1/predict`. The Colab training artifact is semantic segmentation only. It does **not** produce cell IDs or per-cell wall membership; those result fields are deliberately omitted. The existing UI requires cell IDs for inspection, so it must not treat this initial model output as complete per-cell wall selection.

## Environment

Copy the root `.env.example` to one project-root `.env`. The Node API and Python inference service load that file; in production, ensure it is present at the repository root beside the service checkout or inject the same values through the service manager. Keep secrets such as `GEMINI_API_KEY`, `HF_TOKEN`, and `TURN_SHARED_SECRET` server-side. Set `MICROLEARN_DOMAIN` to the DuckDNS hostname and `MICROLEARN_PUBLIC_URL` to its HTTPS origin. Set `ALLOWED_ORIGINS` to the exact published Google AI Studio app origin (scheme and host only, no path; comma-separated if there are multiple approved origins). The API rejects browser requests from origins not in this list.

## Model artifact

The inference service loads `best.pt` and `metadata.json` from the configured Hugging Face **model** repository on startup. Set `HF_MODEL_REPO_ID` and a pinned `HF_MODEL_REVISION` in OCI's inference-service environment; set `HF_TOKEN` only for a private repository. The repository identifier has not been recorded in this checkout, so enter the exact owner/repository you created. The service caches downloaded files under its configured `HF_HUB_CACHE`. The API posts the original JPEG/PNG to `/v1/predict`, stores the returned lossless class-mask PNG, and returns a URL plus source dimensions and class mapping. The model is semantic-only: it does not return cell IDs or per-cell wall ownership.

## APIs

- `GET /api/health` — API status and inference/model health.
- `POST /api/captures/upload-ticket` and `PUT /api/captures/:ticket` — short-lived Pi upload flow; accepts JPEG or PNG.
- `GET /api/captures/files/:filename` — retrieve a captured image or predicted class-mask PNG.
- `POST /api/inference/jobs`, `GET /api/inference/jobs/:jobId` — asynchronous semantic class-mask inference. Submit exactly one of a backend `stillUrl` or `imageBase64` (raw Base64 or a JPEG/PNG data URL).
- `POST /api/chat` — adult-confirmed text-only Gemini chat.
- `GET /api/webrtc/ice-servers` and `WS /ws/signaling` — STUN/optional TURN configuration and signaling relay. Set the same TURN shared secret on coturn and the API to issue expiring TURN credentials.
- Internal inference service: `GET /health`, `POST /v1/predict` (multipart `frame_id` and `image`). Not published by Caddy.

## Local backend + inference development

The server is part of the Vite app; run it from `microlearn/` using `npm run dev`. Start inference separately from the repository root after installing `inference/requirements.txt`, setting `MODEL_PATH` and `MODEL_METADATA_PATH`, and launching `uvicorn app:app --app-dir inference --host 127.0.0.1 --port 8000`. Set `INFERENCE_URL=http://127.0.0.1:8000` in the local backend environment. Without a trained compatible artifact, `/health` correctly reports `modelAvailable: false` and prediction returns HTTP 503.

## Current model boundary

The first U-Net is semantic segmentation. The frontend can inspect the predicted semantic class at a clicked pixel and display an approximate connected region. This does not identify an individual cell or assign a shared wall to a particular cell. Do not claim per-cell selection until an instance-aware model and validated wall ownership are implemented.
