# Product Requirements Document — MicroLearn

## 1. Summary
MicroLearn is a low-cost IoT camera attachment for standard lab compound microscopes. The intended flow streams onion-cell images from a Pi camera to a hosted web UI, analyzes deliberate still captures with a trained model, and lets a student click a predicted region to highlight it and see reviewed information or discuss it in contextual chat — reversing the usual theory-before-practical teaching order.

**Stage (2026-11-17):** browser UI and a COCO training dataset/script exist. No Pi service or trained model artifact is present. The Node backend and OCI deployment scaffold are incomplete and undeployed. Structure segmentation with individual-cell separation is approved scope, not an implemented or validated capability. The selected interaction is live preview → still capture and analysis → selection on the frozen analyzed image → return to live preview. See `PROJECT_STATUS.md` and `IMPLEMENTATION_PLAN.md` for evidence and remaining work.

**Approved model decision (2026-10-27; architecture finalized 2026-11-03):** compact U-Net semantic segmentation of visible structures and cell boundaries, followed by cell separation/association processing, for stained onion epidermal images. A wall selection highlights the complete visible border of one selected cell, without filling its interior. An internal-structure selection highlights that individual predicted structure. Exact classes and separation algorithm remain to be validated on actual images. OCI Always Free Ampere A1 is selected for backend and inference, subject to ARM compatibility and resource validation.

**Approved delivery decision (2026-10-27, issue 3, option 1):** integrate a real camera → trained model → mask → click → reviewed information flow early, then improve and measure it. The first integrated model is an engineering milestone; report observed quality and physical reliability evidence without claiming unapproved pass thresholds. No fabricated result may substitute for evidence.

**Approved data decision (2026-10-27, issue 4, option 1):** lossless PNG label masks plus JSON metadata, with distinct structure-class and cell-ID maps tied to the same source frame. Training annotations and predictions remain separate records. See `SCHEMA.md` for shared-wall membership, incomplete boundaries, and raw-label handling.

**Approved image interaction (2026-10-27, issue 5, option 2; capture transport finalized 2026-11-03):** show a live microscope preview while the operator adjusts slide position, focus, and lighting. A **Capture & Analyze** action acquires one still image; the UI displays that exact image while analysis runs and remains in selection mode until the user returns to Live. Capture commands/status use a WebRTC DataChannel; the Pi uploads the still directly to OCI over HTTPS. The approved path is not implemented in this checkout.

**Deployment and interaction decisions:** Google AI Studio publishes the UI to Cloud Run (or its assigned custom `ai.studio` URL). OCI hosts backend/orchestration and model inference. Colab trains the model; Hugging Face stores separate dataset and model repositories. Live Pi preview uses WebRTC with OCI signaling and coturn on that VM as a fallback relay. Capture commands/status use a WebRTC DataChannel; Pi uploads the still directly to OCI over HTTPS. OCI runs inference and returns the result asynchronously by job ID/status polling; job state is in memory and a lost job after restart requires recapture. The model is downloaded from Hugging Face at OCI startup, cached, and reused. Gemini chat receives text-only selection/class/reviewed-description/question/history context through OCI; it does not receive the image. Gemini chat is restricted to users aged 18 or older. If Gemini is unavailable, keep the reviewed info card visible and show chat unavailable with Retry. Gemini API credentials must remain server-side.

**Training decisions (2026-11-01 to 2026-11-03):** public dataset of about 250 images; staged labeling in CVAT on image collections (cell walls/individual cells first, then additional reliably visible structures), with human review of model-assisted suggestions; Google Colab training; separate Hugging Face dataset and model repositories; image-level 70/30 development/test split; uncertain pixels marked ignore/unlabeled rather than silently background. Compact U-Net is selected, with boundary predictions used by cell-separation/association processing. Numeric quality-target issue was dropped by the user; do not invent acceptance thresholds or reopen that decision without request.

