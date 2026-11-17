# Architecture — MicroLearn

**Stage note (2026-11-17):** the architecture remains a target design. No Pi camera service is present in this checkout. The Node backend has initial health/upload/chat/ICE/signaling scaffolding and OCI container deployment files, but neither cloud deployment nor physical camera behavior has been validated. WebRTC preview and still capture remain unimplemented end to end.

**Approved scope (2026-10-27; model architecture finalized 2026-11-03):** compact U-Net predicts visible structure classes and cell boundaries for stained onion images; cell-separation/association processing derives individual-cell IDs and wall membership. Outputs use PNG label maps with JSON metadata. A wall click selects the complete visible border of one cell; shared walls require explicit cell selection. Inference and separation remain planned, not implemented or validated.

**Approved image and deployment flow:** the Pi preview uses WebRTC with OCI signaling and coturn on the same OCI VM as TURN fallback. Capture commands/status use a WebRTC DataChannel; Pi stills upload directly to OCI over HTTPS. The UI displays the exact captured still while OCI inference runs asynchronously and reports job status by polling. Google AI Studio publishes the UI to Cloud Run (or its assigned custom `ai.studio` URL); an OCI VM runs backend and inference. Hugging Face stores separate dataset/model repositories; Colab is the training environment. OCI capacity and end-to-end behavior remain unvalidated.

After selection, users aged 18 or older may use the right-side Gemini chat. OCI sends text-only context (selected class/region, reviewed description, question, and conversation history); no image is sent. Gemini explains the selected region but does not generate masks. Keep the API key server-side. If Gemini is unavailable, retain the reviewed information card and show chat unavailable with Retry.

The intended optical arrangement is the Raspberry Pi Camera Module mounted at the microscope eyepiece and connected to the Pi 4 over CSI ribbon. Adapter fit, alignment, focus, and image quality still require validation on the physical microscope.

## System Diagram (text form)

```
[Microscope + Sample]
        |
        v
[Raspberry Pi Camera Module] --CSI ribbon--> [Raspberry Pi 4]
                                            |
                          live video over WebRTC (planned)
                                            |
                  [AI Studio / Cloud Run UI] <--- peer media ---> [Pi]
                         (OCI signaling; TURN fallback)
                           |
                           | capture API / region chat
                           v
[OCI backend + inference on one ARM VM] <---- Gemini API
        |                                  (key server-side)
        | DataChannel capture/status command
        v
[Raspberry Pi 4 + Camera] -- still over HTTPS --> [OCI backend]
                                                |
                                                | local inference runtime
                                                v
                                      [Structure PNG + cell-ID PNG]
                                      [JSON metadata for exact frame]
                                                |
                  UI click --> [Region/cell selection + highlight]
                                                |
                                  selected region context to Gemini

[Colab training] <---- reviewed image/mask dataset in Hugging Face Dataset repo
        |
        +---- trained weights --> [Hugging Face model repo] --> OCI inference
```

## Component Responsibilities

### Raspberry Pi (confirmed capture + stream responsibility)
- Will capture frames from the CSI-connected Raspberry Pi Camera Module via Picamera2/libcamera.
- The Pi service is not yet present in this checkout. The selected live positioning preview is WebRTC.
- The approved workflow also needs a deliberate still-image capture path. The exact still returned by the Pi must be the image displayed by the UI and analyzed on OCI. This capability and its transport are not present in the current service.
- Optionally runs as its own Wi-Fi access point (hostapd + dnsmasq) so the demo isn't dependent on venue Wi-Fi.
- The existing service has no inference capability. Keep training and inference separate from camera capture. OCI Always Free Ampere A1 is selected for backend and inference; verify ARM64 runtime compatibility and measure the trained model against its available CPU/RAM. Pi 4 RAM capacity remains to be confirmed.
- Selected live-preview approach: WebRTC, with OCI signaling and TURN relay fallback if direct media connection fails. Video should stay peer-to-peer when possible; TURN traffic consumes OCI network resources. Signaling library, ICE/STUN/TURN configuration, and recovery behavior remain to be specified.
- Capture commands/status use a WebRTC DataChannel; stills upload directly from Pi to OCI over HTTPS. Exact messages, endpoint schema, authentication, retries, and timeouts remain to implement.

### Browser App (client-side logic + rendering)
- Displays the live WebRTC preview while the operator positions and focuses the slide, and provides the approved Capture action. WebRTC is planned; the current implementation is MJPEG.
- Displays the exact captured still during analysis and selection. It remains frozen until the user returns to Live; returning to Live clears any result/selection that no longer belongs to the displayed frame.
- Maps clicks through display scaling, zoom, pan, and any crop into the analyzed frame's coordinates.
- Associates the analyzed image, both predicted label maps, class definitions, and model/separation versions with the same frame identity.
- Selects one internal structure or one cell's complete visible wall border and renders its highlight and reviewed info card. Wall selection leaves the cell interior unfilled.
- Shows candidate adjacent cell boundaries when a wall/junction is ambiguous; a second click inside the intended cell selects its border. Preserve that interaction state only for the same frame and prediction.
- Indicates incomplete boundaries for cells clipped by the frame or unresolved by the pipeline; do not draw an invented closure across missing image evidence.
- Invalidates results when the source frame or model changes; an old mask must never be overlaid on newer live footage.
- Shows processing, unavailable-model, uncertain-selection, no-signal, and missing-content states as applicable.

