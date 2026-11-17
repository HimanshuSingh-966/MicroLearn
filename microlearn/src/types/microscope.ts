/**
 * MicroLearn Microscopy Architecture Types & Service Contracts
 *
 * Real system contracts connecting:
 * - Raspberry Pi 4 + CSI Camera (WebRTC live streaming + DataChannel capture commands)
 * - OCI ARM VM (coturn TURN fallback + WebRTC signaling + compact U-Net inference + Gemini proxy)
 * - Browser Frontend (Vercel deployment)
 */

export type MicroscopeDesignState =
  | 'live-preview'
  | 'uploaded-preview'
  | 'capturing'
  | 'analyzing'
  | 'analysis-error'
  | 'ready-to-inspect'
  | 'no-signal';

export interface UploadedImageAsset {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

export interface OciHealthStatus {
  checked: boolean;
  apiAvailable: boolean;
  modelAvailable: boolean;
  statusText?: string;
  error?: string;
}

export type MicroscopeStatusChip =
  | 'Connecting'
  | 'Live'
  | 'Capturing'
  | 'Analyzing'
  | 'Ready to inspect'
  | 'No signal';

export type WebRtcConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'no-signal';

/**
 * Capture command & status messages exchanged over the WebRTC DataChannel
 */
export type DataChannelOutMessage = {
  type: 'CAPTURE_STILL';
  frameId: string;
  timestamp: number;
};

export type DataChannelInMessage = {
  type: 'CAPTURE_STATUS';
  frameId: string;
  status: 'PREPARING' | 'CAPTURING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';
  stillUrl?: string;
  error?: string;
};

/**
 * Model class definition declared in inference metadata
 */
export interface ModelClassDefinition {
  id: number;
  name: string;
  category?: string;
  color?: string;
  isWall?: boolean;
  isBackground?: boolean;
}

/**
 * Resolved semantic class legend entry for class-mask overlay rendering and toggles
 */
export interface SemanticClassEntry {
  id: number;
  name: string;
  key: 'background' | 'cell-wall' | 'cytoplasm' | 'nucleus' | 'other';
  color: string;
  rgb: { r: number; g: number; b: number };
  isBackground: boolean;
  isWall: boolean;
  defaultVisible: boolean;
}

/**
 * Approximate 4-connected region extracted from a semantic class mask around a clicked pixel.
 * Never represents a verified individual cell or per-cell border.
 */
export interface ApproximateConnectedRegion {
  classId: number;
  seedX: number;
  seedY: number;
  pixelCount: number;
  touchesEdge: boolean;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  regionMask: Uint8Array;
}

/**
 * User click inspection result on a semantic-only class mask
 */
export interface SemanticClickSelection {
  maskX: number;
  maskY: number;
  classId: number;
  classEntry: SemanticClassEntry;
  connectedRegion: ApproximateConnectedRegion | null;
  isClippedBoundary: boolean;
}

/**
 * Real structure prediction returned by OCI compact U-Net segmentation
 */
export interface DetectedStructure {
  id: string;
  classId: number;
  cellId?: number;
  name: string;
  latinName?: string;
  category: string;
  /** Real measured model confidence percentage (0-100), undefined if unmeasured by model */
  confidence?: number;
  pixelCount?: number;
  stainingAffinity?: string;
  morphologicalSummary?: string;
  biologicalFunction?: string;
  keyMolecules?: string[];
  rubricRef?: string;
  color?: string;
  isWall?: boolean;
  /** True when structure boundary reaches the micrograph edge (clipped / partial) */
  isBoundaryIncomplete?: boolean;
  /** Candidate cell IDs for shared boundary walls requiring 2nd click disambiguation */
  candidateSharedCells?: number[];
  /** Associated cell IDs returned by model metadata */
  associatedCellIds?: number[];
}

export type Organelle = DetectedStructure;
export type PredictedCellPart = DetectedStructure;

/**
 * Asynchronous inference job statuses tracked against OCI backend
 */
export type InferenceJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface InferenceJobResponse {
  jobId: string;
  frameId: string;
  status: InferenceJobStatus;
  progressPercent?: number;
  stillImageUrl?: string;
  classMaskUrl?: string;
  cellIdMaskUrl?: string | null;
  detectedStructures?: DetectedStructure[];
  metadata?: {
    frameId?: string;
    modelRevision?: string;
    inferenceTimeMs?: number;
    width: number;
    height: number;
    armArchitecture?: string;
    maskEncoding?: 'raw-uint8' | 'raw-uint16-le' | 'raw-uint16-be' | 'raw-uint32-le' | 'indexed-png' | 'grayscale-png' | 'png' | string;
    classMaskEncoding?: string;
    cellIdMaskEncoding?: string;
    classes?: ModelClassDefinition[];
    classMap?: Record<string | number, ModelClassDefinition | string>;
    classNames?: string[];
    labelMap?: Record<string | number, string>;
    wallAssociations?: Record<string, { wallClassId: number; cellIds: number[] }>;
  };
  error?: string;
}

/**
 * Result of mapping user click on the micrograph into mask pixel coordinates
 */
export interface MaskClickResult {
  maskX: number;
  maskY: number;
  classId: number;
  cellId: number | null;
  hasCellIdMask: boolean;
  structure: DetectedStructure | null;
  isSharedWall: boolean;
  candidateCellIds?: number[];
  isClippedBoundary: boolean;
  isOutOfBounds?: boolean;
}

/**
 * Student observation notebook record
 */
export interface LabObservation {
  id: string;
  slideId: string;
  slideTitle: string;
  organelleId?: string;
  organelleName?: string;
  magnification: number;
  timestamp: string;
  studentNotes: string;
  benchId: string;
  rubricCode: string;
  capturedImageUrl?: string;
}

/**
 * Workstation user profile with verified adult confirmation for Gemini AI chat
 */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  studentId: string;
  benchId: string;
  role: 'Student' | 'Lab Assistant' | 'Instructor';
  avatarColor: string;
  /** Explicit adult (18+) verification for pedagogical AI cytology assistant */
  isAdultConfirmed?: boolean;
}

/**
 * Text-only cytology inquiry chat message
 */
export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  relatedStructure?: string;
}

export interface PreparedSlide {
  id: string;
  index: number;
  title: string;
  shortName: string;
  scientificName: string;
  category: 'Plantae' | 'Animalia' | 'Protista' | 'Histology';
  magnificationDefault: number;
  availableMagnifications: number[];
  stain: string;
  imageUrl: string;
  organelles: DetectedStructure[];
  specimenNotes: string;
  stainingProtocol: string;
  datePrepared: string;
}

export interface PeerStation {
  id: string;
  benchNumber: string;
  students: string;
  status: 'online' | 'broadcasting' | 'idle';
  activeSlide: string;
  magnification: string;
  lastPin: string;
  pingMs: number;
}