## 2. Problem Statement
Biology students learn cell structures from textbooks before viewing them under a microscope, disconnecting theory from direct observation. No affordable, classroom-ready device lets a live microscope image become interactively clickable. Existing AI-assisted platforms (e.g. DeepCyto) target hematology professionals on pre-scanned image libraries, not general biology classrooms with a live physical microscope.

## 3. Goals (Demo Scope — Tech Fest)
- G1: Live WebRTC video preview from the microscope-mounted Pi camera to the Google AI Studio-published UI for positioning/focus; the Pi separately captures a still for analysis.
- G2: The model pipeline identifies structure types and separates individual cells. A click selects one internal structure or the complete visible wall border of one cell.
- G3: A faculty-reviewed info card (structure name, function, short description) accompanies a supported selection, with optional Gemini chat contextualized to the selected image region. Measure inference time separately from selection of an already available mask.
- G4: Demonstrate performance on held-out stained onion slides or capture sessions under the agreed imaging conditions, evaluating structure masks, cell separation, complete-border selection, and ambiguity handling.
- G5: Demonstrate the cloud-connected workflow with the Pi, OCI backend/inference, and AI Studio-published UI; network availability is a runtime dependency. Pi access-point/offline behavior is not a substitute for cloud inference.

## 4. Non-Goals (explicitly out of scope for demo)
- NG1: Unvalidated claims of continuous real-time segmentation. The approved interaction analyzes a deliberately captured still; frame rate and end-to-end latency must be measured separately.
- NG2: Continuous real-time segmentation. The approved interaction analyzes a deliberately captured still.
- NG3: Other specimen types or structures that cannot be reliably identified in the actual images. New onion images within the evaluated conditions are the intended input; arbitrary specimens are outside scope.
- NG4: User accounts, multi-device sync, or usage analytics.
- NG5: Live web search for info content. Info cards are static, faculty-reviewed local content.

## 5. Users
- Primary: biology students (school/college) exploring a sample under a microscope.
- Secondary: biology faculty, reviewing/authoring info card content and validating pedagogy.
- Tertiary (demo context): Tech Fest judges/evaluators.

## 6. User Flow
1. Faculty/team places a prepared sample slide under the microscope, focuses it.
2. The Pi streams a live preview to the app while the operator adjusts the slide, focus, and lighting.
3. The operator chooses **Capture & Analyze**. The system acquires a still image and analyzes that identifiable frame.
4. The UI shows the exact captured image and associates its structure-class mask, cell-ID mask, and selection metadata with that frame. It stays still while the user explores it.
5. Student clicks the analyzed image; the app maps the click through display scaling, zoom, and pan into the masks' coordinate space.
6. An internal-structure click selects that individual supported region. A wall click selects the complete visible wall border of the intended cell, leaving its interior unfilled.
7. If a wall is shared, show the adjacent candidate cell boundaries and ask for a second click inside the intended cell. Do not arbitrarily assign a shared wall to one neighbor. Junctions may produce more than two candidates.
8. Display the selected region's reviewed info card. If the selected cell extends outside the image, highlight only its visible boundary and identify it as incomplete; do not infer an unseen closure.
9. When ready to inspect another area, the operator returns to Live; the prior prediction and selection are no longer active for the new preview. Background, uncertain predictions, unavailable inference, unresolved cell separation, and missing content produce explicit states.

Cell identity is local to an analyzed frame, not tracking across live video. A compact model with validated separation processing may implement the approved behavior; two large neural networks are not mandated. Training requires reviewed individual-cell outlines alongside structure labels.

