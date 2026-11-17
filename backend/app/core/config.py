"""Application settings.

Non-secret configuration comes from environment variables. Secrets (API keys, DB URLs,
webhook signing keys) are resolved through :mod:`app.core.secrets`, never from code.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Module(StrEnum):
    """Independently toggleable platform modules."""

    ITSM = "itsm"
    AI = "ai"
    SAAS = "saas"
    ITAM = "itam"
    VAULT = "vault"
    SIEM = "siem"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ADMINZERO_", env_file=".env", extra="ignore")

    env: str = "development"
    # GCP project hosting Secret Manager. When unset, secrets fall back to env/.env (offline dev only).
    gcp_project_id: str | None = Field(default=None, validation_alias="GCP_PROJECT_ID")
    enabled_modules: set[Module] = Field(default_factory=lambda: set(Module))

    # Secret *names* (not values) looked up in Secret Manager / env.
    database_url_secret: str = "DATABASE_URL"
    redis_url_secret: str = "REDIS_URL"
    anthropic_api_key_secret: str = "ANTHROPIC_API_KEY"
    siem_signing_key_secret: str = "SIEM_WEBHOOK_SIGNING_KEY"

    claude_model: str = "claude-opus-5-5"
    sla_hours_by_urgency: dict[int, int] = Field(default_factory=lambda: {5: 4, 4: 8, 3: 24, 2: 72, 1: 120})
    jit_elevation_minutes: int = 60
    siem_max_clock_skew_seconds: int = 300
    cab_required_threshold: int = 50

    @field_validator("enabled_modules", mode="before")
    @classmethod
    def _parse_modules(cls, v: object) -> object:
        if isinstance(v, str):
            return {m.strip() for m in v.split(",") if m.strip()}
        return v

    def module_enabled(self, module: Module) -> bool:
        return module in self.enabled_modules


@lru_cache
def get_settings() -> Settings:
    return Settings()
