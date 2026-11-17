# Implementation Plan — MicroLearn

**Target:** working Tech Fest demo, Nov 18–20, 2026. UI and an initial Pi stream service exist; physical integration and model behavior are unverified.

**Approved decisions (2026-10-27):** issue 2 is revised to option 2: structure segmentation plus individual-cell separation for stained onion images. A wall click highlights one cell's complete visible border; shared walls use candidate boundaries and a second interior click, and clipped cells show an incomplete-boundary indication. Issue 3 option 1 retains early real end-to-end integration. Issue 4 option 1 selects PNG structure and cell-ID label masks plus JSON metadata. These decisions supersede semantic-only selection and unresolved wall/serialization choices.

**Approved image interaction (2026-10-27, issue 5, option 2):** live preview for slide positioning and focus; user-triggered **Capture & Analyze**; frozen captured still shown during inference and selection; explicit return to Live to inspect another area. The Pi capture service and capture-to-analysis path are not implemented in this checkout.

**Current deployment decision:** Google AI Studio publishes the UI to Cloud Run (or its assigned custom `ai.studio` URL); OCI hosts backend and inference. Hugging Face stores separate dataset and model repositories; Colab trains. CVAT is selected, with human review of model-assisted suggestions. The dataset is about 250 public images; annotate in stages and use an image-level 70/30 development/test split. Compact U-Net predicts structure classes and cell boundaries; post-processing separates cells. WebRTC preview uses OCI signaling and coturn on that VM as TURN fallback. Capture/status use a WebRTC DataChannel; Pi uploads still directly to OCI over HTTPS. Inference uses job IDs/status polling with in-memory job state; lost jobs after restart require recapture. OCI downloads the versioned Hugging Face model at startup and caches it. Gemini receives text-only selection context, is limited to adults 18+, and on failure leaves the reviewed info card visible with chat unavailable/Retry. Verify OCI capacity and end-to-end behavior. Numeric quality-target issue was dropped; do not invent pass thresholds.

The milestones below supersede the previous five-week sequence. They are planned work with evidence requirements, not claims of completion. An integrated first model establishes that the components work together; release readiness additionally requires the quality and reliability checks in M5.

## 1. Current baseline from source inspection

| Area | Evidence available | Work still required |
|---|---|---|
| Hardware | User confirmed Pi 4, CSI ribbon-connected Raspberry Pi Camera Module, and intended eyepiece mounting | Record RAM/module revision; validate adapter fit/alignment, focus, and actual captures on the microscope |
| Capture service | No Pi service file is present in the current checkout | Implement Picamera2 capture, selected WebRTC preview, frame-bound still upload, then validate on physical Pi |
| Browser UI | React components and stream/health references exist in `microlearn/src/components/LiveStageView.tsx` | Real frame analysis, masks, and verified click-coordinate transforms |
| Snapshot control | `handleQuickSnapshot` in `microlearn/src/App.tsx` creates a notebook entry using fixed coordinates | Implement Capture & Analyze to acquire and preserve actual still-image data with frame identity; the existing handler is not image-capture evidence |
| Click selection | `findHitOrganelle` in `microlearn/src/utils/microscopeLogic.ts` uses percentage coordinates and a radius | Replace the model path with actual mask selection and agreed region behavior |
| Sample records | `PREPARED_SLIDES` is empty; the app can read user records from localStorage | Reviewed training data and an explicit migration contract; browser records do not establish a labeled dataset |
| Model | No trained artifact or training/evaluation evidence was established in this audit | Actual training, versioned artifact, OCI ARM inference, and measured performance |
| Network and measurements | UI scale/calibration values exist in source; cloud-connected plan selected | Validate Pi-to-OCI, AI Studio Cloud Run-to-OCI, internet-dependent chat/inference, and actual measurement calibration; displayed values are not proof of accuracy |

This inventory distinguishes source code from verified operation. No physical tests or model evaluation were performed as part of the documentation audit.

## 2. Delivery rules

