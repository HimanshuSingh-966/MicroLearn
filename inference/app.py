"""FastAPI inference service for the trained MicroLearn semantic U-Net.

The current artifact predicts semantic classes only. It does not emit cell
instance IDs or wall-to-cell membership, so callers must not infer those.
"""

from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path
from typing import Any

import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from dotenv import load_dotenv

from compact_unet import CompactUNet

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)

MODEL_PATH = Path(os.getenv("MODEL_PATH", "/models/best.pt"))
METADATA_PATH = Path(os.getenv("MODEL_METADATA_PATH", "/models/metadata.json"))
HF_MODEL_REPO_ID = os.getenv("HF_MODEL_REPO_ID", "").strip()
HF_MODEL_REVISION = os.getenv("HF_MODEL_REVISION", "main").strip() or "main"
HF_TOKEN = os.getenv("HF_TOKEN") or None
HF_HUB_CACHE = os.getenv("HF_HUB_CACHE", "/models/hf-cache")
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(12 * 1024 * 1024)))
DEVICE = torch.device("cpu")
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

app = FastAPI(title="MicroLearn Inference", version="0.1.0")
model: CompactUNet | None = None
metadata: dict[str, Any] | None = None
model_error: str | None = None


def load_model() -> None:
    global model, metadata, model_error
    model = None
    metadata = None
    model_error = None
    try:
        weights_path = MODEL_PATH
        metadata_path = METADATA_PATH
        if HF_MODEL_REPO_ID:
            from huggingface_hub import hf_hub_download

            weights_path = Path(hf_hub_download(
                repo_id=HF_MODEL_REPO_ID,
                filename="best.pt",
                revision=HF_MODEL_REVISION,
                token=HF_TOKEN,
                cache_dir=HF_HUB_CACHE,
            ))
            metadata_path = Path(hf_hub_download(
                repo_id=HF_MODEL_REPO_ID,
                filename="metadata.json",
                revision=HF_MODEL_REVISION,
                token=HF_TOKEN,
                cache_dir=HF_HUB_CACHE,
            ))
        if not weights_path.is_file() or not metadata_path.is_file():
            raise FileNotFoundError(f"Model weights or metadata are missing at {weights_path}.")

        meta = json.loads(metadata_path.read_text(encoding="utf-8"))
        if meta.get("task") != "semantic_segmentation" or meta.get("output_channels") != 4:
            raise ValueError("Expected a four-channel semantic segmentation artifact.")
        checkpoint = torch.load(weights_path, map_location=DEVICE, weights_only=True)
        candidate = CompactUNet(output_channels=int(meta["output_channels"]), base=int(checkpoint.get("base_channels", 16)))
        candidate.load_state_dict(checkpoint["state_dict"], strict=True)
        candidate.eval()
        model = candidate
        metadata = meta
    except Exception as exc:  # keep health endpoint available for diagnosable startup state
        source = f" from {HF_MODEL_REPO_ID}@{HF_MODEL_REVISION}" if HF_MODEL_REPO_ID else ""
        model_error = f"Could not load model artifact{source}: {exc}"


@app.on_event("startup")
def on_startup() -> None:
    load_model()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "microlearn-inference",
        "modelAvailable": model is not None,
        "modelError": model_error,
        "device": str(DEVICE),
        "capabilities": {
            "semanticClasses": model is not None,
            "cellInstances": False,
            "perCellWallOwnership": False,
        },
    }


@app.post("/v1/predict")
async def predict(frame_id: str = Form(...), image: UploadFile = File(...)) -> dict[str, Any]:
    if model is None or metadata is None:
        raise HTTPException(status_code=503, detail={"error": model_error or "Model unavailable", "modelUnavailable": True})
    if not frame_id or len(frame_id) > 128:
        raise HTTPException(status_code=400, detail="frame_id must be a non-empty string up to 128 characters")

    payload = await image.read(MAX_IMAGE_BYTES + 1)
    if not payload or len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image is empty or exceeds configured size limit")
    try:
        with Image.open(io.BytesIO(payload)) as opened:
            if opened.format not in ("JPEG", "PNG"):
                raise HTTPException(status_code=415, detail="Only JPEG and PNG images are supported")
            opened.verify()
        with Image.open(io.BytesIO(payload)) as opened:
            source = opened.convert("RGB")
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=415, detail="Upload is not a supported image")

    source_width, source_height = source.size
    input_size = metadata.get("input_size", [512, 512])
    width, height = int(input_size[0]), int(input_size[1])
    image_resized = source.resize((width, height), Image.Resampling.BILINEAR)
    pixels = np.asarray(image_resized, dtype=np.float32) / 255.0
    pixels = (pixels - MEAN) / STD
    tensor = torch.from_numpy(pixels.transpose(2, 0, 1).copy()).unsqueeze(0)

    with torch.inference_mode():
        logits = model(tensor)
        labels = logits.argmax(dim=1)[0].cpu().numpy().astype(np.uint8)

    # Restore the prediction to source coordinates with nearest-neighbor label sampling.
    label_image = Image.fromarray(labels, mode="L").resize((source_width, source_height), Image.Resampling.NEAREST)
    png = io.BytesIO()
    label_image.save(png, format="PNG", optimize=True)
    classes = metadata.get("classes", {})
    return {
        "frameId": frame_id,
        "width": source_width,
        "height": source_height,
        "classMaskEncoding": "grayscale-png",
        "classMaskPngBase64": base64.b64encode(png.getvalue()).decode("ascii"),
        "classes": classes,
        "modelRevision": metadata.get("model_revision", "unversioned"),
        "capabilities": {
            "semanticClasses": True,
            "cellInstances": False,
            "perCellWallOwnership": False,
        },
    }
