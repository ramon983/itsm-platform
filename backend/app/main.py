"""AdminZero API entrypoint. Modules are mounted only when enabled via ADMINZERO_ENABLED_MODULES."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.config import Module, get_settings
from app.core.db import Base, get_engine
from app.core.errors import DomainError
from app.core.events import RedisEventBus, set_event_bus
from app.core.secrets import SecretNotFoundError, get_secret

log = logging.getLogger("adminzero")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    try:
        set_event_bus(RedisEventBus(get_secret(settings.redis_url_secret)))
    except SecretNotFoundError:
        log.warning("REDIS_URL not configured; using in-memory event bus")
    if settings.env in {"development", "test"}:
        # Production schema changes go through migrations; dev gets auto-create for convenience.
        async with get_engine().begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="AdminZero Open API",
        version="0.1.0",
        description="Human-centric ITSM, SaaS management, ITAM, JIT vault and SIEM correlation.",
        lifespan=lifespan,
    )

    @app.exception_handler(DomainError)
    async def _domain_error(_: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

    @app.get("/healthz", tags=["ops"])
    async def healthz() -> dict[str, object]:
        return {"status": "ok", "modules": sorted(settings.enabled_modules)}

    from app.api.v1 import itsm, modules

    prefix = "/api/v1"
    mounts = {
        Module.ITSM: [itsm.router],
        Module.ITAM: [modules.itam_router],
        Module.SAAS: [modules.saas_router],
        Module.VAULT: [modules.vault_router],
        Module.SIEM: [modules.siem_router],
        Module.AI: [modules.ai_router],
    }
    if not settings.module_enabled(Module.ITSM):
        raise RuntimeError("The ITSM core module cannot be disabled")
    for module, routers in mounts.items():
        if settings.module_enabled(module):
            for r in routers:
                app.include_router(r, prefix=prefix)

    from app.api.graphql import build_graphql_router

    app.include_router(build_graphql_router(), prefix="/graphql", tags=["graphql"])
    return app


app = create_app()
