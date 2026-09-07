"""FastAPI application: the HTTP boundary.

In normal local use this process also serves the production React build, so
the whole app is one process on one port.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from fitness_lab import __version__
from fitness_lab.storage import db

WEB_DIST = db.REPO_ROOT / "web" / "dist"


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class PingDbResponse(BaseModel):
    status: str
    source: str
    row_id: int
    token: str
    created_at: str
    sqlite_version: str


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    db.init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="fitness-lab", version=__version__, lifespan=lifespan)

    @app.get("/api/health")
    def health() -> HealthResponse:
        return HealthResponse(status="ok", service="fitness-lab", version=__version__)

    @app.get("/api/ping-db")
    def ping_db() -> PingDbResponse:
        check = db.read_technical_check()
        return PingDbResponse(
            status="ok",
            source="sqlite",
            row_id=check.row_id,
            token=check.token,
            created_at=check.created_at,
            sqlite_version=check.sqlite_version,
        )

    # Mounted last so /api/* routes always win. Absent in dev (Vite serves the UI).
    if WEB_DIST.is_dir():
        app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")

    return app


app = create_app()
