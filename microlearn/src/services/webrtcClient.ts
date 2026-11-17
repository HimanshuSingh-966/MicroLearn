/**
 * Real WebRTC Client for Raspberry Pi 4 Camera & OCI Signaling / coturn TURN Fallback
 *
 * Establishes an RTCPeerConnection to receive the live camera stream encoded
 * by the Raspberry Pi (H.264 / VP8 via libcamera) and creates a bidirectional
 * WebRTC DataChannel ('microscope-control') for still capture commands and status events.
 *
 * Enforces single controlled offer flow (no competing offers) and requires an actual
 * usable Raspberry Pi video track before marking the stream Live.
 */

import {
  MICROSCOPE_CONFIG,
  fetchIceServersWithStatus,
  isWebRtcSignalingConfigured,
} from '../config/microscopeConfig.ts';
import type {
  WebRtcConnectionState,
  DataChannelOutMessage,
  DataChannelInMessage,
} from '../types/microscope.ts';

export interface WebRtcClientCallbacks {
  onTrack?: (stream: MediaStream) => void;
  onConnectionState?: (state: WebRtcConnectionState, message?: string) => void;
  onDataChannelMessage?: (msg: DataChannelInMessage) => void;
  onIceWarning?: (warning: string | null) => void;
}

export class RaspberryPiWebRtcClient {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private mediaStream: MediaStream | null = null;
  private signalingSocket: WebSocket | null = null;
  private connectionState: WebRtcConnectionState = 'idle';
  private callbacks: WebRtcClientCallbacks = {};
  private clientId = `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  private targetPeer = 'rpi4-csi-camera';
  private queuedRemoteCandidates: RTCIceCandidateInit[] = [];
  private pendingCaptures = new Map<
    string,
    {
      resolve: (value: DataChannelInMessage) => void;
      reject: (reason: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(callbacks: WebRtcClientCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public getConnectionState(): WebRtcConnectionState {
    return this.connectionState;
  }

  public getMediaStream(): MediaStream | null {
    return this.mediaStream;
  }

  public isDataChannelOpen(): boolean {
    return this.dataChannel?.readyState === 'open';
  }

  /**
   * Connect to Raspberry Pi WebRTC Stream via OCI Signaling Server
   */
  public async connect(): Promise<void> {
    this.updateState('connecting', 'Connecting to OCI WebRTC signaling...');

    try {
      // 1. Fetch short-lived ICE servers (ephemeral TURN or public STUN) with CORS & clear warning reporting
      const iceResult = await fetchIceServersWithStatus();
      if (this.callbacks.onIceWarning) {
        this.callbacks.onIceWarning(iceResult.warning || null);
      }

      this.peerConnection = new RTCPeerConnection({
        iceServers: iceResult.iceServers,
        iceTransportPolicy: 'all',
      });

      this.mediaStream = new MediaStream();

      // Configure video transceiver for receiving Pi camera frames
      this.peerConnection.addTransceiver('video', { direction: 'recvonly' });

      // Listen for incoming remote video track from Raspberry Pi
      // STRICT REQUIREMENT: Only mark Live once an actual usable video track arrives
      this.peerConnection.ontrack = (event) => {
        const track = event.track;
        if (!track || track.kind !== 'video') return;

        if (event.streams && event.streams[0]) {
          this.mediaStream = event.streams[0];
        } else {
          this.mediaStream = new MediaStream([track]);
        }

        track.onended = () => {
          this.updateState('no-signal', 'Raspberry Pi video track ended');
        };

        track.onmute = () => {
          this.updateState('no-signal', 'Raspberry Pi video track muted / no frames incoming');
        };

        track.onunmute = () => {
          if (track.readyState === 'live') {
            this.updateState('connected', 'Live WebRTC stream established');
            if (this.callbacks.onTrack && this.mediaStream) {
              this.callbacks.onTrack(this.mediaStream);
            }
          }
        };

        // Mark Live only when an actual media track is received and usable (live and unmuted)
        if (track.readyState === 'live' && !track.muted) {
          this.updateState('connected', 'Live WebRTC stream established');
          if (this.callbacks.onTrack && this.mediaStream) {
            this.callbacks.onTrack(this.mediaStream);
          }
        }
      };

      // Handle local ICE candidates: send to signaling server for the Pi peer
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignalingMessage({
            type: 'CANDIDATE',
            candidate: event.candidate.toJSON(),
            sourcePeer: this.clientId,
            targetPeer: this.targetPeer,
          });
        }
      };

      // Track ICE connection state
      this.peerConnection.oniceconnectionstatechange = () => {
        const iceState = this.peerConnection?.iceConnectionState;
        if (iceState === 'connected' || iceState === 'completed') {
          console.info('[WebRTC ICE] ICE connection established:', iceState);
        } else if (iceState === 'disconnected') {
          this.updateState('disconnected', 'WebRTC stream interrupted');
        } else if (iceState === 'failed') {
          this.updateState(
            'no-signal',
            'TURN / ICE candidate negotiation failed. Unable to establish P2P relay with Raspberry Pi.'
          );
        }
      };

      this.peerConnection.onconnectionstatechange = () => {
        const pcState = this.peerConnection?.connectionState;
        if (pcState === 'disconnected' || pcState === 'closed') {
          this.updateState('no-signal', 'Connection to Pi Camera closed');
        } else if (pcState === 'failed') {
          this.updateState(
            'no-signal',
            'WebRTC connection to Pi Camera failed. Verify Pi camera daemon and signaling relay.'
          );
        }
      };

      // 2. Setup DataChannel for Still Capture Commands
      this.setupDataChannel();

      // 3. Connect to OCI Signaling Server (Offer created ONLY once socket is open)
      await this.connectSignaling();
    } catch (err: any) {
      console.warn('[WebRTC] Connection setup failed:', err?.message || err);
      this.updateState(
        'no-signal',
        err?.message || 'Unable to connect to Raspberry Pi 4 camera signaling server.'
      );
    }
  }

  private setupDataChannel() {
    if (!this.peerConnection) return;

    try {
      this.dataChannel = this.peerConnection.createDataChannel('microscope-control', {
        ordered: true,
      });

      this.bindDataChannelEvents(this.dataChannel);

      // Also listen if the remote Raspberry Pi peer creates the channel
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.bindDataChannelEvents(this.dataChannel);
      };
    } catch (err) {
      console.warn('[WebRTC] Could not create DataChannel:', err);
    }
  }

  private bindDataChannelEvents(channel: RTCDataChannel) {
    channel.onopen = () => {
      console.info('[WebRTC DataChannel] microscope-control channel opened');
    };

    channel.onclose = () => {
      console.info('[WebRTC DataChannel] microscope-control channel closed');
    };

    channel.onerror = (err) => {
      console.error('[WebRTC DataChannel] Error:', err);
    };

    channel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as DataChannelInMessage;
        if (this.callbacks.onDataChannelMessage) {
          this.callbacks.onDataChannelMessage(msg);
        }

        // Fulfill pending capture promise
        if (msg.frameId && this.pendingCaptures.has(msg.frameId)) {
          const pending = this.pendingCaptures.get(msg.frameId)!;
          if (msg.status === 'UPLOADED' || msg.status === 'FAILED') {
            clearTimeout(pending.timeoutId);
            this.pendingCaptures.delete(msg.frameId);
            if (msg.status === 'UPLOADED') {
              pending.resolve(msg);
            } else {
              pending.reject(new Error(msg.error || 'Still capture failed on Raspberry Pi'));
            }
          }
        }
      } catch (e) {
        console.warn('[WebRTC DataChannel] Non-JSON message received:', event.data);
      }
    };
  }

  /**
   * Connect to OCI WebRTC Signaling server over WebSocket.
   * Single controlled offer flow: offer is created and dispatched only once signalingSocket is OPEN.
   */
  private async connectSignaling(): Promise<void> {
    return new Promise((resolve) => {
      const url = MICROSCOPE_CONFIG.webrtcSignalingUrl;

      if (!isWebRtcSignalingConfigured(url)) {
        this.updateState(
          'no-signal',
          'OCI WebRTC signaling URL is not configured (VITE_WEBRTC_SIGNALING_URL is missing).'
        );
        resolve();
        return;
      }

      try {
        this.signalingSocket = new WebSocket(url);

        const connectionTimeout = setTimeout(() => {
          if (this.signalingSocket?.readyState !== WebSocket.OPEN) {
            this.signalingSocket?.close();
            this.updateState('no-signal', 'Signaling connection timed out (OCI host unreachable)');
            resolve();
          }
        }, 5000);

        this.signalingSocket.onopen = async () => {
          clearTimeout(connectionTimeout);
          console.info('[Signaling] Connected to OCI WebRTC signaling server');

          // Send subscription request for Raspberry Pi Camera feed
          this.sendSignalingMessage({
            type: 'SUBSCRIBE',
            sourcePeer: this.clientId,
            targetPeer: this.targetPeer,
            deviceType: 'rpi4-csi-camera',
          });

          // Single Controlled Offer Flow: Create WebRTC Offer to receive camera track
          if (this.peerConnection && this.peerConnection.signalingState === 'stable') {
            try {
              const offer = await this.peerConnection.createOffer();
              await this.peerConnection.setLocalDescription(offer);

              this.sendSignalingMessage({
                type: 'OFFER',
                sdp: offer.sdp,
                sourcePeer: this.clientId,
                targetPeer: this.targetPeer,
              });
            } catch (sdpErr) {
              console.warn('[Signaling] Failed to create SDP offer:', sdpErr);
            }
          }

          resolve();
        };

        this.signalingSocket.onmessage = async (event) => {
          try {
            const data = JSON.parse(event.data);

            // Filter messages not meant for this browser peer
            if (data.targetPeer && data.targetPeer !== this.clientId && data.targetPeer !== 'broadcast') {
              return;
            }

            if (data.type === 'ANSWER' && this.peerConnection) {
              await this.peerConnection.setRemoteDescription(
                new RTCSessionDescription({ type: 'answer', sdp: data.sdp })
              );

              // Apply all queued remote candidates now that remote description is set
              while (this.queuedRemoteCandidates.length > 0) {
                const candidate = this.queuedRemoteCandidates.shift()!;
                try {
                  await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (candErr) {
                  console.warn('[WebRTC ICE] Queued candidate apply failed:', candErr);
                }
              }
            } else if (data.type === 'CANDIDATE' && data.candidate && this.peerConnection) {
              if (
                this.peerConnection.remoteDescription &&
                this.peerConnection.remoteDescription.type
              ) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
              } else {
                this.queuedRemoteCandidates.push(data.candidate);
              }
            } else if (
              data.type === 'STATUS' &&
              (data.status === 'CAMERA_OFFLINE' || data.status === 'offline')
            ) {
              this.updateState(
                'no-signal',
                data.message || 'Raspberry Pi Camera is offline at bench. Awaiting live camera stream.'
              );
            }
          } catch (msgErr) {
            console.warn('[Signaling] Error parsing incoming message:', msgErr);
          }
        };

        this.signalingSocket.onerror = () => {
          clearTimeout(connectionTimeout);
          this.updateState(
            'no-signal',
            'No signal from Raspberry Pi 4 camera. Check OCI signaling and Pi camera daemon.'
          );
          resolve();
        };

        this.signalingSocket.onclose = () => {
          clearTimeout(connectionTimeout);
          if (this.connectionState === 'connecting') {
            this.updateState(
              'no-signal',
              'Signaling connection closed. Raspberry Pi stream unavailable.'
            );
          }
        };
      } catch (err: any) {
        console.warn('[Signaling] Could not open WebSocket to', url, err);
        this.updateState(
          'no-signal',
          'OCI WebRTC signaling service not configured or unreachable.'
        );
        resolve();
      }
    });
  }

  private sendSignalingMessage(payload: any) {
    if (this.signalingSocket?.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(JSON.stringify(payload));
    }
  }

  /**
   * Request still image capture from Raspberry Pi Camera via DataChannel
   * The Pi grabs a raw still from libcamera, uploads it directly to OCI over HTTPS,
   * and reports back the uploaded frame URL and status over the DataChannel.
   */
  public async requestStillCapture(frameId: string): Promise<DataChannelInMessage> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error(
        'WebRTC DataChannel to Raspberry Pi 4 is not open. Camera must be in live connected state to capture.'
      );
    }

    const channel = this.dataChannel;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingCaptures.delete(frameId);
        reject(
          new Error(
            `Timed out waiting for Raspberry Pi to capture and upload still frame (${frameId}).`
          )
        );
      }, MICROSCOPE_CONFIG.captureTimeoutMs);

      this.pendingCaptures.set(frameId, { resolve, reject, timeoutId });

      const cmd: DataChannelOutMessage = {
        type: 'CAPTURE_STILL',
        frameId,
        timestamp: Date.now(),
      };

      channel.send(JSON.stringify(cmd));
    });
  }

  private updateState(newState: WebRtcConnectionState, message?: string) {
    this.connectionState = newState;
    if (this.callbacks.onConnectionState) {
      this.callbacks.onConnectionState(newState, message);
    }
  }

  /**
   * Cleanly teardown peer connection and signaling sockets
   */
  public disconnect() {
    // Clear pending capture promises
    for (const [, pending] of this.pendingCaptures) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('WebRTC connection closed by user'));
    }
    this.pendingCaptures.clear();
    this.queuedRemoteCandidates = [];

    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {}
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }

    if (this.signalingSocket) {
      try {
        this.signalingSocket.close();
      } catch {}
      this.signalingSocket = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateState('no-signal', 'Microscope video feed disconnected');
  }
}
