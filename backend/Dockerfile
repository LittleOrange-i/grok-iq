# syntax=docker/dockerfile:1.7

FROM python:3.12-slim

ARG GROKIQ_VERSION=""

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Shanghai \
    GROKIQ_VERSION=${GROKIQ_VERSION}

WORKDIR /app

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends tzdata && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml alembic.ini VERSION ./
COPY alembic ./alembic
COPY app ./app

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install . && \
    addgroup --system grokiq && \
    adduser --system --ingroup grokiq --home /app grokiq && \
    mkdir -p /app/data && \
    chown -R grokiq:grokiq /app

USER grokiq

VOLUME ["/app/data"]
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/api/health', timeout=4)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090", "--http", "h11"]
