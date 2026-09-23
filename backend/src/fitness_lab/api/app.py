"""FastAPI application: the HTTP boundary.

In normal local use this process also serves the production React build, so
the whole app is one process on one port.

Routes are thin: validate the request, open one connection, call one storage operation,
shape the response. Each route opens its own connection because a sqlite3 connection is
bound to the thread that created it and FastAPI may run dependencies and endpoints on
different worker threads.
"""

from __future__ import annotations

import sqlite3
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from datetime import date

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from fitness_lab import __version__
from fitness_lab.api.schemas import (
    ActiveProgramOut,
    CompleteOut,
    CreateWorkoutIn,
    EntryOut,
    ExerciseCreateIn,
    ExerciseOut,
    IssueOut,
    LastPerformanceOut,
    OpenOut,
    OpenPlannedIn,
    OriginOut,
    PerformedSetOut,
    PlannedWorkoutDetailOut,
    PlannedWorkoutOut,
    PlannedWorkoutSummaryOut,
    ProgramVersionOut,
    SetCreateIn,
    SetOrderIn,
    SetPatchIn,
    SlotExerciseIn,
    SlotOut,
    WorkoutOut,
    WorkoutPatchIn,
    WorkoutSummaryOut,
    completion_body,
    parse_load,
)
from fitness_lab.domain.models import create_exercise
from fitness_lab.storage import db, entry, migrations, programs
from fitness_lab.storage.exercises import get_exercise, insert_exercise, list_exercises
from fitness_lab.storage.workouts import get_workout

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
    migrations.migrate_to_head()
    yield


@contextmanager
def _connection() -> Iterator[sqlite3.Connection]:
    with db.connection_scope() as connection:
        yield connection


def _today(value: date | None) -> str:
    """The civil local date of the machine; the lifter's own calendar day."""
    return (value if value is not None else date.today()).isoformat()


def _set_changes(body: SetPatchIn) -> dict[str, object]:
    changes: dict[str, object] = {}
    for field in body.model_fields_set:
        value = getattr(body, field)
        if field == "load_kg":
            value = parse_load(value)
        if field == "exercise_id" and value is None:
            raise ValueError("exercise_id cannot be cleared")
        changes[field] = value
    return changes


def _entry_out(connection: sqlite3.Connection, workout_id: str) -> EntryOut:
    return EntryOut.of(entry.load_entry(connection, workout_id))


