# API Contracts — MicroLearn

**Implementation status (2026-11-18):** `pi/camera_agent.py` implements the Pi-side WebRTC peer, still capture, and upload-ticket client. `microlearn/server.ts` implements exact-origin `ALLOWED_ORIGINS` enforcement, capture upload/file routes, asynchronous inference jobs that call `inference/`, text-only chat, ICE configuration, and signaling relay. The inference service loads a semantic model from Hugging Face and returns a class-mask PNG. Code has not been deployed or verified end-to-end on the OCI VM and physical Pi. Instance/cell-ID inference remains unimplemented.

**Approved capture interaction (2026-10-27, issue 5, option 2):** continuous live preview is for positioning only. Capture produces one still image that is displayed by the UI and analyzed by the backend. The Pi agent and matching data-channel/upload handling now exist in source but require end-to-end validation.

**Deployment decisions:** Google AI Studio publishes the UI; one OCI VM hosts backend and inference. Set the exact published frontend origin, DuckDNS hostname, and Hugging Face model repository in the corresponding server-side environment. This checkout has no OCI provisioning bundle. Capture commands/status use the WebRTC DataChannel; Pi uploads stills directly to OCI over HTTPS. Gemini chat is text-only; its key stays server-side.

**Live preview decision (2026-11-02):** use WebRTC for continuous slide positioning/focus preview. Browser and Pi peer code plus backend signaling and ICE response exist. coturn deployment, device authentication, and physical network/recovery verification remain outstanding.

## 1. Pi-side: Video Stream Endpoint

### `GET /video_feed` (planned Pi endpoint; not present in this checkout)
The historical MJPEG endpoint is not implemented in the current repository. The selected end-state preview uses WebRTC.

- **Purpose:** MJPEG live video stream from the CSI-connected Raspberry Pi Camera Module, captured through Picamera2/libcamera.
- **Response:** `multipart/x-mixed-replace; boundary=FRAME` — continuous JPEG frames in the current implementation.
- **Auth:** none (local network only, single-device demo; do not add public auth complexity here).
- **Current failure behavior:** unavailable fresh frames at request time return HTTP 503 with an error. An open stream ends after a frame wait times out. The UI must handle stream termination and health failures; physical disconnect behavior is unverified.

```
GET http://<pi-local-ip>:8000/video_feed
```

### Still capture for analysis (approved behavior; API schema pending)
- **Trigger:** user selects **Capture & Analyze** from the live preview.
- **Purpose:** acquire one still image from the microscope camera and provide it, with a unique frame identity and source dimensions, to both the UI and analysis pipeline.
- **Binding requirement:** the still displayed for selection and the image analyzed by the model must be the same captured frame. The UI remains on that still through analysis and selection; returning to Live begins a new preview and invalidates stale frame-bound results.
- **Planned sequence:** UI sends capture request to OCI; OCI signals the Pi using a WebRTC DataChannel; Pi captures and uploads the still directly to OCI over HTTPS; OCI binds it to a frame ID, starts inference, and makes the exact still available to the UI.
- **Status:** the Pi agent, browser client, and signaling relay are implemented in source. Physical streaming, network traversal, reconnect handling, authentication, and upload timing still need validation.

### `GET /status`
- **Purpose:** simple health check so the app can show "camera connected/disconnected" instead of just a frozen image.
- **Response fields:** `camera_connected` and `stream_active` are booleans derived from camera presence and frame freshness; `error` is null when connected and otherwise contains the current error message. These fields describe the implementation, not proof of hardware validation.

## 2. WebRTC live preview (selected behavior; signaling contract TBD)

- **Purpose:** continuous low-latency view for positioning/focus only. The live stream is not continuously analyzed; a still is captured separately for inference.
- **Connection:** browser and Pi establish a WebRTC peer media connection. OCI hosts signaling so they can exchange session descriptions and ICE candidates. Use a direct peer path when possible; configure TURN as fallback.
- **Status:** WebRTC signaling and ICE endpoint code are implemented. coturn is optional and must be configured on the VM before TURN URLs and the shared secret are enabled. Test connectivity on the actual hotspot and presentation networks.
- **Resource note:** direct media avoids sending all frames through OCI. If TURN relays the media, it consumes OCI network resources and may affect the Always Free VM's practical limits.
- **Capture:** capture command/status use a WebRTC DataChannel. The image itself is uploaded by the Pi directly to OCI over HTTPS, not through the DataChannel. Exact signaling and command schemas remain to be implemented.

## 3. Cloud backend and inference (planned behavior)

The browser calls the OCI backend over HTTPS. OCI coordinates capture with the Pi, runs inference in a separate container on the same ARM VM, and returns prediction maps/metadata to the UI. The UI must display the captured still and accept only results bound to that frame. The current API starts an asynchronous semantic inference job and the UI polls status/result. Job state is held in memory; after a process restart, a lost job is reported unavailable and the user captures again. The implemented inference currently produces a class mask only; it cannot complete the UI's per-cell inspection contract.

