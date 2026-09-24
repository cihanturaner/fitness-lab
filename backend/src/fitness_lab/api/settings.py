"""Routine settings the lifter changes in the app: the block start, and backups.

Programs are still imported and activated from the command line only. A backup is the same
verified ``VACUUM INTO`` snapshot the destructive paths take; the listing exposes file names
and times, never paths outside ``data/snapshots/`` or database contents.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from fitness_lab.api.schemas import RequestModel, StrictDate
from fitness_lab.domain.week import week_bounds
from fitness_lab.storage import controller, db, programs
from fitness_lab.storage.entry import Conflict
from fitness_lab.storage.snapshots import (
    MANUAL_BACKUP_LABEL,
    SnapshotInfo,
    create_snapshot,
    list_snapshots,
)

router = APIRouter()


class BlockStartIn(RequestModel):
    start_on: StrictDate


class BlockStartOut(BaseModel):
    version_id: str
    start_on: str
    week_1_start: str
    week_1_end: str


@router.put("/api/program/block-start")
def put_block_start(body: BlockStartIn) -> BlockStartOut:
    """Set (or move) the start of the active program's training block."""
    with db.connection_scope() as connection:
        version = programs.get_active_version(connection)
        if version is None:
            raise Conflict("there is no active program, so there is no block to start")
        decided = controller.list_decisions(connection, version.id)
        if (
            decided
            and programs.get_block_start(connection, version.id) != body.start_on.isoformat()
        ):
            # Review decisions are recorded against block weeks; moving week 1 would put them
            # on other weeks (a decision "done" for a week not yet lived).
            raise Conflict(
                f"{len(decided)} weekly review decision(s) are recorded against this block's "
                "weeks, so its start can no longer be moved"
            )
        programs.set_block_start(connection, version.id, body.start_on.isoformat())
    monday, sunday = week_bounds(body.start_on)
    return BlockStartOut(
        version_id=version.id,
        start_on=body.start_on.isoformat(),
        week_1_start=monday.isoformat(),
        week_1_end=sunday.isoformat(),
    )


class BackupOut(BaseModel):
    name: str
    kind: str
    created_at_utc: str
    size_bytes: int

    @classmethod
    def of(cls, info: SnapshotInfo) -> BackupOut:
        return cls(
            name=info.name,
            kind=info.kind,
            created_at_utc=info.created_at_utc,
            size_bytes=info.size_bytes,
        )


class BackupIn(RequestModel):
    """Empty, but required: only the app's own JSON request (never a cross-site simple POST)
    can trigger a backup."""


@router.post("/api/backup", status_code=201)
def backup(_body: BackupIn) -> BackupOut:
    """A verified full copy of the database into data/snapshots/, now."""
    path = db.database_path()
    with db.connection_scope() as connection:
        target = create_snapshot(connection, path, MANUAL_BACKUP_LABEL)
    return next(BackupOut.of(info) for info in list_snapshots(path) if info.name == target.name)


@router.get("/api/backups")
def backups(limit: int = 20) -> list[BackupOut]:
    return [BackupOut.of(info) for info in list_snapshots(db.database_path())[: max(1, limit)]]
