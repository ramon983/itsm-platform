"""Secret resolution: Google Cloud Secret Manager first, local env/.env only for offline dev.

No secret value is ever hardcoded. In any non-development environment, a missing
GCP project is a startup error rather than a silent fallback to env vars.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Protocol

from dotenv import load_dotenv

from app.core.config import get_settings

log = logging.getLogger(__name__)


class SecretNotFoundError(RuntimeError):
    pass


class SecretProvider(Protocol):
    def get(self, name: str) -> str: ...


class GcpSecretProvider:
    def __init__(self, project_id: str) -> None:
        from google.cloud import secretmanager  # imported lazily: optional at dev time

        self._client = secretmanager.SecretManagerServiceClient()
        self._project_id = project_id
        self._cache: dict[str, str] = {}

    def get(self, name: str) -> str:
        if name in self._cache:
            return self._cache[name]
        path = f"projects/{self._project_id}/secrets/{name}/versions/latest"
        try:
            resp = self._client.access_secret_version(request={"name": path})
        except Exception as exc:  # google.api_core exceptions vary by transport
            raise SecretNotFoundError(f"Secret {name!r} unavailable in Secret Manager") from exc
        value = resp.payload.data.decode("utf-8")
        self._cache[name] = value
        return value


class EnvSecretProvider:
    """Offline-development fallback. Reads process env, then a local .env file."""

    def __init__(self) -> None:
        load_dotenv(override=False)

    def get(self, name: str) -> str:
        value = os.environ.get(name)
        if value is None:
            raise SecretNotFoundError(f"Secret {name!r} not set in environment/.env")
        return value


@lru_cache
def get_secret_provider() -> SecretProvider:
    settings = get_settings()
    if settings.gcp_project_id:
        log.info("Using Google Cloud Secret Manager for project %s", settings.gcp_project_id)
        return GcpSecretProvider(settings.gcp_project_id)
    if settings.env != "development" and settings.env != "test":
        raise RuntimeError("GCP_PROJECT_ID must be set outside development; env-var secrets are dev-only")
    log.warning("Secret Manager disabled: using local env/.env secrets (development only)")
    return EnvSecretProvider()


def get_secret(name: str, default: str | None = None) -> str:
    try:
        return get_secret_provider().get(name)
    except SecretNotFoundError:
        if default is not None:
            return default
        raise
