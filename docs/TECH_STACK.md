# Tech Stack — MicroLearn

**Current decision status:** Google AI Studio publishes the UI to Cloud Run (or its assigned custom `ai.studio` URL). OCI hosts backend and inference. Hugging Face stores separate dataset/model repositories; Colab is the training environment. Compact U-Net is selected. Preview uses WebRTC; capture control/status uses a WebRTC DataChannel and Pi stills upload directly to OCI over HTTPS. These are design choices, not evidence of deployed or validated services.

## Hardware
| Component | Choice | Status |
|---|---|---|
| Camera | Raspberry Pi Camera Module over CSI ribbon, intended at microscope eyepiece | User-confirmed; exact revision, adapter fit, alignment, focus, and image quality need physical validation |
| Compute | Raspberry Pi 4 | Confirmed; user estimates 4 GB RAM, not yet verified |
| Storage | 64 GB microSD | User-reported |
| Network | Pi Wi-Fi and cloud connection | Cloud inference/chat require internet; Pi access-point mode does not provide those cloud services by itself |

## System responsibilities
| Component | Responsibility |
|---|---|
| Raspberry Pi | Keep camera active, provide WebRTC live preview, receive capture commands/status over DataChannel, upload captured stills directly to OCI over HTTPS. No segmentation inference is assigned to the Pi. |
| Google AI Studio / Cloud Run | Publish and serve the browser UI; configure OCI CORS with the exact published app origin. |
| OCI Always Free VM | One Ampere A1 ARM VM runs the application backend/API, capture orchestration, model inference, and server-side Gemini proxy. Verify ARM64 dependencies, free-tier quota/region availability, and resource fit before relying on it. |
| Hugging Face | Store the dataset and model in separate repositories. Repository visibility is not specified; storage does not itself run inference. |
| Google Colab | Train the model on reviewed project images. |
| Gemini API | Text-only chat about the selected region for users aged 18 or older. Keep the API key on OCI; do not send images. It does not perform segmentation. |

## Capture and interaction flow
1. The Pi camera stays active and streams to the UI over WebRTC while the operator positions/focuses the slide. OCI provides signaling; use TURN relay only when direct media connection fails.
2. The operator clicks **Capture**. Capture command and status travel over a WebRTC DataChannel; the Pi uploads the still directly to OCI over HTTPS.
3. OCI runs inference on the uploaded still, and the UI displays that exact image while results arrive.
4. OCI returns aligned structure-class and cell-ID masks plus JSON metadata. The UI overlays masks and binds them to the captured frame.
5. The user clicks a predicted part. The UI highlights it; a shared cell wall presents candidate cells and asks for a second click inside the intended cell. The selected region can open Gemini chat for users aged 18 or older; only text selection context and reviewed descriptions are sent.
6. Return to Live to inspect another area. Results stay bound to their source frame; stale responses cannot replace a newer capture.

## Training and data
- **Task:** segment visible structures and separate individual cells in stained onion images. Cell-wall selection highlights the complete visible border of one selected cell without filling its interior. Include only structures that can be reliably identified in actual captures.
- **Annotation:** CVAT with model-assisted suggestions. Suggestions are not ground truth; review them before they enter training labels. Stage work across collections: cell walls/individual cells first, then additional supported structures.
- **Training:** Google Colab.
- **Storage:** Hugging Face Dataset repository for images/annotations and a separate model repository for weights/version metadata. Repository visibility is not specified.
- **Split:** 70% development and 30% held-out test at image level, as selected. Augment only after splitting; record the split manifest.
- **Uncertainty:** mark ambiguous pixels ignore/unlabeled rather than silently teaching them as background.
- **Masks:** lossless PNG integer-label structure map and separate cell-ID map, with JSON metadata. See `SCHEMA.md`.
- **Architecture:** compact U-Net is selected for semantic structure and boundary predictions. Cell separation/association processing derives individual cell IDs and visible cell-wall borders. This is a selected design, not a trained or validated model.
- **Evaluation:** numerical quality-target issue was dropped by the user. Do not invent pass thresholds. Record measurements needed to size and operate deployment, including model memory and inference latency.

## OCI ARM64 compatibility test list
- Base OS: Ubuntu ARM64/aarch64; confirm `uname -m` reports `aarch64`.
- Candidate inference runtime: PyTorch CPU ARM64 wheel. Select CPU wheels explicitly; do not rely on an automatic package choice that may install a CUDA build.
- Image/array dependencies: NumPy and Pillow.
- Cell separation/post-processing candidate: SciPy and scikit-image; OpenCV headless is optional if needed.
- API: FastAPI and Uvicorn.
- Artifact retrieval: Hugging Face Hub client.
- Chat API client: Google Gen AI SDK.
- Optional alternative: export the trained model to ONNX and separately check ONNX Runtime ARM64 before considering it for deployment.
- OCI's Always Free Ampere allocation is ARM-based. Test package installation and actual model inference on an ARM VM; a successful x86 Colab run does not prove ARM compatibility or acceptable latency.

## Current implementation status
- The Roboflow COCO export under `dataset/train` contains 167 images with cell-wall, cytoplasm, and nucleus semantic annotations.
- `training/train_unet.py` has a Colab training path but has not yet produced a successfully trained/evaluated artifact.
- `microlearn/server.ts` has health, upload, text chat, ICE, and signaling scaffolding. Real inference remains unavailable until weights/runtime are integrated.
- No OCI deployment automation is checked into this checkout. Configure the OCI VM services from the root `.env.example` and `backend/README.md`.
- No Pi camera service exists in this checkout. WebRTC preview, DataChannel capture, Pi-to-OCI upload, and physical integration are incomplete.
- Keep Gemini credentials in the backend deployment environment; never place them in a `VITE_*` browser variable.

## Deferred implementation details
- Validate OCI Always Free account and home-region capacity, ARM64 runtime compatibility, idle-reclamation exposure, model memory/latency, and free resource usage.
- Implement WebRTC signaling and ICE/STUN/TURN configuration with recovery behavior. coturn on the OCI VM is selected for TURN fallback; monitor its network/resource use.
- Specify typed DataChannel messages, Pi HTTPS upload contract, timeouts, retries/reconnection, and frame identity. The transport choices are selected; exact message and API schemas remain to implement.
- Implement asynchronous inference job IDs/status polling with in-memory job state; a restart may lose active jobs, in which case the UI offers recapture.
- Download the selected versioned model from Hugging Face at OCI startup, cache it, and reuse it; keep credentials in OCI secrets.
- Enforce the 18+ restriction for Gemini chat. Send text-only selected-class/region, reviewed description, question, and conversation history; retain the reviewed info card and show chat unavailable with Retry on Gemini failure.
- Specify typed API schemas, artifact loading/cache behavior, and deployment observability.
- Verify physical camera module revision, Pi RAM, microscope adapter/focus, and image quality.
