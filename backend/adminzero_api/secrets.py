"""Secret resolution — Google Cloud Secret Manager first, `.env.local` only for offline development.

No secret value is ever hardcoded. Outside development, a missing `GCP_PROJECT_ID` is a startup error
rather than a silent fallback to local files.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Literal, Protocol

from dotenv import dotenv_values

from adminzero_api.config import get_settings

log = logging.getLogger(__name__)
SecretSource = Literal["gcp_secret_manager", "env_local"]


class SecretNotFound(RuntimeError):
    pass


class SecretProvider(Protocol):
    source: SecretSource

    def get(self, name: str) -> str: ...


class GcpSecretManagerProvider:
    """Reads `projects/<project>/secrets/<NAME>/versions/latest` with SecretManagerServiceClient."""

    source: SecretSource = "gcp_secret_manager"

    def __init__(self, project_id: str, client: object | None = None) -> None:
        if client is None:
            from google.cloud import secretmanager  # imported lazily so tests and dev don't need GCP credentials

            client = secretmanager.SecretManagerServiceClient()
        self._client = client
        self._project_id = project_id
        self._cache: dict[str, str] = {}

    def get(self, name: str) -> str:
        if name not in self._cache:
            path = f"projects/{self._project_id}/secrets/{name}/versions/latest"
            try:
                response = self._client.access_secret_version(request={"name": path})  # type: ignore[attr-defined]
            except Exception as exc:  # google.api_core exceptions vary by transport
                raise SecretNotFound(f"{name} is not available in Secret Manager") from exc
            self._cache[name] = response.payload.data.decode("utf-8")
        return self._cache[name]


class EnvLocalProvider:
    """Offline-development fallback: process environment, then `backend/.env.local`."""

    source: SecretSource = "env_local"

    def __init__(self, path: Path | None = None) -> None:
        file = path or Path(__file__).resolve().parent.parent / ".env.local"
        self._file = {k: v for k, v in dotenv_values(file).items() if v} if file.exists() else {}

    def get(self, name: str) -> str:
        value = os.environ.get(name) or self._file.get(name)
        if not value:
            raise SecretNotFound(f"{name} is not set in the environment or .env.local")
        return value


@lru_cache
def get_secret_provider() -> SecretProvider:
    settings = get_settings()
    if settings.gcp_project_id:
        log.info("Secrets: Google Cloud Secret Manager (project %s)", settings.gcp_project_id)
        return GcpSecretManagerProvider(settings.gcp_project_id)
    if not settings.is_dev:
        raise RuntimeError("GCP_PROJECT_ID must be set outside development — .env.local secrets are dev-only")
    log.warning("Secrets: .env.local fallback (offline development only)")
    return EnvLocalProvider()


def get_secret(name: str) -> str | None:
    """Return the secret or None. Callers decide whether a missing secret disables a feature or fails."""
    try:
        return get_secret_provider().get(name)
    except SecretNotFound:
        return None


def secret_status() -> dict[str, bool]:
    """Which secrets resolved — names only, never values."""
    return {name: get_secret(name) is not None for name in get_settings().secret_names}
