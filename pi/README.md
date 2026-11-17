# Raspberry Pi 4 camera agent

`camera_agent.py` is the Pi-side peer expected by the existing browser WebRTC client. It uses Picamera2 for the CSI camera, `aiortc` for WebRTC media/data channels, and `aiohttp` to talk to OCI. It does not run segmentation or contain Hugging Face/Gemini credentials.

## Requirements

- Raspberry Pi 4 (the current project unit is 4 GB) with 64-bit Raspberry Pi OS Bullseye or later.
- Raspberry Pi Camera Module connected to the 15-pin CSI connector. Power off the Pi before connecting/disconnecting the ribbon cable.
- The OCI backend reachable by HTTPS, with CORS allowing the exact published Google AI Studio app origin. Set up the DNS, TLS, and OCI NSG before starting this agent.
- An OCI backend configured with `MICROLEARN_DOMAIN`, `ALLOWED_ORIGINS`, and working signaling/upload routes.

Raspberry Pi OS's supported camera stack is libcamera/Picamera2. Do not install the legacy `picamera` package for this CSI camera. Raspberry Pi documents `sudo apt install python3-picamera2` and `rpicam-hello` as the camera check: https://www.raspberrypi.com/documentation/accessories/camera-software.html

## Install

First verify the camera using the system tools:

```bash
sudo apt update
sudo apt install -y python3-picamera2 python3-venv python3-pip
rpicam-hello -t 5000
```

Install the agent. `pi/install.sh` automates the apt packages, virtual environment, Python dependencies, and systemd unit. From a checkout containing `pi/`, run:

```bash
sudo bash pi/install.sh
```

`--system-site-packages` is required so the virtual environment can import Picamera2 and its apt-managed libcamera bindings.

The install script creates `/etc/microlearn-pi.env` on first install. If the project root `.env` is present, it copies only the Pi-safe camera settings into the systemd environment file; OCI secrets and `VITE_*` settings are excluded. Otherwise, add the Pi settings manually from the root `.env.example`:

```bash
sudo nano /etc/microlearn-pi.env
```

The agent requests short-lived upload tickets from OCI, so it does not store Gemini, Hugging Face, or OCI administrator credentials. The current ticket endpoint is not device-authenticated; use this only for the controlled project demo, not an open public camera.

## Run at boot

The install script installs the systemd unit with the invoking Pi username. After editing the environment file and confirming `rpicam-hello` detects the camera, enable it:

```bash
sudo systemctl enable --now microlearn-camera.service
sudo systemctl status microlearn-camera.service
journalctl -u microlearn-camera.service -f
```

The UI's fixed peer ID is `rpi4-csi-camera`; do not change it on only one side. Configure the published AI Studio app's build environment with:

```text
VITE_OCI_API_BASE_URL=https://yourname.duckdns.org/api
VITE_WEBRTC_SIGNALING_URL=wss://yourname.duckdns.org/ws/signaling
```

Republish the AI Studio app after setting Vite variables. In OCI's server-side environment, set `ALLOWED_ORIGINS` to the exact published origin Google gives you, whether it is a Cloud Run URL or a custom `ai.studio` URL. Use the root `.env.example` as the canonical variable reference and include only origins you actually use.

Start the Pi agent before opening/reconnecting the UI. The browser sends its offer to the already-registered Pi peer; signaling does not queue offers while the Pi is offline.

## Message and still contract

The browser sends `CAPTURE_STILL` with a `frameId` on the `microscope-control` data channel. This agent captures a JPEG in Picamera2 still mode, POSTs `{frameId}` to `/api/captures/upload-ticket`, PUTs the JPEG to the returned relative upload URL, then sends `CAPTURE_STATUS: UPLOADED` with the absolute OCI `stillUrl`. On failure it sends `CAPTURE_STATUS: FAILED` with an error. The UI currently times out after 10 seconds; if camera capture plus upload exceeds that, increase the UI timeout through the existing AI Studio workflow.

The preview starts at 640x480, 15 FPS. The still uses Picamera2's still configuration and is higher resolution. Exact camera compatibility, frame rate, Pi CPU load, WebRTC/TURN connectivity, and still upload duration must be checked on the actual bench.
