import React, { useState, useRef, useEffect, useCallback } from 'react';
import type {
  UserProfile,
  MicroscopeDesignState,
  MicroscopeStatusChip,
  ChatMessage,
  InferenceJobResponse,
  WebRtcConnectionState,
  SemanticClassEntry,
  SemanticClickSelection,
  UploadedImageAsset,
  OciHealthStatus,
} from '../types/microscope.ts';
import { RaspberryPiWebRtcClient } from '../services/webrtcClient.ts';
import { ociInferenceClient } from '../services/ociInferenceClient.ts';
import { ociChatClient } from '../services/ociChatClient.ts';
import {
  loadLosslessMasks,
  mapScreenToMaskCoords,
  computeContainedImageRect,
  renderSemanticClassOverlay,
  resolveSemanticClasses,
  computeClassPixelStats,
  extractConnectedRegion,
  validateMaskMetadata,
  type LoadedMaskData,
  type ContainedRect,
  type ClassPixelStat,
} from '../utils/maskProcessor.ts';
import { validateInferenceResponse } from '../utils/microscopeLogic.ts';
import {
  MICROSCOPE_CONFIG,
  resolveOciResourceUrl,
  checkOciHealth,
} from '../config/microscopeConfig.ts';
import {
  validateUploadImageFile,
  readFileAsDataUrl,
  formatFileSize,
} from '../utils/imageUpload.ts';
import {
  SemanticClassLegendBar,
  SemanticInspectionPanel,
} from './SemanticMaskPanels.tsx';

interface LiveStageViewProps {
  currentUser: UserProfile;
  status: MicroscopeStatusChip;
  onStatusChange: (status: MicroscopeStatusChip) => void;
}