The target OCI inference contract in `SCHEMA.md` requires lossless structure-class and cell-ID PNG maps, aligned to the source frame, plus JSON metadata with model/pipeline identity, transforms, cell records, wall association, and completeness. The current first model/runtime returns only the semantic class mask; per-cell inspection remains disabled until the instance-aware contract is implemented. If the model is unavailable or incompatible, return an explicit failure; never substitute hand-authored geometry. Confirm ARM64 package compatibility before deployment.

### Contextual Gemini chat (planned behavior; adults 18+ only)
- Restrict this chat feature to users aged 18 or older. Do not make Gemini API calls for users under 18.
- UI submits the user's message plus active frame ID, selected class/region/cell identity, reviewed description, and conversation history to the OCI backend. Do not send the image or image crop.
- OCI calls Gemini using a server-side secret and returns the assistant response to the chat panel.
- Keep selection context bound to the captured frame and conversation turn. A new capture clears or explicitly changes the active selection context.
- Gemini explains/discusses a selected region; it does not define masks, claim a region was detected if the segmentation result does not support it, or replace reviewed class information.
- Gemini unavailable behavior: keep the reviewed information card visible, show chat unavailable, and offer Retry. Prompt policy, request/response schema, age-gate enforcement, and provider quota handling remain implementation work.

## 4. Dataset and model artifact storage (planned behavior)

Store reviewed images/annotations in a Hugging Face Dataset repository and trained weights/version metadata in a separate Hugging Face model repository, private by default. Colab reads the training data and writes versioned artifacts. Storage is not an inference endpoint; OCI loads the selected compatible model artifact. Credentials must be stored as deployment secrets, not in the browser.

## 5. Local content and model loading (required behavior)

These are logical contracts using PNG label masks and JSON metadata (`SCHEMA.md`). Final paths and typed validators must implement the recorded meanings alongside an explicit migration from current UI records; the old prepared-polygon contract is superseded.

### Load capture/sample records
- Preserve source image identity, dimensions, and specimen/capture metadata (see `SCHEMA.md`).
- Missing records produce an explicit empty state; do not inject demonstration samples into the real workflow.

### Load model and class definitions
- Load compatible trained weights, class mapping, and preprocessing requirements together and preserve their version identity.
- A missing or incompatible model produces analysis unavailable. Camera viewing may continue, but a prepared region map must not impersonate an inference result.

### Load structure info library
- Map supported structure identifiers to faculty-reviewed local content and review metadata.
- If the predicted structure has no reviewed entry, show "info not available"; never manufacture an explanation or review record.

## 6. Explicitly not part of this system (for the demo)

- No REST API for click events, user accounts, or analytics — none of this is persisted server-side (see `SCHEMA.md` §5 and PRD Non-Goal NG4).
- No persistent database or analytics API is currently approved. Gemini chat is an approved external API dependency; it must be proxied by the OCI backend.
- No authentication endpoints.
- Model, class-map, and result-format compatibility must be explicit even though this is a local application.

## 4. Structure and cell inference boundary (approved scope, not implemented)

The pipeline processes an actual identifiable stained-onion image. A slide name and click coordinates alone do not supply the image to analyze. For revised model option 2, clicks select from the predicted structure and cell-ID maps and their derived wall regions. A second click resolves shared-wall cell identity within that result; it is not a new image or a model prompt.

Required input information:
- Actual image data or a resolvable immutable local image reference, with frame identity and source dimensions.
- Model/separation identity and the agreed preprocessing contract.

Required result information:
- JSON metadata with the same frame identity, schema/model/class-map/preprocessing/separation versions, and result status.
- Lossless PNG structure-class and cell-ID maps, with declared integer sample depth, dimensions, label conventions, and transforms back to the source image.
- Cell records with boundary completeness/reasons and actual cell IDs. Supply shared-wall adjacency or enough validated association information to derive adjacent candidates and each cell's visible wall region. Cached/transmitted per-cell wall regions use binary PNGs and may overlap at shared walls.
- Result status and the information needed for the evaluated rejection policy. Model scores must not be presented as measured accuracy or calibrated probabilities without evidence.

Required error behavior:
- Reject invalid image data, incompatible artifacts, malformed dimensions/class or cell IDs, missing cell records, invalid transforms, and integer-label truncation during decoding.
- Invalidate stale results; prevent a late response from replacing results for a newer analyzed image.
- Handle missing models, inference failures, and unreliable selections explicitly without fabricated fallback predictions.
- Represent incomplete cell boundaries and ambiguous wall candidates explicitly. A caller must not arbitrarily choose a neighbor, claim a cropped boundary is complete, or fill a cell interior to stand in for its wall.

OCI Always Free Ampere A1 is selected for backend and inference. Verify ARM64 compatibility, free-tier account/region capacity, and model fit; the exact Pi connection protocol remains open. Semantic inference route scaffolding is implemented, but no trained artifact or deployment is verified; the per-cell segmentation result contract remains unavailable.
