#!/usr/bin/env python3
"""MicroLearn Raspberry Pi camera peer for OCI signaling and browser WebRTC."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
from dataclasses import dataclass
from io import BytesIO
from typing import Any
from urllib.parse import urljoin, urlparse

import aiohttp
from aiortc import (
    RTCConfiguration,
    RTCIceCandidate,
    RTCIceServer,
    RTCPeerConnection,
    RTCSessionDescription,
    VideoStreamTrack,
)
from aiortc.sdp import candidate_from_sdp
from av import VideoFrame
from picamera2 import Picamera2

LOG = logging.getLogger("microlearn-pi")
API_BASE = os.environ.get("MICROLEARN_API_BASE_URL", "").strip().rstrip("/")
PEER_ID = os.environ.get("MICROLEARN_PEER_ID", "rpi4-csi-camera").strip()
PREVIEW_WIDTH = int(os.environ.get("CAMERA_PREVIEW_WIDTH", "640"))
PREVIEW_HEIGHT = int(os.environ.get("CAMERA_PREVIEW_HEIGHT", "480"))
PREVIEW_FPS = int(os.environ.get("CAMERA_PREVIEW_FPS", "15"))
MAX_STILL_BYTES = int(os.environ.get("MAX_STILL_BYTES", str(12 * 1024 * 1024)))


@dataclass
class Camera:
    camera: Picamera2
    still_config: Any
    lock: asyncio.Lock

    @classmethod
    def open(cls) -> "Camera":
        camera = Picamera2()
        video_config = camera.create_video_configuration(
            main={"size": (PREVIEW_WIDTH, PREVIEW_HEIGHT), "format": "RGB888"},
            controls={"FrameRate": PREVIEW_FPS},
            buffer_count=4,
        )
        still_config = camera.create_still_configuration()
        camera.configure(video_config)
        camera.start()
        LOG.info("Camera started: preview %dx%d @ %d fps; still uses camera still mode", PREVIEW_WIDTH, PREVIEW_HEIGHT, PREVIEW_FPS)
        return cls(camera=camera, still_config=still_config, lock=asyncio.Lock())

    def _capture_preview(self):
        # Picamera2 RGB888 arrays are byte-ordered B,G,R; aiortc receives bgr24.
        return self.camera.capture_array("main")

    async def preview_frame(self):
        async with self.lock:
            return await asyncio.to_thread(self._capture_preview)

    def _capture_still(self) -> bytes:
        output = BytesIO()
        self.camera.switch_mode_and_capture_file(self.still_config, output, format="jpeg")
        return output.getvalue()

    async def still_jpeg(self) -> bytes:
        async with self.lock:
            return await asyncio.to_thread(self._capture_still)

    async def close(self) -> None:
        async with self.lock:
            await asyncio.to_thread(self.camera.stop)
            await asyncio.to_thread(self.camera.close)


class PiVideoTrack(VideoStreamTrack):
    def __init__(self, camera: Camera):
        super().__init__()
        self.camera = camera

    async def recv(self) -> VideoFrame:
        pts, time_base = await self.next_timestamp()
        pixels = await self.camera.preview_frame()
        frame = VideoFrame.from_ndarray(pixels, format="bgr24")
        frame.pts = pts
        frame.time_base = time_base
        return frame


def send_data(channel, message: dict[str, Any]) -> None:
    if channel.readyState == "open":
        channel.send(json.dumps(message))


async def upload_still(session: aiohttp.ClientSession, frame_id: str, jpeg: bytes) -> str:
    if len(jpeg) > MAX_STILL_BYTES:
        raise ValueError(f"Captured JPEG is {len(jpeg)} bytes; limit is {MAX_STILL_BYTES} bytes")

    async with session.post(
        f"{API_BASE}/api/captures/upload-ticket",
        json={"frameId": frame_id},
    ) as response:
        ticket = await response.json()
        if response.status != 201:
            raise RuntimeError(f"OCI upload-ticket request failed ({response.status}): {ticket}")

    upload_url = urljoin(f"{API_BASE}/", str(ticket.get("uploadUrl", "")).lstrip("/"))
    async with session.put(
        upload_url,
        data=jpeg,
        headers={"Content-Type": "image/jpeg"},
    ) as response:
        result = await response.json()
        if response.status != 201:
            raise RuntimeError(f"OCI still upload failed ({response.status}): {result}")
    if result.get("frameId") != frame_id or not result.get("stillUrl"):
        raise RuntimeError("OCI upload response did not match the requested frame")
    return urljoin(f"{API_BASE}/", str(result["stillUrl"]).lstrip("/"))


async def capture_and_upload(camera: Camera, session: aiohttp.ClientSession, channel, frame_id: str) -> None:
    send_data(channel, {"type": "CAPTURE_STATUS", "frameId": frame_id, "status": "PREPARING"})
    try:
        send_data(channel, {"type": "CAPTURE_STATUS", "frameId": frame_id, "status": "CAPTURING"})
        jpeg = await camera.still_jpeg()
        send_data(channel, {"type": "CAPTURE_STATUS", "frameId": frame_id, "status": "UPLOADING"})
        still_url = await upload_still(session, frame_id, jpeg)
        send_data(channel, {
            "type": "CAPTURE_STATUS",
            "frameId": frame_id,
            "status": "UPLOADED",
            "stillUrl": still_url,
        })
        LOG.info("Frame %s captured (%d bytes) and uploaded", frame_id, len(jpeg))
    except Exception as exc:
        LOG.exception("Capture/upload failed for frame %s", frame_id)
        send_data(channel, {
            "type": "CAPTURE_STATUS",
            "frameId": frame_id,
            "status": "FAILED",
            "error": str(exc)[:500],
        })


async def fetch_ice_configuration(session: aiohttp.ClientSession) -> RTCConfiguration:
    async with session.get(f"{API_BASE}/api/webrtc/ice-servers") as response:
        payload = await response.json()
        if response.status != 200 or not isinstance(payload.get("iceServers"), list):
            raise RuntimeError(f"Could not fetch OCI ICE server configuration: {payload}")
    servers = []
    for item in payload["iceServers"]:
        if not item.get("urls"):
            continue
        servers.append(RTCIceServer(
            urls=item["urls"],
            username=item.get("username"),
            credential=item.get("credential"),
        ))
    return RTCConfiguration(iceServers=servers)


def parse_candidate(value: dict[str, Any]) -> RTCIceCandidate | None:
    candidate_sdp = str(value.get("candidate", "")).strip()
    if not candidate_sdp:
        return None
    if candidate_sdp.startswith("a="):
        candidate_sdp = candidate_sdp[2:]
    if candidate_sdp.startswith("candidate:"):
        candidate_sdp = candidate_sdp[len("candidate:"):]
    candidate = candidate_from_sdp(candidate_sdp)
    candidate.sdpMid = value.get("sdpMid")
    candidate.sdpMLineIndex = value.get("sdpMLineIndex")
    return candidate


async def run_agent(camera: Camera, stop_event: asyncio.Event) -> None:
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        ws_url = API_BASE.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/ws/signaling"
        while not stop_event.is_set():
            peer: RTCPeerConnection | None = None
            try:
                LOG.info("Connecting to OCI signaling at %s as %s", ws_url, PEER_ID)
                async with session.ws_connect(ws_url, heartbeat=20) as socket:
                    # Register the fixed peer ID used by the existing browser client.
                    await socket.send_json({
                        "type": "SUBSCRIBE",
                        "sourcePeer": PEER_ID,
                        "targetPeer": "broadcast",
                        "deviceType": "rpi4-csi-camera",
                    })
                    pending_candidates: list[dict[str, Any]] = []
                    async for message in socket:
                        if message.type != aiohttp.WSMsgType.TEXT:
                            if message.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                                break
                            continue
                        try:
                            data = message.json()
                        except (json.JSONDecodeError, TypeError):
                            LOG.warning("Ignoring invalid signaling JSON")
                            continue
                        if data.get("targetPeer") not in (None, PEER_ID, "broadcast"):
                            continue

                        if data.get("type") == "OFFER" and isinstance(data.get("sdp"), str):
                            if peer:
                                await peer.close()
                            # TURN credentials are short-lived; fetch them for each browser session.
                            ice_config = await fetch_ice_configuration(session)
                            peer = RTCPeerConnection(configuration=ice_config)
                            peer.addTrack(PiVideoTrack(camera))
                            browser_peer = data.get("sourcePeer")

                            @peer.on("datachannel")
                            def on_datachannel(channel):
                                LOG.info("Browser data channel opened: %s", channel.label)

                                @channel.on("message")
                                def on_channel_message(raw):
                                    try:
                                        command = json.loads(raw) if isinstance(raw, str) else {}
                                    except json.JSONDecodeError:
                                        LOG.warning("Ignoring invalid data-channel JSON")
                                        return
                                    frame_id = command.get("frameId")
                                    if command.get("type") != "CAPTURE_STILL" or not isinstance(frame_id, str) or not frame_id:
                                        return
                                    asyncio.create_task(capture_and_upload(camera, session, channel, frame_id))

                            @peer.on("connectionstatechange")
                            async def on_connectionstatechange():
                                LOG.info("WebRTC peer state: %s", peer.connectionState)

                            await peer.setRemoteDescription(RTCSessionDescription(sdp=data["sdp"], type="offer"))
                            for candidate_data in pending_candidates:
                                candidate = parse_candidate(candidate_data)
                                if candidate:
                                    await peer.addIceCandidate(candidate)
                            pending_candidates.clear()
                            answer = await peer.createAnswer()
                            await peer.setLocalDescription(answer)
                            await socket.send_json({
                                "type": "ANSWER",
                                "sdp": peer.localDescription.sdp,
                                "sourcePeer": PEER_ID,
                                "targetPeer": browser_peer,
                            })
                            LOG.info("Answered browser offer from %s", browser_peer)

                        elif data.get("type") == "CANDIDATE" and isinstance(data.get("candidate"), dict):
                            if peer and peer.remoteDescription:
                                candidate = parse_candidate(data["candidate"])
                                if candidate:
                                    await peer.addIceCandidate(candidate)
                            else:
                                pending_candidates.append(data["candidate"])

            except asyncio.CancelledError:
                raise
            except Exception:
                LOG.exception("Pi camera agent connection failed; retrying")
            finally:
                if peer:
                    await peer.close()
            if not stop_event.is_set():
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=5)
                except asyncio.TimeoutError:
                    pass


def validate_config() -> None:
    parsed = urlparse(API_BASE)
    if parsed.scheme not in ("https", "http") or not parsed.netloc:
        raise SystemExit("Set MICROLEARN_API_BASE_URL to the OCI origin, e.g. https://yourname.duckdns.org")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise SystemExit("MICROLEARN_API_BASE_URL must be only the OCI origin; do not append /api or a path")
    if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1"):
        raise SystemExit("MICROLEARN_API_BASE_URL must use HTTPS except for local development")
    if PEER_ID != "rpi4-csi-camera":
        raise SystemExit("MICROLEARN_PEER_ID must match the browser's configured peer ID: rpi4-csi-camera")
    if PREVIEW_WIDTH < 160 or PREVIEW_HEIGHT < 120 or not 1 <= PREVIEW_FPS <= 30:
        raise SystemExit("Invalid camera preview dimensions or frame rate")


async def main() -> None:
    validate_config()
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    camera = Camera.open()
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop_event.set)
    try:
        await run_agent(camera, stop_event)
    finally:
        await camera.close()


if __name__ == "__main__":
    asyncio.run(main())