export const LiveStageView: React.FC<LiveStageViewProps> = ({
  currentUser,
  status: _status,
  onStatusChange,
}) => {
  // Primary Design States: 'live-preview' | 'uploaded-preview' | 'capturing' | 'analyzing' | 'ready-to-inspect' | 'analysis-error' | 'no-signal'
  const [designState, setDesignState] = useState<MicroscopeDesignState>('no-signal');
  const designStateRef = useRef<MicroscopeDesignState>('no-signal');

  // Real WebRTC client reference and stream state
  const webrtcClientRef = useRef<RaspberryPiWebRtcClient | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [_webrtcState, setWebrtcState] = useState<WebRtcConnectionState>('idle');
  const [connectionMessage, setConnectionMessage] = useState<string>('Connecting to Pi Camera...');

  // Contained image rectangle for pixel-perfect mask canvas alignment with letterboxed still
  const [overlayRect, setOverlayRect] = useState<ContainedRect>({ left: 0, top: 0, width: 0, height: 0 });

  // In-flight cancellation, active frame tracking, and last inference input for Retry
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeFrameIdRef = useRef<string | null>(null);
  const lastInferenceInputRef = useRef<{
    frameId: string;
    stillUrl?: string;
    imageBase64?: string;
  } | null>(null);

  // Exact captured or uploaded still image and current frame ID
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [currentFrameId, setCurrentFrameId] = useState<string | null>(null);

  // Optional local uploaded micrograph state
  const [uploadedImage, setUploadedImage] = useState<UploadedImageAsset | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Real OCI inference outputs & backend availability state
  const [activeJob, setActiveJob] = useState<InferenceJobResponse | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [inferenceError, setInferenceError] = useState<string | null>(null);
  const [hasRetryableSource, setHasRetryableSource] = useState<boolean>(false);
  const [ociHealth, setOciHealth] = useState<OciHealthStatus | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState<boolean>(false);
  const [iceWarning, setIceWarning] = useState<string | null>(null);

  // Loaded real pixel class mask buffer
  const [loadedMaskData, setLoadedMaskData] = useState<LoadedMaskData | null>(null);

  // Semantic class-mask legend, overlay visibility toggles, and click inspection state
  const [semanticClasses, setSemanticClasses] = useState<SemanticClassEntry[]>([]);
  const [visibleClassIds, setVisibleClassIds] = useState<Set<number>>(new Set());
  const [classPixelStats, setClassPixelStats] = useState<Record<number, ClassPixelStat>>({});
  const [semanticSelection, setSemanticSelection] = useState<SemanticClickSelection | null>(null);

  // Client-side display filters (pure visual display adjustments, never hardware)
  const [displayFilter, setDisplayFilter] = useState<'normal' | 'inverted' | 'high-contrast'>('normal');

  // Adult 18+ self-confirmation gate for contextual cytology assistant
  const [isAdultConfirmed, setIsAdultConfirmed] = useState<boolean>(() => {
    return (
      currentUser.isAdultConfirmed ??
      (localStorage.getItem('microlearn_18_confirmed') === 'true' ||
        localStorage.getItem('microlearn_adult_verified') === 'true')
    );
  });

  // Contextual Chat (18+) state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);

  // Check whether the Raspberry Pi WebRTC video track is currently live and unmuted
  const isWebRtcVideoTrackUsable = useCallback((): boolean => {
    return Boolean(
      webrtcClientRef.current
        ?.getMediaStream()
        ?.getVideoTracks()
        .some((t) => t.readyState === 'live' && !t.muted)
    );
  }, []);

  // Helper to sync status chip with design state transitions
  const syncDesignState = useCallback(
    (newState: MicroscopeDesignState) => {
      designStateRef.current = newState;
      setDesignState(newState);
      switch (newState) {
        case 'live-preview':
          onStatusChange('Live');
          break;
        case 'capturing':
          onStatusChange('Capturing');
          break;
        case 'analyzing':
          onStatusChange('Analyzing');
          break;
        case 'ready-to-inspect':
          onStatusChange('Ready to inspect');
          break;
        case 'uploaded-preview':
        case 'analysis-error':
          onStatusChange(isWebRtcVideoTrackUsable() ? 'Live' : 'No signal');
          break;
        case 'no-signal':
          onStatusChange('No signal');
          break;
      }
    },
    [onStatusChange, isWebRtcVideoTrackUsable]
  );

  // Clean teardown of in-flight jobs, overlays, selections, uploaded preview, and chat state
  const clearAnalysisAndSessionState = useCallback(() => {
    activeFrameIdRef.current = null;
    lastInferenceInputRef.current = null;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (overlayCanvasRef.current) {
      const ctx = overlayCanvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setOverlayRect({ left: 0, top: 0, width: 0, height: 0 });
    setCapturedImage(null);
    setCurrentFrameId(null);
    setUploadedImage(null);
    setUploadError(null);
    setActiveJob(null);
    setCaptureError(null);
    setInferenceError(null);
    setHasRetryableSource(false);
    setLoadedMaskData(null);
    setSemanticClasses([]);
    setVisibleClassIds(new Set());
    setClassPixelStats({});
    setSemanticSelection(null);
    setChatMessages([]);
    setChatInput('');
    setChatError(null);
    setLastFailedPrompt(null);
    setIsChatLoading(false);
  }, []);

  // Recompute contained image rectangle whenever container resizes or loadedMaskData changes
  const updateOverlayGeometry = useCallback(() => {
    if (!containerRef.current || !loadedMaskData) return;
    const rect = containerRef.current.getBoundingClientRect();
    const contained = computeContainedImageRect(
      rect.width,
      rect.height,
      loadedMaskData.width,
      loadedMaskData.height
    );
    setOverlayRect(contained);
  }, [loadedMaskData]);

  useEffect(() => {
    updateOverlayGeometry();

    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      updateOverlayGeometry();
    });
    observer.observe(containerRef.current);

    window.addEventListener('resize', updateOverlayGeometry);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateOverlayGeometry);
    };
  }, [updateOverlayGeometry, designState]);

  // Semantic class overlay toggle handlers
  const handleToggleSemanticClass = useCallback((classId: number) => {
    setVisibleClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) {
        next.delete(classId);
      } else {
        next.add(classId);
      }
      return next;
    });
  }, []);

  const handleShowAllSemanticClasses = useCallback(() => {
    setVisibleClassIds(new Set(semanticClasses.map((cls) => cls.id)));
  }, [semanticClasses]);

  const handleHideAllSemanticClasses = useCallback(() => {
    setVisibleClassIds(new Set());
  }, []);

  // Probe OCI GET /health to report API or segmentation model unavailability transparently
  const refreshOciHealth = useCallback(async (signal?: AbortSignal) => {
    setIsCheckingHealth(true);
    try {
      const result = await checkOciHealth(undefined, signal);
      if (!signal?.aborted) {
        setOciHealth(result);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setOciHealth({
          checked: true,
          apiAvailable: false,
          modelAvailable: false,
          error: err?.message || 'Unable to verify OCI backend health.',
        });
      }
    } finally {
      if (!signal?.aborted) {
        setIsCheckingHealth(false);
      }
    }
  }, []);

  // Initialize or reconnect WebRTC stream (tears down any stale jobs/overlays/uploads first)
  const connectRaspberryPiWebRtc = useCallback(() => {
    clearAnalysisAndSessionState();
    setIceWarning(null);

    if (webrtcClientRef.current) {
      webrtcClientRef.current.disconnect();
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    onStatusChange('Connecting');
    setConnectionMessage('Establishing WebRTC stream via OCI signaling & coturn TURN...');

    const client = new RaspberryPiWebRtcClient({
      onTrack: (stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setIceWarning(null);
        // Only auto-enter live preview if user is not currently inspecting or previewing a still
        if (designStateRef.current === 'no-signal' || designStateRef.current === 'live-preview') {
          syncDesignState('live-preview');
        }
      },
      onConnectionState: (state, message) => {
        setWebrtcState(state);
        if (message) setConnectionMessage(message);

        if (state === 'connected') {
          if (designStateRef.current === 'no-signal') {
            syncDesignState('live-preview');
          }
        } else if (state === 'no-signal' || state === 'failed') {
          if (
            designStateRef.current === 'live-preview' ||
            designStateRef.current === 'capturing' ||
            designStateRef.current === 'no-signal'
          ) {
            syncDesignState('no-signal');
          }
        }
      },
      onIceWarning: (warning) => {
        setIceWarning(warning);
      },
      onDataChannelMessage: (msg) => {
        console.info('[DataChannel Event from Pi]:', msg);
      },
    });

    webrtcClientRef.current = client;
    client.connect();
  }, [clearAnalysisAndSessionState, onStatusChange, syncDesignState]);

  const disconnectCamera = () => {
    clearAnalysisAndSessionState();
    if (webrtcClientRef.current) {
      webrtcClientRef.current.disconnect();
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    syncDesignState('no-signal');
  };

  // Re-attach live WebRTC MediaStream whenever the <video> element mounts for live-preview
  useEffect(() => {
    if (designState === 'live-preview' && videoRef.current) {
      const stream = webrtcClientRef.current?.getMediaStream() || null;
      if (stream && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
    }
  }, [designState]);

  // Mount effect: connect WebRTC and probe OCI GET /health
  useEffect(() => {
    const healthAbort = new AbortController();
    refreshOciHealth(healthAbort.signal);
    connectRaspberryPiWebRtc();

    return () => {
      healthAbort.abort();
      if (webrtcClientRef.current) {
        webrtcClientRef.current.disconnect();
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [connectRaspberryPiWebRtc, refreshOciHealth]);

  // Shared OCI Inference Pipeline (used by Pi captured stills, uploaded images, and Retry)
  const runInferenceForFrame = useCallback(
    async (input: { frameId: string; stillUrl?: string; imageBase64?: string }) => {
      const { frameId, stillUrl, imageBase64 } = input;

      // Abort any prior pending inference polling
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      activeFrameIdRef.current = frameId;
      lastInferenceInputRef.current = input;
      setHasRetryableSource(Boolean(stillUrl || imageBase64));
      setCurrentFrameId(frameId);
      setActiveJob(null);
      setInferenceError(null);
      setLoadedMaskData(null);
      setSemanticClasses([]);
      setVisibleClassIds(new Set());
      setClassPixelStats({});
      setSemanticSelection(null);
      setChatMessages([]);
      setChatError(null);
      setLastFailedPrompt(null);

      syncDesignState('analyzing');

      try {
        const { jobId } = await ociInferenceClient.submitJob({
          frameId,
          stillUrl,
          imageBase64,
        });

        const completedJob = await ociInferenceClient.pollJob(jobId, {
          signal: abortController.signal,
          onProgress: (progress) => {
            if (activeFrameIdRef.current === frameId) {
              setActiveJob(progress);
            }
          },
        });

        // Discard stale job results if user moved to a different frame or returned to live
        if (activeFrameIdRef.current !== frameId) {
          console.info('[OCI] Discarding stale inference job result for frame:', frameId);
          return;
        }

        // STRICT VALIDATION: Require completed job with valid classMaskUrl and image dimensions
        const validation = validateInferenceResponse(completedJob, frameId);
        if (!validation.isValid) {
          throw new Error(
            validation.error ||
              'Segmentation output unavailable: inference response failed frame or mask validation.'
          );
        }

        if (!completedJob.classMaskUrl || !completedJob.metadata) {
          throw new Error(
            'Segmentation output unavailable: OCI backend completed the job without a valid classMaskUrl or image dimension metadata.'
          );
        }

        const maskVal = validateMaskMetadata({
          actualFrameId: completedJob.metadata.frameId || completedJob.frameId,
          expectedFrameId: frameId,
          expectedWidth: completedJob.metadata.width,
          expectedHeight: completedJob.metadata.height,
          classMaskWidth: completedJob.metadata.width,
          classMaskHeight: completedJob.metadata.height,
          hasCellIdMask: false,
          maskEncoding: completedJob.metadata.classMaskEncoding || completedJob.metadata.maskEncoding,
        });

        if (!maskVal.isValid) {
          throw new Error(maskVal.error || 'Mask metadata validation failed.');
        }

        // Losslessly decode semantic class mask (relative mask URLs resolve against OCI API host via CORS)
        let masks: LoadedMaskData;
        try {
          masks = await loadLosslessMasks({
            frameId,
            classMaskBufferOrUrl: completedJob.classMaskUrl,
            width: completedJob.metadata.width,
            height: completedJob.metadata.height,
            maskEncoding: completedJob.metadata.maskEncoding,
            classMaskEncoding: completedJob.metadata.classMaskEncoding,
          });
        } catch (maskErr: any) {
          throw new Error(`Mask decoding failed: ${maskErr.message}`);
        }

        // Verify frame identity again after async mask fetch/decode
        if (activeFrameIdRef.current !== frameId) {
          return;
        }

        // Resolve semantic class legend & real pixel statistics directly from metadata and decoded class mask
        const resolvedClasses = resolveSemanticClasses(completedJob.metadata, masks.classData);
        const pixelStats = computeClassPixelStats(masks);
        const initialVisible = new Set(
          resolvedClasses.filter((cls) => cls.defaultVisible).map((cls) => cls.id)
        );

        setLoadedMaskData(masks);
        setActiveJob(completedJob);
        setSemanticClasses(resolvedClasses);
        setVisibleClassIds(initialVisible);
        setClassPixelStats(pixelStats);
        setSemanticSelection(null);
        setChatMessages([]);

        // Only enter Ready to Inspect after successful validation and lossless mask decoding
        syncDesignState('ready-to-inspect');
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          console.info('[OCI] Inference polling aborted.');
          return;
        }
        if (activeFrameIdRef.current !== frameId) {
          return;
        }
        console.error('[OCI Inference Failed]:', err);
        // STRICT REQUIREMENT: Exit analyzing cleanly and keep app out of Ready to Inspect on error
        setInferenceError(
          err?.message ||
            'Segmentation output unavailable: compact U-Net inference failed on OCI backend.'
        );
        setLoadedMaskData(null);
        setSemanticClasses([]);
        setVisibleClassIds(new Set());
        setClassPixelStats({});
        setSemanticSelection(null);
        syncDesignState('analysis-error');
      }
    },
    [syncDesignState]
  );

  // Main Action: Capture & Analyze from Raspberry Pi WebRTC DataChannel
  const handleCaptureAndAnalyze = async () => {
    if (designState === 'capturing' || designState === 'analyzing') {
      return; // prevent overlapping / repeated capture requests
    }

    if (!webrtcClientRef.current?.isDataChannelOpen()) {
      setCaptureError(
        'Cannot capture: Raspberry Pi WebRTC DataChannel is not open or camera stream is offline. Connect the Pi Camera before capturing.'
      );
      return;
    }

    // 1. Clear any prior uploaded preview and enter Capturing state
    clearAnalysisAndSessionState();
    syncDesignState('capturing');

    // Generate unique frame identifier
    const frameId = `frame-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    activeFrameIdRef.current = frameId;
    setCurrentFrameId(frameId);

    // 2. Request still capture from Raspberry Pi over DataChannel (30s capture timeout)
    let piStillUrl: string | undefined;
    try {
      const piCaptureResult = await webrtcClientRef.current.requestStillCapture(frameId);
      if (piCaptureResult.status !== 'UPLOADED' || !piCaptureResult.stillUrl) {
        throw new Error(
          piCaptureResult.error ||
            'Raspberry Pi reported capture failed or did not provide uploaded frame URL.'
        );
      }
      piStillUrl = piCaptureResult.stillUrl;
    } catch (captureErr: any) {
      console.error('[Pi Capture Failed]:', captureErr);
      activeFrameIdRef.current = null;
      setCurrentFrameId(null);
      setCaptureError(
        captureErr.message ||
          'Failed to capture still from Raspberry Pi. Ensure Pi camera service and OCI HTTPS upload endpoint are operational.'
      );

      // On capture failure, return to Live ONLY if video track is still live and unmuted
      if (isWebRtcVideoTrackUsable()) {
        syncDesignState('live-preview');
      } else {
        syncDesignState('no-signal');
      }
      return;
    }

    // 3. Resolve relative Pi still URL against configured OCI API host for browser display
    const displayStillUrl = resolveOciResourceUrl(piStillUrl);
    setCapturedImage(displayStillUrl);

    // 4. Submit exact Pi stillUrl to OCI inference job endpoint
    await runInferenceForFrame({
      frameId,
      stillUrl: piStillUrl,
    });
  };

  // Optional Action (Req 2a): Choose local JPEG/PNG image to preview before OCI analysis
  const handleTriggerImageUpload = () => {
    if (designState === 'capturing' || designState === 'analyzing') return;
    fileInputRef.current?.click();
  };

  const handleUploadFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input value so picking the same file again triggers onChange
    e.target.value = '';
    if (!file) return;

    const validation = validateUploadImageFile(file);
    if (!validation.isValid) {
      setUploadError(validation.error || 'Selected image file is not supported.');
      return;
    }

    try {
      // Read original unmodified bytes as base64 Data URL (never resizes or alters microscope imagery)
      const dataUrl = await readFileAsDataUrl(file);

      clearAnalysisAndSessionState();
      setUploadedImage({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        dataUrl,
      });
      setCapturedImage(dataUrl);
      syncDesignState('uploaded-preview');
    } catch (readErr: any) {
      setUploadError(readErr?.message || 'Unable to read the selected image file.');
    }
  };

  const handleAnalyzeUploadedImage = async () => {
    if (!uploadedImage || designState === 'capturing' || designState === 'analyzing') return;

    const frameId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setCapturedImage(uploadedImage.dataUrl);
    await runInferenceForFrame({
      frameId,
      imageBase64: uploadedImage.dataUrl,
    });
  };

  // Retry inference ONLY when the same source image (stillUrl or uploaded imageBase64) is still available
  const handleRetryAnalysis = async () => {
    if (designState === 'capturing' || designState === 'analyzing') return;

    const prev = lastInferenceInputRef.current;
    if (prev && (prev.stillUrl || prev.imageBase64)) {
      const retryFrameId = prev.imageBase64
        ? `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        : prev.frameId;
      await runInferenceForFrame({
        frameId: retryFrameId,
        stillUrl: prev.stillUrl,
        imageBase64: prev.imageBase64,
      });
      return;
    }

    if (uploadedImage?.dataUrl) {
      await handleAnalyzeUploadedImage();
      return;
    }

    setHasRetryableSource(false);
    setInferenceError(
      'Original source image is no longer available for retry. Capture a new still or upload an image to analyze.'
    );
  };

  // Action: Clear uploaded preview/analysis or Return to Live Preview (full clean teardown)
  const handleReturnToLive = () => {
    clearAnalysisAndSessionState();
    if (isWebRtcVideoTrackUsable()) {
      syncDesignState('live-preview');
    } else {
      syncDesignState('no-signal');
    }
  };

  // Viewport Click Handler on Analyzed Image: Semantic Class Mask Inspection Only
  // Identifies the predicted semantic class at pixel coordinates and highlights an approximate
  // connected region when supported. Never claims individual cell identity or assigns shared walls.
  const handleViewportClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (designState !== 'ready-to-inspect' || !loadedMaskData || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const coords = mapScreenToMaskCoords(
      e.clientX,
      e.clientY,
      rect,
      loadedMaskData.width,
      loadedMaskData.height,
      'contain'
    );

    // STRICT REQUIREMENT: If click is in letterbox/pillarbox padding outside rendered image, ignore!
    if (!coords) return;

    const { maskX, maskY } = coords;
    const classId = loadedMaskData.getClassAt(maskX, maskY);
    const classEntry =
      semanticClasses.find((cls) => cls.id === classId) || {
        id: classId,
        name: `Class #${classId}`,
        key: 'other' as const,
        color: '#06b6d4',
        rgb: { r: 6, g: 182, b: 212 },
        isBackground: classId === 0,
        isWall: false,
        defaultVisible: true,
      };

    const isBackgroundClass = (cid: number) =>
      semanticClasses.find((cls) => cls.id === cid)?.isBackground ?? cid === 0;

    const connectedRegion = extractConnectedRegion(
      loadedMaskData,
      maskX,
      maskY,
      isBackgroundClass
    );

    const isClippedBoundary =
      maskX <= 2 ||
      maskX >= loadedMaskData.width - 3 ||
      maskY <= 2 ||
      maskY >= loadedMaskData.height - 3 ||
      Boolean(connectedRegion?.touchesEdge);

    setChatError(null);
    setChatMessages([]);
    setLastFailedPrompt(null);
    setSemanticSelection({
      maskX,
      maskY,
      classId,
      classEntry,
      connectedRegion,
      isClippedBoundary,
    });
  };

  // Re-render semantic mask overlay canvas when mask, geometry, toggles, or selection change
  useEffect(() => {
    if (
      designState !== 'ready-to-inspect' ||
      !overlayCanvasRef.current ||
      !loadedMaskData ||
      overlayRect.width <= 0
    ) {
      return;
    }

    renderSemanticClassOverlay({
      canvas: overlayCanvasRef.current,
      mask: loadedMaskData,
      semanticClasses,
      visibleClassIds,
      connectedRegion: semanticSelection?.connectedRegion || null,
      clickedPoint: semanticSelection
        ? { maskX: semanticSelection.maskX, maskY: semanticSelection.maskY }
        : null,
    });
  }, [
    designState,
    overlayRect.width,
    overlayRect.height,
    loadedMaskData,
    semanticClasses,
    visibleClassIds,
    semanticSelection,
  ]);

  // Contextual Chat (18+) Inquiry Submission (Text-only through OCI backend POST /chat)
  const handleSendChat = async (userText: string) => {
    if (!userText.trim() || designState !== 'ready-to-inspect' || !loadedMaskData) return;

    if (!isAdultConfirmed) {
      setChatError(
        'Self-confirmation of age (18+) is required before sending queries to the Contextual AI Cytology Assistant. Authoritative age verification is enforced by backend services.'
      );
      return;
    }

    const activeTarget =
      semanticSelection && !semanticSelection.classEntry.isBackground
        ? { name: semanticSelection.classEntry.name }
        : undefined;

    const prompt = userText.trim();
    setChatError(null);
    setLastFailedPrompt(prompt);
    setIsChatLoading(true);

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      relatedStructure: activeTarget?.name,
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput('');

    try {
      const history = chatMessages.map((m) => ({
        role: m.sender as 'user' | 'assistant',
        content: m.text,
      }));

      const specimenType = uploadedImage
        ? `Uploaded Micrograph (${uploadedImage.fileName})`
        : 'Microscope Optical Slide';

      const response = await ociChatClient.sendInquiry({
        message: prompt,
        selectedStructure: activeTarget,
        specimenType,
        frameId: currentFrameId || undefined,
        isAdultConfirmed: true,
        history,
      });

      const assistantMessage: ChatMessage = {
        id: `msg-resp-${Date.now()}`,
        sender: 'assistant',
        text: response.text,
        timestamp:
          response.timestamp ||
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        relatedStructure: activeTarget?.name,
      };
      setChatMessages((prev) => [...prev, assistantMessage]);
      setLastFailedPrompt(null);
    } catch (err: any) {
      setChatError(err.message || 'Contextual cytology assistant currently unavailable on OCI.');
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleConfirmAdult = () => {
    setIsAdultConfirmed(true);
    localStorage.setItem('microlearn_18_confirmed', 'true');
    setChatError(null);
  };

  // Client-side Display Filter CSS (Visual Preset Only — never hardware)
  let filterCss = '';
  if (displayFilter === 'inverted') {
    filterCss = 'invert hue-rotate-180 contrast-125';
  } else if (displayFilter === 'high-contrast') {
    filterCss = 'contrast-150 saturate-125';
  }

  // Current State Label Configuration
  const getCurrentStateLabel = () => {
    switch (designState) {
      case 'live-preview':
        return {
          title: 'Live Preview',
          subtitle: 'Raspberry Pi Camera streaming over WebRTC • Focus adjusted manually',
          badgeClass: 'bg-[#22c55e]/15 border-[#22c55e]/30 text-[#15803d] dark:text-[#4ade80]',
          dotClass: 'bg-[#22c55e] animate-ping',
        };
      case 'uploaded-preview':
        return {
          title: 'Uploaded Image',
          subtitle: uploadedImage
            ? `${uploadedImage.fileName} (${formatFileSize(uploadedImage.sizeBytes)}) • Ready to analyze on OCI`
            : 'Local micrograph loaded • Ready to analyze on OCI',
          badgeClass: 'bg-primary/15 border-primary/30 text-primary dark:text-primary-fixed',
          dotClass: 'bg-primary',
        };
      case 'capturing':
        return {
          title: 'Capturing',
          subtitle: 'Raspberry Pi capturing still frame via DataChannel...',
          badgeClass: 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300',
          dotClass: 'bg-amber-500 animate-pulse',
        };
      case 'analyzing':
        return {
          title: 'Analyzing Micrograph',
          subtitle: 'Compact U-Net inference running on OCI ARM VM...',
          badgeClass: 'bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300',
          dotClass: 'bg-blue-500 animate-spin',
        };
      case 'ready-to-inspect':
        return {
          title: 'Ready to Inspect',
          subtitle: 'Semantic class predictions ready • Click image to inspect predicted class',
          badgeClass: 'bg-primary/15 border-primary/30 text-primary dark:text-primary-fixed',
          dotClass: 'bg-primary',
        };
      case 'analysis-error':
        return {
          title: 'Segmentation Unavailable',
          subtitle: 'OCI backend did not return a valid semantic class mask • Retry or clear',
          badgeClass: 'bg-error/15 border-error/30 text-error',
          dotClass: 'bg-error',
        };
      case 'no-signal':
      default:
        return {
          title: 'No Signal',
          subtitle: connectionMessage,
          badgeClass: 'bg-error/15 border-error/30 text-error',
          dotClass: 'bg-error',
        };
    }
  };

  const currentState = getCurrentStateLabel();
  const isPiConnected = isWebRtcVideoTrackUsable();

  return (
    <div className="flex flex-col w-full pb-10">
      {/* Hidden local image upload picker (JPEG/PNG only; original bytes preserved without resizing) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
        onChange={handleUploadFileChange}
        className="hidden"
        data-testid="upload-image-input"
      />

      {/* Stage Instrument Header */}
      <div className="px-4 md:px-8 py-2.5 bg-surface-container-low flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20 shadow-2xs">
        <div className="flex items-center gap-3">
          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-label-md font-bold shadow-2xs ${currentState.badgeClass}`}
          >
            <span className="relative flex h-2 w-2">
              <span className={`relative inline-flex rounded-full h-2 w-2 ${currentState.dotClass}`} />
            </span>
            <span>{currentState.title}</span>
          </div>

          <span className="text-on-surface-variant font-body-sm text-xs hidden sm:inline">
            {currentState.subtitle}
          </span>
        </div>

        {/* Stage Actions: Optional Upload Image + Primary WebRTC Camera Connection */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="upload-image-trigger"
            onClick={handleTriggerImageUpload}
            disabled={designState === 'capturing' || designState === 'analyzing'}
            className="px-3 py-1.5 bg-surface-container hover:bg-surface-container-high disabled:opacity-40 text-on-surface rounded-xl font-label-md text-xs font-semibold transition-colors border border-outline-variant/30 flex items-center gap-1.5"
            title="Upload a local JPEG or PNG micrograph for OCI semantic analysis"
          >
            <span className="material-symbols-outlined text-[16px]">upload_file</span>
            <span>Upload Image</span>
          </button>

          {!isPiConnected && designState !== 'live-preview' ? (
            <button
              onClick={connectRaspberryPiWebRtc}
              className="px-3.5 py-1.5 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-label-md text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all"
            >
              <span className="material-symbols-outlined text-[16px]">videocam</span>
              <span>Connect Pi Camera</span>
            </button>
          ) : (
            <button
              onClick={disconnectCamera}
              className="px-3 py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-error rounded-xl font-label-md text-xs transition-colors border border-outline-variant/30 flex items-center gap-1"
              title="Disconnect Raspberry Pi WebRTC camera stream"
            >
              <span className="material-symbols-outlined text-[16px]">power_settings_new</span>
              <span className="hidden md:inline">Disconnect</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Split Layout: Viewport 70% / Inspection Panel 30% */}
      <div className="px-4 md:px-8 py-4 flex flex-col xl:flex-row gap-5">
        {/* Left Column: Prominent Microscope Viewport */}
        <div className="xl:w-[70%] flex flex-col gap-3">
          {/* Main Optical Canvas Container */}
          <div
            id="camera-viewport-frame"
            ref={containerRef}
            onClick={handleViewportClick}
            className={`relative w-full aspect-[16/10] bg-[#0c120f] rounded-2xl overflow-hidden shadow-xl select-none group border border-surface-container-highest/30 transition-all ${
              designState === 'ready-to-inspect' ? 'cursor-pointer' : 'cursor-default'
            }`}
          >
            {/* 1. Live WebRTC Stream from Raspberry Pi */}
            {designState === 'live-preview' && (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-contain select-none pointer-events-none ${filterCss}`}
              />
            )}

            {/* 2. Still Image Display: Exact captured or uploaded still across preview, analyzing, inspection, and error states */}
            {designState !== 'live-preview' && designState !== 'no-signal' && capturedImage && (
              <img
                src={capturedImage}
                alt={uploadedImage ? `Uploaded micrograph: ${uploadedImage.fileName}` : 'Captured Specimen Still'}
                onLoad={updateOverlayGeometry}
                className={`w-full h-full object-contain select-none pointer-events-none transition-all ${filterCss}`}
              />
            )}

            {/* Mask Overlay Canvas positioned to exact computed image sub-rectangle */}
            {designState === 'ready-to-inspect' && loadedMaskData && overlayRect.width > 0 && (
              <canvas
                ref={overlayCanvasRef}
                data-testid="mask-overlay-canvas"
                style={{
                  position: 'absolute',
                  left: `${overlayRect.left}px`,
                  top: `${overlayRect.top}px`,
                  width: `${overlayRect.width}px`,
                  height: `${overlayRect.height}px`,
                  imageRendering: 'pixelated',
                }}
                className="pointer-events-none z-10"
              />
            )}

            {/* Optical Field Vignette and Lens Ring */}
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_55%,rgba(12,18,15,0.75)_100%)]" />
            <div className="absolute inset-4 rounded-full pointer-events-none opacity-20 border-[1.5px] border-surface-container-lowest" />

            {/* Top Status HUD Badges */}
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none z-20">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#111613]/85 backdrop-blur-md text-surface-bright font-metric-reticle text-[11px] tracking-wider shadow-sm border border-white/10">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      designState === 'live-preview'
                        ? 'bg-[#22c55e] animate-ping'
                        : designState === 'uploaded-preview'
                        ? 'bg-primary'
                        : designState === 'capturing'
                        ? 'bg-amber-400 animate-pulse'
                        : designState === 'analyzing'
                        ? 'bg-blue-400 animate-spin'
                        : designState === 'ready-to-inspect'
                        ? 'bg-primary'
                        : 'bg-error'
                    }`}
                  />
                  <span className="font-bold uppercase tracking-wider text-xs">
                    {designState === 'live-preview'
                      ? 'WEBRTC PI CAMERA'
                      : designState === 'uploaded-preview'
                      ? `UPLOADED [${uploadedImage?.fileName || 'LOCAL STILL'}]`
                      : designState === 'capturing'
                      ? 'PI CAPTURING STILL'
                      : designState === 'analyzing'
                      ? 'OCI U-NET ANALYZING'
                      : designState === 'ready-to-inspect'
                      ? `STILL [${currentFrameId || 'FRAME'}]`
                      : designState === 'analysis-error'
                      ? 'SEGMENTATION UNAVAILABLE'
                      : 'NO SIGNAL'}
                  </span>
                </span>
              </div>

              {/* Requirement: Show click guidance ONLY after still image is captured/uploaded & analyzed */}
              {designState === 'ready-to-inspect' && !semanticSelection && (
                <div className="flex items-center animate-fade-in">
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-surface-container-lowest/95 backdrop-blur-md text-primary font-label-md text-xs shadow-md border border-primary/30 font-bold">
                    <span>Click image to inspect predicted class</span>
                  </span>
                </div>
              )}
            </div>

            {/* CAPTURING STATE OVERLAY */}
            {designState === 'capturing' && (
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center bg-black/50 backdrop-blur-xs z-30 animate-fade-in">
                <div className="bg-[#111613]/90 border border-amber-500/40 rounded-2xl p-5 text-center shadow-2xl flex flex-col items-center gap-3 max-w-sm mx-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-400 animate-pulse">
                    <span className="material-symbols-outlined text-[28px]">photo_camera</span>
                  </div>
                  <div>
                    <h4 className="font-headline-sm text-surface-bright font-bold text-base">
                      Capturing Micrograph
                    </h4>
                    <p className="font-body-sm text-surface-variant text-xs mt-1">
                      Raspberry Pi is taking a raw frame capture and uploading directly to OCI over HTTPS.
                    </p>
                  </div>
                  <span className="font-metric-reticle text-[10px] text-amber-400">
                    Frame: {currentFrameId}
                  </span>
                </div>
              </div>
            )}

            {/* ANALYZING STATE SCANNING OVERLAY */}
            {designState === 'analyzing' && (
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center bg-black/40 backdrop-blur-xs z-30 animate-fade-in">
                <div className="bg-[#111613]/90 border border-primary/40 rounded-2xl p-5 text-center shadow-2xl flex flex-col items-center gap-3 max-w-sm mx-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center text-primary-fixed animate-spin">
                    <span className="material-symbols-outlined text-[28px]">psychology</span>
                  </div>
                  <div>
                    <h4 className="font-headline-sm text-surface-bright font-bold text-base">
                      Analyzing Micrograph on OCI
                    </h4>
                    <p className="font-body-sm text-surface-variant text-xs mt-1">
                      Executing compact U-Net segmentation queue on ARM VM (Ampere Altra).
                    </p>
                  </div>
                  <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-fixed rounded-full transition-all duration-300"
                      style={{ width: `${activeJob?.progressPercent || 40}%` }}
                    />
                  </div>
                  <span className="font-metric-reticle text-[10px] text-surface-variant">
                    Job: {activeJob?.jobId || 'Submitting to OCI...'}
                  </span>
                </div>
              </div>
            )}

            {/* NO SIGNAL STATE OVERLAY */}
            {designState === 'no-signal' && (
              <div
                id="camera-disconnect-overlay"
                className="absolute inset-0 bg-[#0c120f]/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-30"
              >
                <div className="w-16 h-16 rounded-2xl bg-error/20 flex items-center justify-center mb-3 text-error shadow-md border border-error/30 animate-pulse">
                  <span className="material-symbols-outlined text-[36px]">videocam_off</span>
                </div>
                <h3 className="font-headline-sm text-surface-bright font-bold mb-1 text-lg">
                  Raspberry Pi Camera Stream Offline
                </h3>
                <p className="font-body-sm text-surface-variant max-w-md mb-5 text-xs sm:text-sm">
                  The WebRTC camera stream from the Raspberry Pi 4 is disconnected.
                  Live streaming requires the Pi camera daemon and OCI signaling/coturn service, or you can upload a local micrograph for OCI analysis.
                </p>

                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    onClick={connectRaspberryPiWebRtc}
                    className="px-5 py-2.5 bg-primary text-on-primary rounded-xl font-label-md font-semibold hover:bg-primary-container shadow-lg flex items-center gap-2 transition-all active:scale-95 text-sm"
                  >
                    <span className="material-symbols-outlined text-[18px]">sync</span>
                    <span>Connect / Retry WebRTC Stream</span>
                  </button>
                </div>

                <div className="mt-4 font-metric-reticle text-[11px] text-surface-variant flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-error" />
                  <span>
                    Signaling: {MICROSCOPE_CONFIG.webrtcSignalingUrl || 'Not configured (VITE_WEBRTC_SIGNALING_URL)'}
                  </span>
                </div>

                {iceWarning && (
                  <p
                    data-testid="ice-server-warning"
                    className="mt-2 max-w-md text-[11px] text-amber-300 font-body-sm bg-amber-500/10 border border-amber-400/30 rounded-xl px-3 py-1.5"
                  >
                    {iceWarning}
                  </p>
                )}
              </div>
            )}

            {/* Bottom Viewport HUD Controls */}
            {designState !== 'no-signal' && (
              <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between pointer-events-none z-20">
                {/* Visual Display Filter ONLY (Client-Side Display Adjustment - Never controls camera or specimen) */}
                <div className="pointer-events-auto flex items-center gap-1.5 bg-[#111613]/85 backdrop-blur-md p-1.5 rounded-2xl shadow-xl border border-white/10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const modes: Array<'normal' | 'inverted' | 'high-contrast'> = [
                        'normal',
                        'inverted',
                        'high-contrast',
                      ];
                      const next = modes[(modes.indexOf(displayFilter) + 1) % modes.length];
                      setDisplayFilter(next);
                    }}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors border border-white/10 ${
                      displayFilter !== 'normal'
                        ? 'bg-primary text-on-primary'
                        : 'bg-[#242f29] hover:bg-surface-container-highest text-surface-bright'
                    }`}
                    title={`Visual Contrast Filter: ${displayFilter} (Client-Side Display Adjustment Only - Does Not Adjust Specimen or Hardware)`}
                    aria-label="Toggle visual display contrast"
                  >
                    <span className="material-symbols-outlined text-[18px]">contrast</span>
                  </button>
                </div>

                {/* Primary Action Buttons */}
                <div className="pointer-events-auto flex items-center gap-2">
                  {designState === 'live-preview' || designState === 'capturing' ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCaptureAndAnalyze();
                      }}
                      disabled={designState === 'capturing'}
                      className="px-5 py-2.5 bg-primary text-on-primary hover:bg-primary-container disabled:opacity-50 rounded-2xl font-label-md font-bold text-xs sm:text-sm shadow-xl flex items-center gap-2 transition-all active:scale-95 border border-primary-fixed/40"
                      title="Request still capture from Raspberry Pi via DataChannel and submit to OCI U-Net"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {designState === 'capturing' ? 'hourglass_top' : 'photo_camera'}
                      </span>
                      <span>{designState === 'capturing' ? 'Capturing...' : 'Capture & Analyze'}</span>
                    </button>
                  ) : designState === 'uploaded-preview' ? (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTriggerImageUpload();
                        }}
                        className="px-3.5 py-2 bg-[#111613]/85 hover:bg-black text-surface-bright rounded-2xl font-label-md font-semibold text-xs shadow-xl flex items-center gap-1.5 transition-all border border-white/15 backdrop-blur-md"
                      >
                        <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                        <span>Replace</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReturnToLive();
                        }}
                        className="px-3.5 py-2 bg-[#111613]/85 hover:bg-black text-surface-bright rounded-2xl font-label-md font-semibold text-xs shadow-xl flex items-center gap-1.5 transition-all border border-white/15 backdrop-blur-md"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                        <span>Clear</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAnalyzeUploadedImage();
                        }}
                        className="px-5 py-2.5 bg-primary text-on-primary hover:bg-primary-container rounded-2xl font-label-md font-bold text-xs sm:text-sm shadow-xl flex items-center gap-2 transition-all active:scale-95 border border-primary-fixed/40"
                      >
                        <span className="material-symbols-outlined text-[18px]">psychology</span>
                        <span>Analyze Uploaded Image</span>
                      </button>
                    </>
                  ) : designState === 'analysis-error' ? (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReturnToLive();
                        }}
                        className="px-4 py-2 bg-surface-container-lowest/90 hover:bg-surface-container-lowest text-primary rounded-2xl font-label-md font-semibold text-xs shadow-xl flex items-center gap-2 transition-all active:scale-95 border border-primary/30 backdrop-blur-md"
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {isPiConnected ? 'videocam' : 'close'}
                        </span>
                        <span>{isPiConnected ? 'Return to Live' : 'Clear Image'}</span>
                      </button>
                      {hasRetryableSource && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRetryAnalysis();
                          }}
                          className="px-4 py-2 bg-error text-white hover:bg-error/90 rounded-2xl font-label-md font-bold text-xs shadow-xl flex items-center gap-1.5 transition-all active:scale-95"
                        >
                          <span className="material-symbols-outlined text-[16px]">refresh</span>
                          <span>Retry Analysis</span>
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReturnToLive();
                      }}
                      className="px-4 py-2 bg-surface-container-lowest/90 hover:bg-surface-container-lowest text-primary rounded-2xl font-label-md font-semibold text-xs shadow-xl flex items-center gap-2 transition-all active:scale-95 border border-primary/30 backdrop-blur-md"
                      title={
                        isPiConnected
                          ? 'Return to live Raspberry Pi WebRTC feed'
                          : 'Clear analyzed micrograph'
                      }
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {isPiConnected ? 'videocam' : 'close'}
                      </span>
                      <span>{isPiConnected ? 'Return to Live' : 'Clear Analysis'}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Under-Viewport Semantic Class Legend & Overlay Controls */}
          {designState === 'ready-to-inspect' && loadedMaskData && semanticClasses.length > 0 && (
            <SemanticClassLegendBar
              semanticClasses={semanticClasses}
              visibleClassIds={visibleClassIds}
              classPixelStats={classPixelStats}
              onToggleClass={handleToggleSemanticClass}
              onShowAll={handleShowAllSemanticClasses}
              onHideAll={handleHideAllSemanticClasses}
            />
          )}

          {/* OCI Backend / Model Health Availability Alert (GET /health) */}
          {ociHealth && (!ociHealth.apiAvailable || !ociHealth.modelAvailable) && (
            <div
              data-testid="oci-health-unavailable"
              className="p-3.5 bg-amber-500/15 border border-amber-500/35 rounded-2xl flex items-center justify-between gap-3 text-xs text-amber-800 dark:text-amber-300"
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0">cloud_off</span>
                <span>
                  {ociHealth.error ||
                    (!ociHealth.apiAvailable
                      ? 'OCI backend API is currently unavailable.'
                      : 'OCI segmentation model is currently unavailable.')}
                </span>
              </div>
              <button
                type="button"
                disabled={isCheckingHealth}
                onClick={() => refreshOciHealth()}
                className="px-3 py-1 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors shrink-0"
              >
                {isCheckingHealth ? 'Checking...' : 'Recheck'}
              </button>
            </div>
          )}

          {/* Local Upload Validation Error Notification */}
          {uploadError && (
            <div className="p-3.5 bg-error/15 border border-error/30 rounded-2xl flex items-center justify-between gap-3 text-xs text-error">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                <span>{uploadError}</span>
              </div>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                className="px-3 py-1 bg-error text-white rounded-lg font-semibold hover:bg-error/90 transition-colors shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Capture Error Notification */}
          {captureError && (
            <div className="p-3.5 bg-error/15 border border-error/30 rounded-2xl flex items-center justify-between gap-3 text-xs text-error">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                <span>{captureError}</span>
              </div>
              <button
                onClick={handleCaptureAndAnalyze}
                className="px-3 py-1 bg-error text-white rounded-lg font-semibold hover:bg-error/90 transition-colors shrink-0"
              >
                Retry Capture
              </button>
            </div>
          )}

          {/* Inference / Mask Error Notification */}
          {inferenceError && (
            <div className="p-3.5 bg-error/15 border border-error/30 rounded-2xl flex items-center justify-between gap-3 text-xs text-error">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                <span>{inferenceError}</span>
              </div>
              {hasRetryableSource && (
                <button
                  onClick={handleRetryAnalysis}
                  className="px-3 py-1 bg-error text-white rounded-lg font-semibold hover:bg-error/90 transition-colors shrink-0"
                >
                  Retry Analysis
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Semantic Prediction Panel, Upload Preview, Error Card, & Contextual Chat */}
        <div className="xl:w-[30%] flex flex-col gap-4">
          {designState === 'ready-to-inspect' && loadedMaskData ? (
            <>
              <SemanticInspectionPanel
                currentFrameId={currentFrameId}
                loadedMaskData={loadedMaskData}
                semanticClasses={semanticClasses}
                visibleClassIds={visibleClassIds}
                classPixelStats={classPixelStats}
                semanticSelection={semanticSelection}
                onToggleClass={handleToggleSemanticClass}
                onClearSelection={() => {
                  setSemanticSelection(null);
                  setChatMessages([]);
                  setChatError(null);
                  setLastFailedPrompt(null);
                }}
                onClearRegionHighlight={() =>
                  setSemanticSelection((prev) =>
                    prev ? { ...prev, connectedRegion: null } : null
                  )
                }
              />

              {/* Contextual AI Chat (18+ strictly enforced; text-only via OCI POST /chat) */}
              <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/20 flex flex-col gap-3 animate-fade-in">
                <div className="flex items-center justify-between pb-2 border-b border-surface-container-high">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">smart_toy</span>
                    <div>
                      <h3 className="font-headline-sm text-xs font-bold text-on-surface flex items-center gap-1.5">
                        <span>Contextual AI Lab Assistant</span>
                        <span className="text-[10px] px-1.5 py-0.2 bg-secondary/20 text-secondary-dark dark:text-secondary rounded font-metric-reticle font-bold">
                          18+ self-confirmed
                        </span>
                      </h3>
                      <p className="text-[10px] text-on-surface-variant">
                        {semanticSelection && !semanticSelection.classEntry.isBackground ? (
                          <>
                            Inquiring about predicted{' '}
                            <strong className="text-primary">{semanticSelection.classEntry.name}</strong> • Text-only inquiry
                          </>
                        ) : (
                          'Text-only cytology inquiry via OCI backend (click image to include predicted class context)'
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                {!isAdultConfirmed ? (
                  <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/20 flex flex-col gap-3 text-xs">
                    <div className="flex items-start gap-2 text-on-surface">
                      <span className="material-symbols-outlined text-amber-500 text-[20px] shrink-0">
                        verified_user
                      </span>
                      <div>
                        <span className="font-label-md font-bold block">Age Self-Confirmation Required (18+)</span>
                        <span className="text-on-surface-variant text-[11px] leading-relaxed">
                          In accordance with laboratory safety standards, the Contextual AI Cytology Assistant is restricted to adult students and researchers aged 18 or older. Authoritative age verification is enforced by backend services.
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={handleConfirmAdult}
                      className="w-full py-2 bg-primary text-on-primary rounded-xl font-label-md font-semibold text-xs shadow-xs hover:bg-primary-container transition-colors"
                    >
                      I confirm I am 18 years or older
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1 text-xs font-body-sm">
                      {chatMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`p-2.5 rounded-xl ${
                            msg.sender === 'user'
                              ? 'bg-primary text-on-primary ml-4 self-end'
                              : 'bg-surface-container text-on-surface mr-4 self-start border border-outline-variant/20'
                          }`}
                        >
                          <p className="leading-relaxed">{msg.text}</p>
                        </div>
                      ))}

                      {isChatLoading && (
                        <div className="p-2.5 rounded-xl bg-surface-container text-on-surface mr-4 self-start border border-outline-variant/20 flex items-center gap-2 text-xs text-on-surface-variant">
                          <span className="material-symbols-outlined text-[16px] animate-spin text-primary">
                            sync
                          </span>
                          <span>
                            Consulting OCI cytology assistant
                            {semanticSelection && !semanticSelection.classEntry.isBackground
                              ? ` for ${semanticSelection.classEntry.name}`
                              : ''}
                            ...
                          </span>
                        </div>
                      )}
                    </div>

                    {chatError && (
                      <div className="bg-error/10 border border-error/30 rounded-xl p-3 flex flex-col gap-2 text-xs">
                        <div className="flex items-start gap-1.5 text-error">
                          <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">error</span>
                          <span className="leading-tight">{chatError}</span>
                        </div>
                        {lastFailedPrompt && (
                          <div className="flex justify-end">
                            <button
                              onClick={() => handleSendChat(lastFailedPrompt)}
                              className="px-3 py-1 bg-error text-white hover:bg-error/90 rounded-lg font-label-sm font-semibold flex items-center gap-1 transition-all text-xs"
                            >
                              <span className="material-symbols-outlined text-[14px]">refresh</span>
                              <span>Retry</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSendChat(chatInput);
                      }}
                      className="flex items-center gap-2 pt-1 border-t border-surface-container-high"
                    >
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder={
                          semanticSelection && !semanticSelection.classEntry.isBackground
                            ? `Ask about ${semanticSelection.classEntry.name}...`
                            : 'Ask a text-only cytology question...'
                        }
                        className="flex-1 bg-surface-container-low rounded-xl px-3 py-2 text-xs text-on-surface placeholder:text-outline border border-outline-variant/30 focus:outline-none focus:border-primary"
                      />
                      <button
                        type="submit"
                        disabled={isChatLoading || !chatInput.trim()}
                        className="w-8 h-8 rounded-xl bg-primary text-on-primary hover:bg-primary-container disabled:opacity-40 flex items-center justify-center transition-all shadow-xs"
                        title="Send inquiry (text only)"
                      >
                        <span className="material-symbols-outlined text-[16px]">send</span>
                      </button>
                    </form>
                  </>
                )}
              </div>
            </>
          ) : designState === 'uploaded-preview' && uploadedImage ? (
            /* Uploaded Local Micrograph Preview Panel */
            <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-outline-variant/20 flex flex-col gap-4 animate-fade-in">
              <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-[26px]">image</span>
              </div>
              <div>
                <h3 className="font-headline-sm text-base text-on-surface font-bold">
                  Uploaded Micrograph Preview
                </h3>
                <p className="font-body-sm text-xs text-on-surface-variant mt-1 leading-relaxed">
                  Review your local image in the viewport before submitting it to the OCI compact U-Net segmentation service. Original image pixels are sent unmodified.
                </p>
              </div>

              <div className="bg-surface-container-low p-3.5 rounded-xl border border-outline-variant/20 flex flex-col gap-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-on-surface-variant">File</span>
                  <span className="font-metric-reticle font-semibold text-on-surface truncate max-w-[180px]" title={uploadedImage.fileName}>
                    {uploadedImage.fileName}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-on-surface-variant">Format</span>
                  <span className="font-metric-reticle text-on-surface">{uploadedImage.mimeType}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-on-surface-variant">Size</span>
                  <span className="font-metric-reticle text-on-surface">
                    {formatFileSize(uploadedImage.sizeBytes)}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleAnalyzeUploadedImage}
                  className="w-full py-2.5 bg-primary text-on-primary rounded-xl font-label-md font-semibold text-xs shadow-xs hover:bg-primary-container transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[16px]">psychology</span>
                  <span>Analyze Uploaded Image</span>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleTriggerImageUpload}
                    className="py-2 bg-surface-container hover:bg-surface-container-high text-on-surface rounded-xl font-label-md font-semibold text-xs border border-outline-variant/30 transition-colors"
                  >
                    Replace Image
                  </button>
                  <button
                    type="button"
                    onClick={handleReturnToLive}
                    className="py-2 bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-error rounded-xl font-label-md font-semibold text-xs border border-outline-variant/30 transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          ) : designState === 'analysis-error' ? (
            /* Segmentation Unavailable / Error Right Panel */
            <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-error/30 flex flex-col gap-4 animate-fade-in">
              <div className="w-12 h-12 rounded-xl bg-error/15 flex items-center justify-center text-error">
                <span className="material-symbols-outlined text-[26px]">error_outline</span>
              </div>
              <div>
                <h3 className="font-headline-sm text-base text-on-surface font-bold">
                  Segmentation Output Unavailable
                </h3>
                <p className="font-body-sm text-xs text-on-surface-variant mt-1 leading-relaxed">
                  {inferenceError ||
                    'The OCI backend did not return a valid semantic class mask and dimension metadata for this frame. Inspection remains disabled until valid mask output is received.'}
                </p>
              </div>

              {currentFrameId && (
                <div className="bg-surface-container-low px-3 py-2 rounded-xl border border-outline-variant/20 flex items-center justify-between text-[11px]">
                  <span className="text-on-surface-variant">Frame ID</span>
                  <span className="font-metric-reticle text-on-surface">{currentFrameId}</span>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {hasRetryableSource && (
                  <button
                    type="button"
                    onClick={handleRetryAnalysis}
                    className="w-full py-2.5 bg-error text-white hover:bg-error/90 rounded-xl font-label-md font-semibold text-xs shadow-xs transition-colors flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[16px]">refresh</span>
                    <span>Retry Analysis</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleReturnToLive}
                  className="w-full py-2 bg-surface-container hover:bg-surface-container-high text-on-surface-variant rounded-xl font-label-md font-semibold text-xs border border-outline-variant/30 transition-colors"
                >
                  {isPiConnected ? 'Return to Live' : 'Clear Image'}
                </button>
              </div>
            </div>
          ) : designState === 'analyzing' || designState === 'capturing' ? (
            /* Analyzing / Capturing State Right Panel */
            <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-outline-variant/20 flex flex-col gap-4 animate-fade-in">
              <div className="w-12 h-12 rounded-xl bg-blue-500/15 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <span className="material-symbols-outlined text-[26px] animate-spin">
                  {designState === 'capturing' ? 'photo_camera' : 'psychology'}
                </span>
              </div>
              <div>
                <h3 className="font-headline-sm text-base text-on-surface font-bold">
                  {designState === 'capturing' ? 'Capturing Still Frame' : 'Inference in Progress'}
                </h3>
                <p className="font-body-sm text-xs text-on-surface-variant mt-1 leading-relaxed">
                  {designState === 'capturing'
                    ? 'Raspberry Pi is grabbing a raw still from libcamera and uploading to OCI over HTTPS.'
                    : 'Executing compact U-Net semantic segmentation on OCI ARM VM (Ampere Altra).'}
                </p>
              </div>

              <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/20 flex flex-col gap-2 text-xs">
                <div className="flex justify-between items-center text-on-surface font-label-md">
                  <span>Job Status</span>
                  <span className="font-metric-reticle font-bold text-blue-600 dark:text-blue-400">
                    {designState === 'capturing' ? 'CAPTURING' : activeJob?.status || 'QUEUED'}
                  </span>
                </div>
                <div className="w-full bg-white/20 dark:bg-black/20 h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 dark:bg-blue-400 rounded-full transition-all duration-300"
                    style={{ width: `${designState === 'capturing' ? 20 : activeJob?.progressPercent || 40}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-on-surface-variant font-metric-reticle">
                  <span>Frame: {currentFrameId}</span>
                  <span>{designState === 'capturing' ? 'Uploading' : `${activeJob?.progressPercent || 40}%`}</span>
                </div>
              </div>

              <p className="font-body-sm text-[11px] text-on-surface-variant leading-normal">
                Still frame is held on screen. Semantic class masks will bind to this exact frame once OCI returns valid mask output.
              </p>
            </div>
          ) : designState === 'live-preview' ? (
            /* Live Preview Right Panel: Purposeful Stage Guide */
            <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-outline-variant/20 flex flex-col gap-4 animate-fade-in">
              <div className="w-12 h-12 rounded-xl bg-[#22c55e]/15 flex items-center justify-center text-[#15803d] dark:text-[#4ade80]">
                <span className="material-symbols-outlined text-[26px]">videocam</span>
              </div>
              <div>
                <h3 className="font-headline-sm text-base text-on-surface font-bold">
                  Live Raspberry Pi WebRTC Feed
                </h3>
                <p className="font-body-sm text-xs text-on-surface-variant mt-1 leading-relaxed">
                  Specimen is placed physically on the microscope stage under mechanical stage clips.
                </p>
              </div>

              <div className="bg-surface-container-low p-3.5 rounded-xl border border-outline-variant/20 flex flex-col gap-2.5 text-xs">
                <div className="flex items-start gap-2 text-on-surface">
                  <span className="material-symbols-outlined text-primary text-[18px] shrink-0 mt-0.5">
                    tune
                  </span>
                  <div>
                    <span className="font-label-md font-semibold block">Manual Optical Focus</span>
                    <span className="text-on-surface-variant text-[11px]">
                      Turn the physical coarse and fine focus knobs on the microscope body to bring specimen cells into focus.
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-2 text-on-surface pt-1 border-t border-surface-container-high">
                  <span className="material-symbols-outlined text-primary text-[18px] shrink-0 mt-0.5">
                    photo_camera
                  </span>
                  <div>
                    <span className="font-label-md font-semibold block">Capture & Analyze</span>
                    <span className="text-on-surface-variant text-[11px]">
                      When the view is clear, click <strong>Capture & Analyze</strong> to freeze the frame, send capture commands over DataChannel, and run U-Net segmentation on OCI.
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-primary/10 border border-primary/20 rounded-xl flex items-center gap-2 text-xs text-primary">
                <span className="material-symbols-outlined text-[18px] shrink-0">info</span>
                <span>Contextual AI cytology analysis unlocks once a still frame is captured and analyzed.</span>
              </div>
            </div>
          ) : (
            /* No Signal / Disconnected Right Panel */
            <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-outline-variant/20 flex flex-col gap-4">
              <div className="w-12 h-12 rounded-xl bg-error/15 flex items-center justify-center text-error">
                <span className="material-symbols-outlined text-[26px]">cable</span>
              </div>
              <div>
                <h3 className="font-headline-sm text-base text-on-surface font-bold">
                  Camera Link Inactive
                </h3>
                <p className="font-body-sm text-xs text-on-surface-variant mt-1 leading-relaxed">
                  Connect to the Raspberry Pi 4 camera module via WebRTC to view the live optical feed, or upload a local JPEG/PNG micrograph to run OCI segmentation.
                </p>
              </div>
              {iceWarning && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                  {iceWarning}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  onClick={connectRaspberryPiWebRtc}
                  className="w-full py-2.5 bg-primary text-on-primary rounded-xl font-label-md font-semibold text-xs shadow-xs hover:bg-primary-container transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[16px]">videocam</span>
                  <span>Establish WebRTC Connection</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
