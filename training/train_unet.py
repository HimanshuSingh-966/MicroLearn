"""Train the first MicroLearn model: semantic masks from Roboflow COCO polygons.

Designed for Google Colab. It consumes a Roboflow COCO Segmentation export with
cell-wall, cytoplasm, and nucleus labels and writes weights plus metadata.
This stage predicts background, cell wall, cytoplasm, and nucleus classes. It does
not predict individual cell instances or per-cell wall ownership.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image
from pycocotools.coco import COCO
from torch import nn
from torch.utils.data import DataLoader, Dataset
from tqdm.auto import tqdm


CLASS_NAMES = ("background", "cell walls", "cytoplasm", "nucleus")
CLASS_ALIASES = {
    "cell wall": 1, "cell walls": 1, "cell_wall": 1,
    "cytoplasm": 2,
    "nucleus": 3, "nuclei": 3,
}


class CocoStructureDataset(Dataset):
    def __init__(self, root: Path, annotation_file: Path, image_ids: list[int], category_map: dict[int, int], size: int):
        self.root = root
        self.coco = COCO(str(annotation_file))
        self.image_ids = image_ids
        self.category_map = category_map
        self.size = size
        self.images = {item["id"]: item for item in self.coco.loadImgs(image_ids)}

    def __len__(self) -> int:
        return len(self.image_ids)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        image_id = self.image_ids[index]
        info = self.images[image_id]
        image_path = self.root / info["file_name"]
        with Image.open(image_path) as source:
            image = source.convert("RGB").resize((self.size, self.size), Image.Resampling.BILINEAR)
            image_np = np.asarray(image, dtype=np.float32) / 255.0

        ann_ids = self.coco.getAnnIds(imgIds=[image_id], catIds=list(self.category_map.keys()), iscrowd=None)
        annotations = self.coco.loadAnns(ann_ids)
        # COCO instances can overlap. Use a documented deterministic priority:
        # wall > nucleus > cytoplasm, preserving thin boundaries and organelles.
        mask = np.zeros((int(info["height"]), int(info["width"])), dtype=np.uint8)
        priority = {1: 3, 3: 2, 2: 1}
        for annotation in annotations:
            class_index = self.category_map.get(int(annotation["category_id"]))
            if class_index is None:
                continue
            instance = self.coco.annToMask(annotation).astype(bool)
            mask[instance & (priority[class_index] > np.take(np.array([0, 3, 1, 2]), mask))] = class_index
        mask_img = Image.fromarray(mask).resize((self.size, self.size), Image.Resampling.NEAREST)
        mask_np = np.asarray(mask_img, dtype=np.int64)

        # ImageNet normalization supports an encoder initialized from common pretrained weights later.
        image_np = (image_np - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array(
            [0.229, 0.224, 0.225], dtype=np.float32
        )
        image_tensor = torch.from_numpy(image_np.transpose(2, 0, 1).copy())
        mask_tensor = torch.from_numpy(mask_np.copy())
        return image_tensor, mask_tensor


class ConvBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.layers(x)


class CompactUNet(nn.Module):
    def __init__(self, base: int = 16):
        super().__init__()
        self.enc1 = ConvBlock(3, base)
        self.enc2 = ConvBlock(base, base * 2)
        self.enc3 = ConvBlock(base * 2, base * 4)
        self.enc4 = ConvBlock(base * 4, base * 8)
        self.pool = nn.MaxPool2d(2)
        self.bottleneck = ConvBlock(base * 8, base * 16)
        self.up4 = nn.ConvTranspose2d(base * 16, base * 8, 2, stride=2)
        self.dec4 = ConvBlock(base * 16, base * 8)
        self.up3 = nn.ConvTranspose2d(base * 8, base * 4, 2, stride=2)
        self.dec3 = ConvBlock(base * 8, base * 4)
        self.up2 = nn.ConvTranspose2d(base * 4, base * 2, 2, stride=2)
        self.dec2 = ConvBlock(base * 4, base * 2)
        self.up1 = nn.ConvTranspose2d(base * 2, base, 2, stride=2)
        self.dec1 = ConvBlock(base * 2, base)
        self.head = nn.Conv2d(base, len(CLASS_NAMES), 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        e1 = self.enc1(x)
        e2 = self.enc2(self.pool(e1))
        e3 = self.enc3(self.pool(e2))
        e4 = self.enc4(self.pool(e3))
        b = self.bottleneck(self.pool(e4))
        d4 = self.dec4(torch.cat([self.up4(b), e4], dim=1))
        d3 = self.dec3(torch.cat([self.up3(d4), e3], dim=1))
        d2 = self.dec2(torch.cat([self.up2(d3), e2], dim=1))
        d1 = self.dec1(torch.cat([self.up1(d2), e1], dim=1))
        return self.head(d1)


def mean_foreground_dice(logits: torch.Tensor, target: torch.Tensor) -> float:
    pred = logits.argmax(dim=1)
    scores = []
    for class_id in range(1, len(CLASS_NAMES)):
        p, t = pred == class_id, target == class_id
        denom = p.sum().item() + t.sum().item()
        if denom:
            scores.append((2 * (p & t).sum().item() + 1e-7) / (denom + 1e-7))
    return float(np.mean(scores)) if scores else 0.0


def loss_fn(logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    return nn.functional.cross_entropy(logits, target)


def read_split(export_dir: Path, seed: int, train_fraction: float) -> tuple[Path, Path, list[int], list[int], dict[int, int], dict[int, str]]:
    split_dirs = [p for p in export_dir.iterdir() if p.is_dir() and (p / "_annotations.coco.json").exists()]
    if not split_dirs:
        raise FileNotFoundError(f"No COCO split found under {export_dir}")
    if len(split_dirs) > 1:
        raise ValueError("This script expects one Roboflow export split so it can make the approved image-level 70/30 split. Merge/export a single source split first.")
    split_dir = split_dirs[0]
    annotation_file = split_dir / "_annotations.coco.json"
    coco = COCO(str(annotation_file))
    categories = coco.loadCats(coco.getCatIds())
    category_map: dict[int, int] = {}
    class_mapping: dict[int, str] = {}
    for category in categories:
        name = category["name"].strip().lower()
        if name in CLASS_ALIASES:
            class_index = CLASS_ALIASES[name]
            category_map[int(category["id"])] = class_index
            class_mapping[class_index] = CLASS_NAMES[class_index]
    missing = [name for index, name in enumerate(CLASS_NAMES[1:], start=1) if index not in class_mapping]
    if missing:
        raise ValueError(f"Export is missing required classes: {missing}. Found {[c['name'] for c in categories]}")
    image_ids = sorted(coco.getImgIds())
    if len(image_ids) < 2:
        raise ValueError("Need at least two labeled images for a train/test split.")
    random.Random(seed).shuffle(image_ids)
    boundary = max(1, min(len(image_ids) - 1, round(len(image_ids) * train_fraction)))
    return split_dir, annotation_file, image_ids[:boundary], image_ids[boundary:], category_map, class_mapping


def evaluate(model: nn.Module, loader: DataLoader, device: torch.device) -> dict[str, Any]:
    model.eval()
    values: list[float] = []
    image_count = 0
    with torch.no_grad():
        for images, masks in loader:
            images, masks = images.to(device), masks.to(device)
            values.append(mean_foreground_dice(model(images), masks))
            image_count += int(images.shape[0])
    return {
        "mean_foreground_dice": float(np.mean(values)),
        "images": image_count,
        "batches": len(values),
        "aggregation": "mean of batch-level foreground Dice scores",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--export", type=Path, required=True, help="Roboflow COCO segmentation export directory")
    parser.add_argument("--output", type=Path, default=Path("artifacts/wall-unet"))
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--train-fraction", type=float, default=0.70)
    args = parser.parse_args()

    if not 0.5 <= args.train_fraction < 1 or args.size % 16:
        raise ValueError("train-fraction must be in [0.5, 1), and size must be divisible by 16.")
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)

    split_dir, annotation_file, train_ids, test_ids, category_map, class_mapping = read_split(args.export, args.seed, args.train_fraction)
    # Keep the approved 30% test images untouched during epoch selection. A small
    # validation subset comes only from the 70% development partition.
    random.Random(args.seed + 1).shuffle(train_ids)
    validation_count = max(1, round(len(train_ids) * 0.1))
    validation_ids, fit_ids = train_ids[:validation_count], train_ids[validation_count:]
    train_set = CocoStructureDataset(split_dir, annotation_file, fit_ids, category_map, args.size)
    validation_set = CocoStructureDataset(split_dir, annotation_file, validation_ids, category_map, args.size)
    test_set = CocoStructureDataset(split_dir, annotation_file, test_ids, category_map, args.size)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True, num_workers=2, pin_memory=device.type == "cuda")
    validation_loader = DataLoader(validation_set, batch_size=args.batch_size, shuffle=False, num_workers=2, pin_memory=device.type == "cuda")
    test_loader = DataLoader(test_set, batch_size=args.batch_size, shuffle=False, num_workers=2, pin_memory=device.type == "cuda")
    model = CompactUNet().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)
    args.output.mkdir(parents=True, exist_ok=True)

    best_dice = -1.0
    history: list[dict[str, Any]] = []
    for epoch in range(1, args.epochs + 1):
        model.train()
        losses: list[float] = []
        for images, masks in tqdm(train_loader, desc=f"Epoch {epoch}/{args.epochs}", leave=False):
            images, masks = images.to(device), masks.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = loss_fn(model(images), masks)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.item()))
        metrics = evaluate(model, validation_loader, device)
        row = {"epoch": epoch, "train_loss": float(np.mean(losses)), **{"validation_" + key: value for key, value in metrics.items() if key != "images"}}
        history.append(row)
        print(json.dumps(row))
        if metrics["mean_foreground_dice"] > best_dice:
            best_dice = metrics["mean_foreground_dice"]
            torch.save({"state_dict": model.cpu().state_dict(), "base_channels": 16}, args.output / "best.pt")
            model.to(device)

    # Evaluate the untouched holdout once, after epoch selection.
    best = torch.load(args.output / "best.pt", map_location=device, weights_only=True)
    model.load_state_dict(best["state_dict"])
    test_metrics = evaluate(model, test_loader, device)
    split_manifest = {"seed": args.seed, "train_fraction": args.train_fraction, "fit_image_ids": fit_ids, "validation_image_ids": validation_ids, "held_out_test_image_ids": test_ids}
    (args.output / "split_manifest.json").write_text(json.dumps(split_manifest, indent=2), encoding="utf-8")
    metadata = {
        "model": "MicroLearnCompactUNetSemantic4Class",
        "task": "semantic_segmentation",
        "classes": {str(index): name for index, name in enumerate(CLASS_NAMES)},
        "source_category_ids": {str(k): v for k, v in category_map.items()},
        "output_channels": len(CLASS_NAMES),
        "selected_epoch": max(history, key=lambda row: row["validation_mean_foreground_dice"])["epoch"],
        "input_size": [args.size, args.size],
        "normalization": {"mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
        "limitations": ["Semantic labels only", "No individual cell IDs", "No per-cell wall association"],
        "held_out_test_metrics": test_metrics,
        "training_history": history,
        "split_manifest": "split_manifest.json",
        "weights": "best.pt",
    }
    (args.output / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"Saved first wall-only model bundle to {args.output.resolve()}")


if __name__ == "__main__":
    main()
