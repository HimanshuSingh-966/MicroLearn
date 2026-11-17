# MicroLearn

MicroLearn is a microscope camera attachment and learning interface for stained onion epidermis. The project is a work in progress; the browser UI exists, but physical capture, trained segmentation, and the complete cloud flow are not yet validated.

## Project layout

```text
MicroLearn/
├── docs/                     Architecture, API, data schema, requirements, and delivery plan
├── dataset/                  Current Roboflow COCO Segmentation export (167 images)
│   └── train/                Images and _annotations.coco.json
├── training/                 Colab-compatible PyTorch training code
├── backend/                  Backend deployment/API notes
├── inference/                FastAPI + PyTorch semantic segmentation service
├── pi/                       Raspberry Pi camera peer and systemd setup
├── microlearn/               React/Vite UI and Node/Express API
│   ├── src/                   Frontend source (UI changes are managed through AI Studio)
│   ├── server.ts              Node/Express backend implementation
└── CLAUDE.md                  Project instructions and current implementation status
```

## Current dataset and model scope

The Roboflow export in `dataset/` has COCO Segmentation annotations for `cell walls`, `cytoplasm`, and `nucleus`. `training/train_unet.py` trains a semantic segmentation U-Net and creates a seeded image-level 70/30 development/test split, using a small validation subset inside the development split. A 60-epoch run is present in `artifacts/onion-unet-v1/`. Its current held-out score is the mean of 13 batch-level Dice scores across 50 test images; review predictions and recompute a per-image metric before treating that score as a model-quality estimate. Semantic classes do not provide unique cell IDs or shared-wall ownership; those are needed for the intended per-cell border selection behavior.

## Train in Google Colab

Upload this project (or at least `training/` and `dataset/`) to the Colab runtime at `/content/MicroLearn`, then run:

```bash
%cd /content/MicroLearn
!pip install -r training/requirements.txt
!python training/train_unet.py \
  --export /content/MicroLearn/dataset \
  --output /content/MicroLearn/artifacts/onion-unet-v1 \
  --epochs 60 --batch-size 4 --size 512 --seed 42 --train-fraction 0.70
```

Save the generated `best.pt`, `metadata.json`, and `split_manifest.json` outside Colab temporary storage when the run finishes. Review held-out metrics and predictions before using the artifact. See `docs/IMPLEMENTATION_PLAN.md` for the approved workflow and evaluation expectations.

## Backend development

```bash
cd microlearn
npm install
npm run dev
```

The Node API, Pi agent, and FastAPI inference service are present, but their end-to-end flow is not yet verified. Copy the root [`.env.example`](.env.example) once to the project-root `.env`; the Node API and inference service load it, and Vite reads only its `VITE_*` entries. The Pi installer copies only Pi-safe entries to its systemd environment. Add the three public `VITE_*` values to Google AI Studio's build environment when publishing; never add server secrets there. See [`backend/README.md`](backend/README.md) and [`pi/README.md`](pi/README.md) for setup.

## OCI backend deployment

Use [`backend/README.md`](backend/README.md) for the OCI API/inference configuration and run steps. The OCI VM must have DNS/TLS, firewall rules, runtime environment variables, persistent storage, Node.js, and the Python inference service configured; this checkout does not automate OCI provisioning.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md)
- [`docs/SCHEMA.md`](docs/SCHEMA.md)
- [`docs/TECH_STACK.md`](docs/TECH_STACK.md)
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
- [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)
