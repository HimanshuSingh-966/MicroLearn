# Data Schema — MicroLearn

**Approved representation and model (2026-10-27 to 2026-11-03):** lossless PNG label masks with JSON metadata; compact U-Net predicts visible structure classes and cell boundaries, followed by cell-separation/association processing to derive individual-cell IDs. Separate structure-class and cell-ID maps support internal-structure selection and the complete visible border of one cell. Architecture is selected but not trained or validated. Validators, annotation conversion, transport binding, and migration remain unimplemented.

## Design principle
Store training images/reviewed annotations in the selected Hugging Face Dataset repository and trained artifacts/version metadata in a separate Hugging Face model repository. Runtime predictions are returned by the OCI-hosted ARM inference runtime and associated with their source frame; do not treat them as training annotations. Keep reviewed annotations and predictions separate with explicit provenance. Every mask must identify its source frame, role, integer-label encoding, and coordinate system. Display colors are independent of stored label numbers.

## 1. Captured image and provenance

Required information:
- Unique image/frame identity, actual local image reference, source dimensions, and capture time where available.
- Onion specimen, slide, capture session, and field-of-view provenance where available. These metadata do not change the selected image-level split rule.
- Recorded magnification, stain/preparation protocol, and camera conditions where known. Presentation inputs will be stained onion; the exact protocol remains unconfirmed. The supplied reference image has unknown staining and must not be assigned invented preparation metadata.
- Parent-image identity and coordinate transforms for crops or other derived images.
- Dataset split assignment and provenance for any externally supplied images.

## 2. Training classes and reviewed masks

- Versioned class definitions map pixel label values to stable structure identifiers. Confirm structures from actual images before assigning the final class list.
- Define background/non-target pixels separately from ambiguous or unreviewed pixels. An ignore policy must prevent uncertain labels being silently taught as background.
- Each structure mask labels pixels of its source image. A separate reviewed cell-ID mask derives from individual-cell outlines and distinguishes interiors, including internal organelles, within that image. Store both maps as lossless PNG with matching dimensions/alignment or an explicit validated transform.
- Assign cell IDs locally to the image; the number is not a structure class and has no cross-image biological identity. A shared wall must not be assigned exclusively to one neighbor simply to fit a single-label cell map.
- Review cell outlines, shared-wall membership, and boundary completeness alongside structure labels. Record incomplete or uncertain outlines explicitly; a crop edge is not evidence of a biological cell wall.
- Record annotation version, labeling rules, reviewer identity, review state, and review date when review actually occurs.
- If an annotation tool exports polygons, conversion must produce the agreed pixel mask and preserve boundaries/holes as needed. Polygon geometry is not a substitute for model output during use.
- Keep all related frames/crops from a slide or capture group in the same split; apply augmentation to training data after splitting.
- Use the selected simple image-level split: 70% development and 30% reserved held-out test. Record the exact split manifest and do not use held-out test data for training or tuning.

## 3. Reviewed structure information

- Stable structure identifier linked from the approved class definitions.
- Display name, short description, and function authored/reviewed for the educational use case.
- Content version, review state, actual reviewer, and actual review date; missing sign-off must remain visibly incomplete.
- Keep biological content independent from image geometry. Missing reviewed content yields an explicit unavailable state.

## 4. Model artifact and prediction

- The artifact identifies weights, class-map version, preprocessing, separation/association implementation and configuration, training configuration, dataset/split version, and evaluation evidence.
- The selected architecture is compact U-Net. Train its pixel-wise structure and boundary outputs; use the versioned separation/association processing to derive per-image cell IDs and shared-wall memberships. The architecture choice does not establish model quality or successful deployment.
- Each successful prediction includes PNG structure-class and cell-ID maps linked by a JSON manifest to the same frame and pipeline version. A valid empty prediction is distinct from failed/unavailable analysis.
- Select raw integer PNG sample depth to fit the declared labels/IDs, with no lossy conversion, normalized intensities, display palette interpretation, or silent truncation. The decoder must preserve the declared values, including values above 255 if 16-bit masks are used.
- Keep masks aligned. When resizing a label map, preserve discrete values using label-safe mapping such as nearest-neighbor; do not interpolate labels into new class/instance numbers. Document transformations from model input/output back to the source frame.
- Preserve shared membership: derive each cell's visible wall region with a validated association method using its boundary and the structure mask. A shared wall may appear in both neighboring cells' derived wall masks. An optional cached/transmitted per-cell wall mask is a binary PNG referenced from JSON; it is never a hand-authored substitute for inference.
- Distinguish measured model scores from calibrated reliability or observed accuracy. Record only actual outputs and the evaluated rejection policy.

