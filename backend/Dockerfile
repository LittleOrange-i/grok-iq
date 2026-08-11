# syntax=docker/dockerfile:1.7

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Shanghai

WORKDIR /app

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends tzdata && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml alembic.ini ./
COPY alembic ./alembic
COPY app ./app

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install . && \
    addgroup --system monitor && \
    adduser --system --ingroup monitor --home /app monitor && \
    mkdir -p /app/data && \
    chown -R monitor:monitor /app

USER monitor

VOLUME ["/app/data"]
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/api/health', timeout=4)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