- Build the first complete flow using real stained captures, reviewed structure masks and individual-cell outlines, actual trained weights with validated separation, real PNG/JSON results, and reviewed content. Do not inject dummy predictions or fixed hit geometry to join components.
- Complete a small reviewed training/validation set and integrate its real model early. Expand data and improve the model based on recorded errors; do not wait for the entire final dataset to begin integration.
- Keep the selected 30% image-level test split out of training/tuning. A successful demonstration on a training image does not establish generalization or release readiness.
- Missing prerequisites and failed predictions must produce explicit states. An unfinished feature stays unfinished; deadlines do not authorize fabricated results or silently reduced quality criteria.
- A milestone passes only when its evidence is recorded. Assign an accountable team member before starting each milestone; no person or delivery estimate is assigned by this document.
- Resolve exact classes/label rules and stain protocol from actual captures, then implement typed data/API contracts. Capture transports and compact U-Net architecture are selected. Implement full-border/shared-wall behavior and PNG/JSON representation; validate separation processing and verify the OCI ARM VM fits the trained model.

## 3. Milestones and completion evidence

### M0 — Real camera image and agreed initial scope

- [ ] Record Pi RAM, camera revision, installed capture-stack versions, and the eyepiece adapter/mounting arrangement.
- [ ] Verify camera recognition, focused onion imaging, current `/video_feed` and `/status`, and establish the hardware/network baseline for replacing MJPEG with WebRTC preview.
- [ ] Acquire original frames with source dimensions and slide/session, preparation, and magnification metadata. A notebook note alone is not a captured image.
- [ ] Confirm the stain/preparation protocol; review actual stained captures with a qualified reviewer to agree initial classes and ambiguous-pixel/outline rules. Cell walls and nuclei are candidates; mitochondria require reliable image evidence before inclusion.
- [ ] Translate the approved two-map PNG/JSON contract into typed fields and validation rules; define capture/control/upload messages that bind the displayed image and OCI inference input to the same frame identity. Verify Always Free account eligibility, home-region capacity, and ARM VM availability.

**Completion evidence:** actual stained capture files/preparation metadata, documented class/outline review, and an implementable frame/result contract for the approved selection behavior. The initial visibility sample is not declared a sufficient final training dataset.

### M1 — First reviewed dataset and content

- [ ] Use CVAT with model-assisted suggestions; review every suggestion and validate export/conversion against the agreed contract.
- [ ] Create an initial training/validation set covering every initial supported class and imaging condition, with reviewed structure masks, individual-cell outlines/IDs, boundary-completeness labels, and traceable provenance.
- [ ] Create the selected simple image-level 70% development / 30% held-out test split before augmentation and record the manifest; never use test images for training or tuning.
- [ ] Verify structure/cell-mask alignment, integer-label PNG round trips, ID/class values, shared-wall membership, and ignore/background treatment after conversion. Preserve raw IDs when decoding in the browser.
- [ ] Produce reviewed information cards for every supported class, with actual reviewer/date records.
- [ ] Record intended imaging conditions and measurements needed to understand model behavior and deployment. The user dropped the separate numerical quality-target issue; do not invent pass/fail thresholds.

**Completion evidence:** versioned real images, reviewed masks, split manifest, class definitions, and reviewed content usable by the first model. Dataset size is justified by coverage and subsequent validation results, not an arbitrary image-count promise.

### M2 — First trained model producing real masks

- [ ] Implement the selected compact U-Net in the chosen training framework and define the cell-separation/association processing based on reviewed labels. Train in Google Colab.
- [ ] Train on M1 groups and record actual weights, preprocessing, class mapping, predicted-boundary outputs, and separation/association configuration/versions.
- [ ] Run inference on validation images; record structure results, cell merge/split errors, full-border quality, and incomplete-boundary detection. Review shared-wall associations, junctions, background, and difficult boundaries.
- [ ] Measure latency and memory for the real model on OCI's ARM64 VM. Verify the runtime uses CPU ARM64-compatible packages and remains within the selected free resources.
- [ ] Recheck exported/deployed model outputs against the training implementation when a conversion is used.

**Completion evidence:** an actual trained pipeline producing aligned structure/cell-ID PNG masks and boundary metadata through the intended runtime, with validation examples and measured resource use. Quality failures remain recorded; passing this milestone does not mean release approval.

### M3 — First real end-to-end flow