## 7. Functional Requirements
- FR1: Provide a live WebRTC preview from the Raspberry Pi Camera Module connected to the Pi 4 CSI port, using OCI signaling and TURN fallback when direct media cannot connect. The existing MJPEG endpoint is current implementation only, not the selected target transport.
- FR2: Web app displays the live stream and provides a deliberate **Capture & Analyze** action. The capture pipeline supplies the still image actually displayed for analysis and assigns it an identity; the user can return to Live after exploring the frozen analyzed frame.
- FR3: OCI-hosted inference and separation produce aligned PNG structure-class and cell-ID masks with JSON identifying the frame, dimensions, class definitions, model and separation versions, and boundary completeness. Human-reviewed training masks teach the pipeline; they are not runtime click targets for new images.
- FR4: Click selection uses those actual masks. Associate shared wall pixels with every adjacent candidate cell, resolve ambiguity by a second interior click, and highlight the selected cell's visible wall region. Do not substitute fixed circles, prepared polygons, filled-cell highlights, or fabricated predictions for this behavior.
- FR5: Info card content is static local JSON/Markdown, editable by faculty without code changes.
- FR6: The operator can identify the active onion sample/capture. Capturing a new still or returning to Live invalidates predictions and selections that do not belong to the currently displayed analyzed frame.
- FR7: Pi runs as its own Wi-Fi access point (fallback/primary for demo day) in addition to supporting join-existing-network mode.

## 8. Non-Functional Requirements
- NFR1: Video stream latency target <400ms end-to-end on Pi 4 (see Architecture doc for budget breakdown). This is an estimate, not a measured spec — confirm once built.
- NFR2: Target <100ms for selection and info display once the matching mask is available; this is unverified and excludes inference. Set the end-to-end analysis latency target after evaluating the chosen model on the intended host.
- NFR3: Cloud inference and contextual Gemini chat require internet connectivity; show clear unavailable/retry states when these services cannot be reached.
- NFR4: Raspberry Pi 4 supplies camera capture and streaming; the user estimates 4 GB RAM (not yet verified) and reports a 64 GB microSD. Google AI Studio publishes the UI to Cloud Run; OCI hosts backend and inference. Verify OCI capacity and measure model memory/latency against the VM's actual limits.
- NFR5: Total per-unit hardware cost within approved budget (see Cost Estimate doc).

## 9. Success Metrics (Demo)
- Live stream displays and updates continuously for the duration of a judging session.
- Per-class mask overlap, individual-cell merge/split errors, selected-border accuracy/completeness, internal-structure selection, shared-wall disambiguation, rejection behavior, latency, and memory may be recorded on held-out stained onion samples. The user dropped the separate numerical quality-target issue; no pass thresholds or accuracy claims are established.
- No unhandled crash during a 10-minute continuous demo run.

## 10. Open Questions (unresolved — do not assume answers)
- OQ1: Capture representative stained onion images with the actual microscope/camera setup; confirm the stain and preparation protocol and record slide/session identity, magnification, and image quality. The supplied reference image's stain is unknown; it does not establish the appearance of the actual presentation sample.
- OQ2: Validate CVAT export/conversion to PNG label masks with JSON metadata and establish review/ambiguity rules before bulk labeling. CVAT with reviewed model-assisted suggestions is selected.
- OQ3: Confirm classes from real stained captures. Cell wall and nucleus are candidates; cytoplasm, vacuole, mitochondria, and any other structure require evidence of distinguishable boundaries and reviewer agreement. No mitochondrion was reliably identified from the supplied reference image.
- OQ4: Validate the cell-separation and shared-wall association method, including ambiguous junctions, incomplete/occluded boundaries, and cells clipped by the image edge. The desired selection behavior is approved; its implementation is unverified.
- OQ5: Validate compact U-Net training and OCI ARM inference performance, cell-separation behavior, account/region capacity, and deployment measurements. Capture and chat behavior are decided; typed API contracts remain implementation work. No numeric acceptance threshold has been selected; the separate quality-target issue was dropped.
- Hardware confirmation: Raspberry Pi 4 with a ribbon-connected Raspberry Pi Camera Module is the primary setup; the camera is intended to mount at the microscope eyepiece. Exact camera module revision and Pi RAM capacity remain to be confirmed; validate the eyepiece adapter, alignment, focus, and captured image quality on the actual microscope.

## 11. Roadmap Beyond Demo (not funded/built now)
- Additional specimen types, persistent tracking across frames, and continuous segmentation may be considered after the approved structure-and-cell segmentation flow meets its evaluation criteria.
- Multi-device/multi-school deployment requires a separate infrastructure decision.
