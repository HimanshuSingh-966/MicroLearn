# Project Status

Last checked: 2026-11-18. This page records repository evidence, not planned or assumed capability.

## Present in this checkout

- React/Vite frontend in `microlearn/src`; UI edits are being handled separately through Google AI Studio.
- Roboflow COCO Segmentation export in `dataset/train`: 167 images, 7,482 annotations, and three annotated classes (`cell walls`, `cytoplasm`, `nucleus`).
- PyTorch compact U-Net training script in `training/train_unet.py`, plus dependency list. A 60-epoch model bundle exists in `artifacts/onion-unet-v1/` (`best.pt`, `metadata.json`, and `split_manifest.json`); the selected checkpoint is from epoch 52.
- Node/Express backend in `microlearn/server.ts` with health/model status, short-lived Pi upload tickets, image/mask file serving, asynchronous real inference-service requests, text-only chat proxy, STUN/optional TURN response, WebSocket signaling, and `ALLOWED_ORIGINS` exact-origin CORS enforcement.
- Raspberry Pi camera peer in `pi/camera_agent.py`, plus requirements, systemd unit, and setup notes. It implements the browser's existing offer/data-channel message contract, Picamera2 still capture, and direct OCI upload.
- Separate FastAPI/PyTorch semantic inference service in `inference/`, loading the training checkpoint and metadata and returning a lossless class-mask PNG when a compatible artifact exists.
- A single checked-in environment template at the repository root (`.env.example`) and setup notes in `backend/` and `pi/`.

## Not implemented or not verified

- The run's metadata reports mean foreground Dice 0.903, aggregated over 13 batches covering 50 held-out images. The evaluator reports batch count in its old `images` field; the metadata was corrected to state the actual image count and aggregation. Recompute a per-image metric and review predictions before deciding whether the model is suitable.
- OCI inference is configured to download `best.pt` and `metadata.json` from a Hugging Face model repository at startup. The user reports the model is uploaded and the OCI VM is created, but the repository ID, published frontend origin, DuckDNS hostname, OCI environment configuration, and live deployment have not been verified from this checkout.
- The current training targets are semantic classes only. They do not yield per-cell IDs or validated wall-to-cell ownership.
- The local model bundle is present and the inference service is configured to download weights/metadata from Hugging Face. The actual Hugging Face repository, OCI service processes, backend-to-inference connection, DNS/TLS, allowed frontend origin, and cloud deployment have not been verified.
- Backend inference returns semantic class masks only. The frontend can inspect a semantic class and approximate connected region, but cannot identify individual cells or assign shared-wall ownership.
- Pi camera peer, backend signaling, and capture routes have not been run together on physical hardware. Physical camera recognition, focus, image quality, and network behavior are unverified.
- OCI has not been provisioned/deployed from this checkout. TLS, DNS, firewall rules, runtime env, persistent storage permissions, model loading, and coturn still need verification on the VM.
- The complete Pi → OCI → model → browser workflow has not been demonstrated.

## Next dependencies

1. Set the actual DuckDNS hostname, published AI Studio origin, Hugging Face model repository/revision, and server-side secrets in OCI's runtime environment.
2. Start Node API and inference services on the OCI VM and verify health, model loading, CORS, image upload, and real mask output.
3. Install and run the Pi camera service, then verify signaling, live stream, still upload, and capture timeout on the phone hotspot.
4. Add the image-upload action to the AI Studio frontend and publish it with the OCI API/signaling URLs.
5. Validate semantic class masks on real stained onion images. Add instance-aware cell IDs and validated wall ownership before enabling individual-cell selection.