- [ ] Implement WebRTC live preview using OCI signaling, direct peer media where possible, and TURN fallback; test reconnect and failure states on the actual demo networks.
- [ ] Keep the Pi stream active while positioning. Trigger Capture from the UI, signal the Pi over WebRTC DataChannel, upload the actual still directly to OCI over HTTPS, and run inference on the same OCI VM.
- [ ] Implement asynchronous inference job IDs/status polling and in-memory status; report jobs lost on restart as unavailable and offer recapture.
- [ ] Deliver actual structure/cell-ID PNG masks and JSON describing frame identity, dimensions/transforms, label encoding, pipeline versions, wall association, and completeness.
- [ ] Display that analyzed frame and select the predicted region under a click; replace radius-based selection in this model path.
- [ ] Highlight one internal structure or the selected cell's complete visible wall border and show reviewed information. Keep the cell interior unfilled during wall selection.
- [ ] Show candidate boundaries for shared walls/junctions and resolve the intended cell with a second interior click; support cancellation and invalid second clicks without choosing an arbitrary neighbor.
- [ ] Indicate clipped/uncertain boundaries explicitly and show only supported visible wall pixels. Do not invent closures across the frame edge or unresolved gaps.
- [ ] Download the versioned model from Hugging Face at OCI startup, cache/reuse it, and handle missing/incompatible artifacts explicitly.
- [ ] Enforce the adult-only (18+) Gemini chat restriction; send text-only selection context. On Gemini failure preserve reviewed info and offer Retry.
- [ ] Handle image/model changes, late inference results, camera loss, missing models/content, and invalid predictions explicitly. Measure the successful path and record failures.
- [ ] Verify clicks under resizing, zoom, pan, crop/letterboxing, and outside-image conditions as applicable to the actual UI.

**Completion evidence:** a reproducible physical camera-to-information run with its real frame, model artifact, predicted mask, selected point/region, reviewed content, and measured timings. Use development/validation samples at this stage; preserve the final test groups. Fake outputs cannot satisfy this milestone.

### M4 — Improve the integrated system

- [ ] Classify errors observed in M2/M3 as capture, labeling, model, coordinate mapping, or selection failures and address the actual cause.
- [ ] Add and review representative training data where coverage is inadequate; retrain and compare versions using development data, keeping the 30% held-out test split untouched until final evaluation.
- [ ] Tune preprocessing, rejection behavior, and deployment performance without using final-test results to select settings.
- [ ] Confirm the cloud-connected workflow, failure/recovery behavior, and any required physical scale calibration. Cloud inference and Gemini chat require internet; offline segmentation is not part of the selected plan.
- [ ] Freeze the candidate model, class map, preprocessing, supported imaging conditions, and reviewed content before final demonstration. Do not invent numerical acceptance thresholds; record measurements and known limitations.

**Completion evidence:** an integrated release candidate with validation evidence for all supported classes, versioned artifacts, a reproducible run procedure, and an agreed evaluation protocol. No silent class removal or lowering of acceptance thresholds to fit the deadline.

### M5 — Final evaluation and demo readiness

- [ ] Evaluate held-out stained onion slides/sessions against reviewed structures and individual-cell outlines. Record per-class overlap, cell-instance merge/split errors, selected-border accuracy/completeness, internal-structure selection, and rejection behavior.
- [ ] Measure stream latency, inference latency, click-to-info latency after mask availability, and memory on the actual deployment setup.
- [ ] Exercise shared walls and multi-cell junctions, second-click disambiguation, clipped/incomplete cells, touching structures, background, source-frame changes during selection, and camera/model failures through the full UI flow.
- [ ] Run for at least 15 minutes with the intended internet/network setup; record crashes, thermal throttling, stream degradation, cloud-service failures, and recovery outcomes.
- [ ] Complete a dry run with a non-team operator and resolve material usability or reliability failures.
- [ ] Report measured results and limitations transparently, including errors and retraining history. Do not claim an unapproved numeric pass threshold.
- [ ] Prepare the judge-facing demonstration and failure plan using only validated capabilities. Identify any saved-image demonstration as such.

**Completion evidence:** recorded evaluation results, actual hardware/network measurements, reproducible artifact/environment versions, reviewed content, and a readiness decision supported by those results. Until this evidence exists, demo readiness remains unverified.

## 4. Schedule and progress reporting

