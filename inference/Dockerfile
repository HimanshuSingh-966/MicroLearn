FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=2 MODEL_PATH=/models/best.pt MODEL_METADATA_PATH=/models/metadata.json
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py compact_unet.py ./
RUN useradd --create-home --uid 10001 inference && mkdir -p /models && chown -R inference:inference /app /models
USER inference
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
