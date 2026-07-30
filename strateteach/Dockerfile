# 770 Trend Diamonds — backend image
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl \
    # WeasyPrint runtime libs (Pango/Cairo/GDK-PixBuf/FFI) + Hebrew+Latin fonts, so the
    # branded Owners Daily Report PDF renders (incl. RTL Hebrew) inside the container.
    libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libcairo2 libgdk-pixbuf-2.0-0 libffi-dev \
    fonts-noto-core fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY python-backend ./python-backend
WORKDIR /app/python-backend

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD curl -fsS http://localhost:${PORT:-5000}/healthz || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-5000}"]