As of 2026-10-27, the target opening date of 2026-11-18 is 22 calendar days away. The old five-week allocation is retired. The availability of usable images, reviewers, training compute, and team members has not established a defensible completion forecast yet.

Prioritize M0 → M1 → M2 → M3 so that a real integrated flow is exercised early, then iterate through M4 and evaluate at M5. Necessary acquisition and content work may overlap once its contracts are agreed; this does not change the completion evidence for dependent milestones.

For each milestone, record its actual owner, status, evidence references, remaining dependencies, and forecast after those inputs are known. Use pending, in progress, passed, or needs correction; a source file or a selected design option alone is not evidence that a milestone passed. All implementation milestones currently lack the evidence needed to mark them passed.

Review the target-date forecast after the first usable captures, the first trained-model validation, and the first complete physical integration. If the forecast misses the target or observed errors/reliability gaps remain, report them and obtain a scope/date decision; do not compress evaluation into an unsupported readiness claim.

## 5. Decisions required at dependency points

| Decision | Required before | Current state |
|---|---|---|
| Visible classes, exact stain protocol, and label/outline rules | M1 annotation | Open; requires actual stained-image review |
| Complete-cell border and shared-wall interaction | M3 integration | Approved; separation/association implementation and validation pending |
| Mask representation and data/API implementation | M1 export and M3 integration | PNG class/cell-ID maps + JSON approved; typed fields, validators, and UI migration pending |
| Live preview transport | M3 implementation | WebRTC selected; OCI signaling plus TURN fallback; exact signaling/ICE configuration and implementation remain open |
| Analyzed-frame interaction | M3 implementation | Approved: active WebRTC preview → DataChannel capture/status → Pi HTTPS upload to OCI → frozen captured still → OCI inference → return to Live; exact schemas remain implementation work |
| Annotation/training/storage | M1/M2 | CVAT with reviewed assistance, Colab, separate Hugging Face dataset/model repositories, public dataset of about 250 images, image-level 70/30 split; actual labels/data remain to be produced |
| Architecture/framework and cell separation | M2 training | Compact U-Net selected; boundary-to-cell separation method and implementation require validation |
| Backend and inference host/runtime | M2/M3 integration | OCI Always Free Ampere A1 selected; confirm ARM compatibility, account/region capacity, model fit, and idle-reclamation risk |
| Gemini contextual chat | M3 integration | Adults 18+ only; text-only context; OCI server-side proxy; preserve reviewed info and offer Retry on failure; implementation pending |
| Numeric quality targets | Dropped by user | Do not set arbitrary thresholds; report actual measurements and limitations |
| Accountable owners and effort estimates | Starting each milestone | Assign from actual team availability |

## 6. Risk tracking

| Risk | Status | Mitigation |
|---|---|---|
| Class visibility and usable onion data unverified | OPEN | M0 image review before bulk annotation |
| Cell separation/shared-wall association errors | OPEN | Behavior approved; review cell outlines, measure merge/split errors, and verify disambiguation and incomplete-border states |
| Data/API/UI mismatch | OPEN | Implement approved PNG/JSON contract, preserve label values and existing user data, and exercise the contract in M3 |
| Model quality or resource use inadequate | OPEN | Measure in M2, integrate early in M3, improve in M4, verify independently in M5 |
| Camera UI or snapshot control mistaken for completed capture | OPEN | Require real image files and frame identity in M0/M3 |
| Cloud/network availability | OPEN | Test WebRTC peer path and TURN fallback, Pi-to-OCI, AI Studio Cloud Run-to-OCI, model download from Hugging Face, and Gemini failure/recovery; cloud inference/chat need internet |
| Nov 18 target feasibility | OPEN | Evidence-based forecasts at M0/M2/M3; explicit scope/date decisions if needed |

Other specimen types, persistent identities across frames, and unsupported claims of continuous real-time segmentation remain outside the approved scope. Per-image cell instance IDs are required. Cloud roles, WebRTC preview, coturn fallback, DataChannel capture/status, HTTPS still upload, compact U-Net, training workflow, job polling, startup model cache, and Gemini age/context/failure behavior are selected but unimplemented. Exact message/API schemas, cell-separation algorithm, OCI ARM compatibility/capacity, factual UI status displays, and physical validation remain open.
