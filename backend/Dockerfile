FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

WORKDIR /app

# requirements.lock holds the exact versions the test suite ran against.
COPY requirements.lock ./
RUN pip install -r requirements.lock

COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
COPY scripts ./scripts
COPY docker-entrypoint.sh ./

RUN useradd --system --uid 10001 --no-create-home appuser && chmod +x docker-entrypoint.sh
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"

ENTRYPOINT ["./docker-entrypoint.sh"]