Required metadata groups (final application validators and transport bindings must implement these meanings):

| Group | Required meaning |
|---|---|
| Compatibility and provenance | Schema version; prediction versus reviewed annotation; immutable source frame/image identity |
| Source coordinates | Source width/height, orientation, and any crop/resize/padding transforms |
| Pipeline identity | Model artifact, class-map, preprocessing, and separation/association versions |
| Mask descriptors | Local reference, role (structure classes or cell IDs), dimensions, integer sample depth, and background/ignore/no-cell conventions |
| Cell records | IDs present in the cell map; boundary completeness and reasons; derived wall-mask reference when supplied |
| Wall association | All adjacent candidate cell IDs for a shared wall/junction, or a versioned method that derives the same association from the aligned maps |
| Status/quality | Success, failure, or unavailability and recorded error details; evaluated per-region validity/rejection information where available |

Boundary completeness must distinguish a supported complete border from a clipped or uncertain/incomplete one. Completeness is a pipeline assessment, not a guarantee of correctness; it must be evaluated against reviewed cell outlines. A missing label, record, or unresolved association must not be silently filled with fabricated data.

## 5. Selection state

- Bind the selected point and region to the frame and prediction that produced them.
- Convert displayed coordinates through zoom, pan, scaling, and any letterboxing into source/mask coordinates; reject clicks outside the actual image.
- Record the selected class, region, and cell ID where relevant only when a valid supported selection exists. Region/cell identifiers are local to a prediction, not persistent tracking identities.
- For an internal-structure click, select the individual supported region under the point; touching structures require validated separation or an uncertain-selection state.
- For a wall click with one reliably associated cell, select that cell's complete visible wall border. Highlight wall pixels only, leaving its interior unfilled.
- For a shared wall/junction, enter a pending wall-selection state containing all plausible adjacent cell IDs. Show candidate boundaries; a second click within a candidate cell interior chooses its wall border. Preserve the pending target as cell wall even if the second click lands on a nucleus.
- Allow cancellation; a point outside the candidate interiors must not select an arbitrary cell. Clear pending and confirmed selections when the frame/model/prediction changes.
- For a clipped or uncertain cell, highlight only supported visible wall pixels and expose the incomplete-boundary reason. Do not close gaps across crop edges or infer unseen pixels as a measured wall.
- These requirements do not add click analytics or server-side persistence. Existing UI persistence must be reconciled separately rather than silently changed.

## 6. Validation and migration requirements

- Validate source/prediction identity, dimensions and transforms, declared sample depth, allowed class values, actual cell IDs, and cell-record references together.
- Round-trip PNG labels without numerical changes and confirm browser decoding preserves raw IDs. Colored overlays and screenshots are display outputs, not mask data.
- Verify each derived wall selection against reviewed cell boundaries, including shared edges, multi-cell junctions, holes, merged/split cells, and clipped cells. Serialization success alone does not prove correct selection.
- Keep existing user data recoverable during migration. Percentage centers and radii cannot be converted into model evidence; do not label them as segmentation results.
- Introduce explicit versions for new records and migration logic. Preserve notes/content independently of obsolete geometry; handle unsupported legacy geometry with an explicit unavailable state in the model workflow.

## Remaining implementation details

- Exact class list and label values, stain protocol, review rules, and ignore/background/no-cell conventions after actual-image review.
- Annotation tool/export conversion, actual decoder/runtime, artifact paths, and validated separation/association algorithm.
- WebRTC DataChannel capture/status message schemas; direct Pi-to-OCI HTTPS still upload contract; asynchronous inference job/status API and in-memory job behavior; ARM-compatible dependencies, concurrency/timeouts, and typed field validators. OCI Always Free Ampere A1 is selected; verify account/region capacity and model resource fit.
- Detailed migration of UI/localStorage records while preserving user data. PNG/JSON representation and complete-border/shared-wall behavior no longer require a choice.