def create_app() -> FastAPI:
    app = FastAPI(title="fitness-lab", version=__version__, lifespan=lifespan)

    @app.exception_handler(entry.NotFound)
    async def _not_found(_request: Request, exc: entry.NotFound) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(entry.Conflict)
    async def _conflict(_request: Request, exc: entry.Conflict) -> JSONResponse:
        return JSONResponse(status_code=409, content=completion_body(str(exc), exc.report))

    @app.exception_handler(ValueError)
    async def _invalid(_request: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

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

    # --- program ---------------------------------------------------------------------------

    @app.get("/api/program/active")
    def active_program() -> ActiveProgramOut:
        with _connection() as connection:
            version = programs.get_active_version(connection)
            if version is None:
                return ActiveProgramOut(
                    version=None, activated_at_utc=None, notes_text=None, planned_workouts=[]
                )
            _, notes_text = programs.read_program_texts(connection, version.id)
            planned = [
                PlannedWorkoutSummaryOut.summarise(
                    item,
                    programs.list_slots(connection, item.id),
                    entry.planned_workout_usage(connection, item.id),
                )
                for item in programs.list_planned_workouts(connection, version.id)
            ]
            return ActiveProgramOut(
                version=ProgramVersionOut.of(version),
                activated_at_utc=programs.get_activated_at(connection),
                notes_text=notes_text,
                planned_workouts=planned,
            )

    @app.get("/api/planned-workouts/{planned_workout_id}")
    def planned_workout(planned_workout_id: str) -> PlannedWorkoutDetailOut:
        with _connection() as connection:
            planned = programs.get_planned_workout(connection, planned_workout_id)
            if planned is None:
                raise entry.NotFound(f"no planned workout with id {planned_workout_id!r}")
            version = programs.get_program_version(connection, planned.program_version_id)
            assert version is not None
            slots = programs.list_slots(connection, planned_workout_id)
            exercises = {}
            for slot in slots:
                exercise = get_exercise(connection, slot.exercise_id)
                if exercise is not None:
                    exercises[exercise.id] = ExerciseOut.of(exercise)
            return PlannedWorkoutDetailOut(
                planned_workout=PlannedWorkoutOut.of(planned),
                version=ProgramVersionOut.of(version),
                slots=[SlotOut.of(slot) for slot in slots],
                exercises=exercises,
            )

    @app.post("/api/planned-workouts/{planned_workout_id}/open")
    def open_planned(planned_workout_id: str, body: OpenPlannedIn) -> OpenOut:
        with _connection() as connection:
            result = entry.open_planned_workout(
                connection, planned_workout_id, performed_on=_today(body.performed_on)
            )
            return OpenOut(
                workout_id=result.workout.id,
                created=result.created,
                workout=WorkoutOut.of(result.workout),
                origin=OriginOut.of(entry.get_origin(connection, result.workout.id)),
            )

    # --- workouts ---------------------------------------------------------------------------

    @app.post("/api/workouts", status_code=201)
    def create_workout(body: CreateWorkoutIn) -> WorkoutOut:
        with _connection() as connection:
            workout = entry.create_unplanned_workout(
                connection,
                performed_on=_today(body.performed_on),
                performed_time_local=body.performed_time_local,
                notes=body.notes,
            )
            return WorkoutOut.of(workout)

    @app.get("/api/workouts")
    def recent_workouts(limit: int = 30) -> list[WorkoutSummaryOut]:
        with _connection() as connection:
            return [
                WorkoutSummaryOut.summarise(item)
                for item in entry.list_recent_workouts(connection, limit=max(1, min(limit, 200)))
            ]

    @app.get("/api/workouts/{workout_id}/entry")
    def workout_entry(workout_id: str) -> EntryOut:
        with _connection() as connection:
            return _entry_out(connection, workout_id)

    @app.patch("/api/workouts/{workout_id}")
    def patch_workout(workout_id: str, body: WorkoutPatchIn) -> WorkoutOut:
        changes: dict[str, object] = {}
        for field in body.model_fields_set:
            value = getattr(body, field)
            if field == "performed_on":
                if value is None:
                    raise ValueError("performed_on cannot be cleared")
                value = value.isoformat()
            changes[field] = value
        with _connection() as connection:
            return WorkoutOut.of(entry.edit_workout(connection, workout_id, changes))

    @app.delete("/api/workouts/{workout_id}", status_code=204)
    def discard_workout(workout_id: str) -> Response:
        with _connection() as connection:
            entry.discard_draft(connection, workout_id, db_path=db.database_path())
        return Response(status_code=204)

    @app.post("/api/workouts/{workout_id}/complete")
    def complete_workout(workout_id: str) -> CompleteOut:
        with _connection() as connection:
            report = entry.complete(connection, workout_id)
            workout = get_workout(connection, workout_id)
            assert workout is not None
            return CompleteOut(
                workout=WorkoutOut.of(workout),
                advisories=[IssueOut.of(issue) for issue in report.advisories],
                renumbered=report.renumbered,
            )

    @app.post("/api/workouts/{workout_id}/reopen")
    def reopen_workout(workout_id: str) -> WorkoutOut:
        with _connection() as connection:
            return WorkoutOut.of(entry.reopen(connection, workout_id))

    # --- actual sets ------------------------------------------------------------------------

    @app.post("/api/workouts/{workout_id}/sets", status_code=201)
    def create_set(workout_id: str, body: SetCreateIn) -> PerformedSetOut:
        with _connection() as connection:
            performed = entry.add_set(
                connection,
                workout_id,
                exercise_id=body.exercise_id,
                set_type=body.set_type,
                load_kg=parse_load(body.load_kg),
                reps=body.reps,
                rir=body.rir,
                notes=body.notes,
            )
            return PerformedSetOut.of(performed)

    @app.patch("/api/sets/{set_id}")
    def patch_set(set_id: str, body: SetPatchIn) -> PerformedSetOut:
        changes = _set_changes(body)
        with _connection() as connection:
            return PerformedSetOut.of(entry.edit_set(connection, set_id, changes))

    @app.delete("/api/sets/{set_id}", status_code=204)
    def delete_set(set_id: str) -> Response:
        with _connection() as connection:
            entry.remove_set(connection, set_id)
        return Response(status_code=204)

    @app.put("/api/workouts/{workout_id}/set-order")
    def reorder(workout_id: str, body: SetOrderIn) -> list[PerformedSetOut]:
        with _connection() as connection:
            return [
                PerformedSetOut.of(performed)
                for performed in entry.reorder_sets(connection, workout_id, body.set_ids)
            ]

    @app.put("/api/workouts/{workout_id}/slots/{slot_id}/exercise")
    def substitute(workout_id: str, slot_id: str, body: SlotExerciseIn) -> EntryOut:
        with _connection() as connection:
            entry.set_slot_exercise(connection, workout_id, slot_id, body.exercise_id)
            return _entry_out(connection, workout_id)

    # --- exercises --------------------------------------------------------------------------

    @app.get("/api/exercises")
    def exercises(include_inactive: bool = False) -> list[ExerciseOut]:
        with _connection() as connection:
            return [
                ExerciseOut.of(item)
                for item in list_exercises(connection, include_inactive=include_inactive)
            ]

    @app.post("/api/exercises", status_code=201)
    def new_exercise(body: ExerciseCreateIn) -> ExerciseOut:
        exercise = create_exercise(body.name.strip(), body.equipment_label, notes=body.notes)
        with _connection() as connection:
            try:
                insert_exercise(connection, exercise)
            except sqlite3.IntegrityError as exc:
                raise entry.Conflict(
                    "an exercise with this name and equipment already exists"
                ) from exc
        return ExerciseOut.of(exercise)

    @app.get("/api/exercises/{exercise_id}/last-performance")
    def exercise_last_performance(
        exercise_id: str, exclude_workout_id: str | None = None
    ) -> LastPerformanceOut | None:
        with _connection() as connection:
            if get_exercise(connection, exercise_id) is None:
                raise entry.NotFound(f"no exercise with id {exercise_id!r}")
            return LastPerformanceOut.of(
                entry.last_performance(
                    connection, exercise_id, exclude_workout_id=exclude_workout_id
                )
            )

    # Mounted last so /api/* routes always win. Absent in dev (Vite serves the UI).
    if WEB_DIST.is_dir():
        app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")

    return app


app = create_app()
