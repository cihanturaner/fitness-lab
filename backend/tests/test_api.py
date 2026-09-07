"""HTTP boundary tests against a real (temporary) SQLite file."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fitness_lab.api.app import create_app
from fitness_lab.storage import db


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("FITNESS_LAB_DB", str(tmp_path / "api.db"))
    with TestClient(create_app()) as test_client:
        yield test_client


def test_health_reports_ok(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "fitness-lab"
    assert body["version"]


def test_ping_db_serves_the_row_read_from_sqlite(client: TestClient) -> None:
    response = client.get("/api/ping-db")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["source"] == "sqlite"
    assert body["row_id"] == 1
    assert body["token"] == db.M0_TOKEN
    assert body["sqlite_version"]


def test_ping_db_reflects_what_is_actually_stored(client: TestClient, tmp_path: Path) -> None:
    """Mutate the row behind the API's back; the endpoint must return the new value."""
    db_file = tmp_path / "api.db"
    with db.connect(db_file) as connection:
        connection.execute("UPDATE m0_technical_check SET token = ? WHERE id = 1", ("mutated",))

    assert client.get("/api/ping-db").json()["token"] == "mutated"
