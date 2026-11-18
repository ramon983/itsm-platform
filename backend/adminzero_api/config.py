"""Non-secret runtime configuration (environment variables). Secrets live in `secrets.py`."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache

SECRET_NAMES = ("ANTHROPIC_API_KEY", "DATABASE_URL", "SIEM_WEBHOOK_SECRET", "VAULT_KMS_KEY")


@dataclass(frozen=True)
class Settings:
    env: str = "development"
    gcp_project_id: str | None = None
    allowed_origins: tuple[str, ...] = ("http://localhost:3000",)
    claude_model: str = "claude-opus-5-5"
    siem_max_skew_seconds: int = 300
    ai_rate_limit_per_minute: int = 20
    secret_names: tuple[str, ...] = field(default=SECRET_NAMES)

    @property
    def is_dev(self) -> bool:
        return self.env in {"development", "test"}


@lru_cache
def get_settings() -> Settings:
    origins = os.environ.get("ADMINZERO_ALLOWED_ORIGINS", "http://localhost:3000,https://ramon983.github.io")
    return Settings(
        env=os.environ.get("ADMINZERO_ENV", "development"),
        gcp_project_id=os.environ.get("GCP_PROJECT_ID") or None,
        allowed_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
        claude_model=os.environ.get("ADMINZERO_CLAUDE_MODEL", "claude-opus-5-5"),
        ai_rate_limit_per_minute=int(os.environ.get("ADMINZERO_AI_RATE_LIMIT", "20")),
    )
