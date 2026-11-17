# AdminZero API — FastAPI on Cloud Run. Secrets are read at runtime from Google Cloud Secret Manager
# (GCP_PROJECT_ID + the Cloud Run service account); nothing secret is baked into the image.
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY main.py ./
COPY adminzero_api ./adminzero_api

FROM python:3.12-slim
RUN useradd --uid 10001 --create-home adminzero
WORKDIR /app
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 ADMINZERO_ENV=production PORT=8080
USER adminzero
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