### Training and cloud inference (planned)
- Train from actual stained onion images with reviewed structure masks and individual-cell outlines/IDs, documented class definitions, and labeling rules. Match the presentation preparation protocol and evaluate its intended variation.
- Use the selected image-level 70/30 development/test split; record the manifest and keep the held-out test portion out of training/tuning.
- Version trained weights, class mapping, preprocessing, separation/association configuration, dataset split, and evaluation results together.
- Produce structure-class and cell-ID maps for a specific frame, with shared-wall association and completeness metadata. Decode PNGs as integer label data; visualization colors are separate from inference data.
- Cell IDs distinguish cell interiors within one prediction. Shared wall pixels may belong to the borders of multiple cells, so one exclusive cell-ID value at the clicked wall pixel cannot settle wall ownership. Use a validated association step to derive each cell's visible wall mask from image-supported boundaries and the structure map.
- Preserve overlapping membership in derived per-cell wall masks where a wall is shared. If those masks are cached or transmitted, use binary PNGs referenced by JSON. The complete connected wall network must not be mistaken for one cell's border.
- Select an isolated internal structure using its predicted connected region. Touching internal structures require validated separation or an explicit uncertain-selection state.
- Compact U-Net is selected to predict structure classes and cell boundaries. A separate processing stage derives individual cell IDs and visible wall membership. This is an architectural decision, not a trained or validated capability; exact classes, post-processing method, runtime, model size, and resolution remain to be validated.

### Cloud services (selected, deployment pending)
- **Google AI Studio / Cloud Run:** publishes the browser UI and supplies its public origin; OCI CORS must allow that exact origin.
- **Oracle Cloud Infrastructure (OCI):** one Always Free Ampere A1 ARM VM runs the backend, capture orchestration, inference runtime, and server-side Gemini proxy. Validate current quota/account/region availability and model/runtime compatibility before relying on it.
- **Hugging Face:** separate dataset and model repositories. Repository visibility is not specified. Repository storage is not inference compute.
- **Google Colab:** model training. Staged labels on image collections; CVAT model-assisted annotations must be reviewed before training. Use the selected image-level split: 70% development and 30% held-out test. Mark uncertain pixels ignore/unlabeled.
- **Gemini:** text-only contextual educational chat about the selected region, restricted to users aged 18 or older. It is not the segmentation engine. The reviewed info card stays available if Gemini fails.

### Data and content
- Training images and reviewed PNG structure/cell-ID masks with JSON metadata live in a Hugging Face Dataset repository; weights and model-card/version metadata live in a separate Hugging Face model repository. OCI downloads a versioned model at startup, caches and reuses it. Keep annotation and prediction provenance distinct.
- Faculty-reviewed class content remains a controlled content source. Gemini receives text-only selection/class, reviewed description, user question, and chat history; it receives no image. Bind the selected context to the active frame and enforce the 18+ restriction.

## Why this shape (decisions and their reasoning)

1. **Split responsibilities.** Pi handles camera capture/preview; Google AI Studio publishes the UI to Cloud Run; OCI runs the backend and inference; Gemini provides contextual chat through the OCI backend; Hugging Face stores artifacts; Colab trains. Cloud-backed analysis and chat require internet access.
2. **The Pi 4 and CSI camera are the confirmed hardware path.** The camera connects through the Pi's CSI ribbon port and uses the Raspberry Pi camera stack through Picamera2/libcamera; USB host support is not the reason for the board choice.
3. **Structure labels plus cell identity.** These support selecting a nucleus or the full visible wall border of one cell. Selection can reuse the same frame's prediction without repeating inference for every click; ambiguous shared walls require an explicit second selection.
4. **Real data and measured results.** Model training and evaluation are now required dependencies. Unsupported structures, ambiguous pixels, and missing predictions must not produce fabricated results.

## Estimated Latency Budget (unverified — confirm once built)

| Stage | Estimate |
|---|---|
| CSI camera capture | ~30–60ms |
| JPEG encoding on Pi | ~50–150ms (main bottleneck on weaker boards) |
| Local Wi-Fi transmission | ~20–50ms |
| Browser rendering | ~50–100ms |
| **Existing MJPEG estimate only** | **~150–400ms on Pi 4; not a WebRTC measurement** |
| Selection and info display after the matching mask is available | **<100ms target**, unmeasured |
| Frame acquisition for analysis + preprocessing + inference + mask delivery | Not measured; model and OCI ARM runtime must be benchmarked |

## Failure Modes to Design For
- Venue Wi-Fi congestion — planned mitigation is a Pi access point; effectiveness requires hardware validation.
- Camera disconnect mid-demo — app should show a clear "no signal" state, not a blank/frozen frame that looks like a crash.
- Click on background or an unreliable prediction — show no reliable identification, never a fabricated or default info card.
- Mask/frame mismatch or changed image — invalidate the result and selection.
- Missing/incompatible model artifact or inference failure — show analysis unavailable; do not substitute prepared geometry.
- Incorrectly merged/split cell instances or ambiguous wall membership — reject unreliable selection or show candidate cells; do not silently choose an arbitrary neighbor.
- Cell cut off by the frame or broken/uncertain boundary — indicate incomplete analysis and never claim the visible portion is a complete cell border.
- Pi overheating/thermal throttling during a long demo session — factor in a heatsink (already in hardware budget).

## Explicit non-architecture (do not build these for the demo)
- No authentication layer.
- No persistent database of user clicks/sessions.
- OCI inference and Gemini chat are approved dependencies. Their reliability, credentials, API limits, and failure states require implementation and review. ARM compatibility and free-tier capacity remain open.
