"""V3.3.1 over HTTP with the real locked program: a typed new exercise for one workout, and
two slots performed as the same exercise that stay two slots — in the workout, on
completion, in the day timeline and in exercise history. Plus migration 0008's guards."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, NamedTuple

import pytest
from fastapi.testclient import TestClient

from fitness_lab.domain.exercise_names import name_key, typed_exercise_name
from fitness_lab.domain.placement import SetFacts, SlotFacts, group_sets, place_sets
from fitness_lab.storage import db
from test_v33 import complete, open_session, program_rows, slot_named

DAY = "2026-10-01"
NEXT_WEEK = "2026-10-08"


class Result(NamedTuple):
    status_code: int
    body: Any


def typed(client: TestClient, workout_id: str, slot_id: str, name: str) -> Result:
    response = client.put(
        f"/api/workouts/{workout_id}/slots/{slot_id}/typed-exercise", json={"name": name}
    )
    return Result(response.status_code, response.json())


def add_in_slot(
    client: TestClient, workout_id: str, slot: dict[str, Any], lb: str, reps: int
) -> dict[str, Any]:
    response = client.post(
        f"/api/workouts/{workout_id}/sets",
        json={
            "exercise_id": slot["effective_exercise_id"],
            "slot_id": slot["id"],
            "load_lb": lb,
            "reps": reps,
            "rir": 2,
        },
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def entry_of(client: TestClient, workout_id: str) -> dict[str, Any]:
    body: dict[str, Any] = client.get(f"/api/workouts/{workout_id}/entry").json()
    return body


# --- pure rules ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "name"),
    [
        ("triceps curl", "Triceps Curl"),
        ("  triceps   curl ", "Triceps Curl"),
        ("one-arm cable row", "One-Arm Cable Row"),
        ("farmer's walk", "Farmer's Walk"),
        ("45° leg press", "45° Leg Press"),
        ("EZ-bar curl", "EZ-bar curl"),
        ("RDL", "RDL"),
    ],
)
def test_a_typed_name_is_trimmed_collapsed_and_title_cased_only_when_all_lowercase(
    text: str, name: str
) -> None:
    assert typed_exercise_name(text) == name


def test_a_typed_name_must_say_something() -> None:
    for text in ("", "   ", "x" * 81):
        with pytest.raises(ValueError):
            typed_exercise_name(text)
    assert name_key("Triceps  CURL ") == name_key("triceps curl")


def test_placement_keeps_two_slots_of_one_exercise_apart_and_legacy_sets_go_first() -> None:
    slots = [
        SlotFacts("s1", 1, "pressdown", "curl"),
        SlotFacts("s2", 2, "pec-deck", "curl"),
    ]
    sets = [
        SetFacts("a", "curl", 1),
        SetFacts("b", "curl", 2),
        SetFacts("c", "curl", 3),
        SetFacts("legacy", "curl", 4),
        SetFacts("extra", "dip", 5),
    ]
    placed = {"a": "s1", "b": "s2", "c": "s2"}
    assert place_sets(slots, sets, placed) == {
        "a": "s1",
        "b": "s2",
        "c": "s2",
        "legacy": "s1",
        "extra": None,
    }
    groups = group_sets(slots, sets, placed)
    assert [(group.slot and group.slot.slot_id, group.set_ids) for group in groups] == [
        ("s1", ("a", "legacy")),
        ("s2", ("b", "c")),
        (None, ("extra",)),
    ]
    assert [group.planned_exercise_id for group in groups] == ["pressdown", "pec-deck", None]


# --- free-text replacement -----------------------------------------------------------------


def test_a_typed_new_exercise_is_created_once_and_used_for_this_workout_only(
    client: TestClient, locked: dict[str, Any], db_file: Path
) -> None:
    before = program_rows(db_file)
    entry = open_session(client, locked["planned"]["Upper B"], DAY)
    workout_id = entry["workout"]["id"]
    pressdown = slot_named(entry, "Cable Pressdown")

    changed = typed(client, workout_id, pressdown["id"], "  triceps   curl ")
    assert changed.status_code == 200, changed.body
    slot = next(item for item in changed.body["slots"] if item["id"] == pressdown["id"])
    performed = changed.body["exercises"][slot["effective_exercise_id"]]
    assert performed["name"] == "Triceps Curl" and performed["equipment_label"] is None
    assert slot["exercise_id"] == pressdown["exercise_id"]  # the plan still says Pressdown

    # The same name again, in any case or spacing, is the same identity — never a duplicate.
    again = typed(client, workout_id, pressdown["id"], "TRICEPS CURL")
    assert again.status_code == 200, again.body
    names = [item["name"] for item in client.get("/api/exercises").json()]
    assert names.count("Triceps Curl") == 1

    # An existing identity is reused by its own name.
    existing = typed(client, workout_id, pressdown["id"], "bayesian cable curl")
    assert existing.status_code == 200
    reused = next(item for item in existing.body["slots"] if item["id"] == pressdown["id"])
    assert reused["effective_exercise_id"] == locked["exercises"]["Bayesian Cable Curl"]

    typed(client, workout_id, pressdown["id"], "Triceps Curl")
    add_in_slot(
        client, workout_id, slot_named(entry_of(client, workout_id), "Cable Pressdown"), "40", 12
    )
    complete(client, workout_id)

    # The locked program is untouched and next week's session opens on the planned exercise.
    assert program_rows(db_file) == before
    nxt = open_session(client, locked["planned"]["Upper B"], NEXT_WEEK)
    assert slot_named(nxt, "Cable Pressdown")["substitute_exercise_id"] is None

    # History keeps both identities.
    day = client.get("/api/history/days").json()["days"]
    shown = next(d for d in day if d["date"] == DAY)["workouts"][0]["exercises"]
    curl = next(item for item in shown if item["exercise"]["name"] == "Triceps Curl")
    assert curl["planned_exercise"]["name"] == "Cable Pressdown"


def test_a_typed_exercise_is_refused_when_blank_retired_or_the_workout_is_complete(
    client: TestClient, locked: dict[str, Any], db_file: Path
) -> None:
    entry = open_session(client, locked["planned"]["Upper B"], DAY)
    workout_id = entry["workout"]["id"]
    slot_id = slot_named(entry, "Cable Pressdown")["id"]
    assert typed(client, workout_id, slot_id, "   ").status_code == 422

    with db.connection_scope(db_file) as connection:
        connection.execute(
            "INSERT INTO exercise (id, name, equipment_label, notes, is_active, created_at_utc, "
            "updated_at_utc) VALUES ('retired1', 'Old Curl', NULL, NULL, 0, 'x', 'x')"
        )
    refused = typed(client, workout_id, slot_id, "old  curl")
    assert refused.status_code == 409 and "retired" in refused.body["detail"]
    names = [item["name"] for item in client.get("/api/exercises?include_inactive=true").json()]
    assert names.count("Old Curl") == 1

    add_in_slot(client, workout_id, slot_named(entry, "Cable Pressdown"), "50", 10)
    complete(client, workout_id)
    assert typed(client, workout_id, slot_id, "Triceps Curl").status_code == 409


# --- independent slots ---------------------------------------------------------------------


def test_two_slots_changed_to_one_exercise_keep_their_own_sets_and_identities(
    client: TestClient, locked: dict[str, Any], db_file: Path
) -> None:
    entry = open_session(client, locked["planned"]["Upper B"], DAY)
    workout_id = entry["workout"]["id"]
    pressdown = slot_named(entry, "Cable Pressdown")
    pec_deck = slot_named(entry, "Reverse Pec Deck")
    assert typed(client, workout_id, pressdown["id"], "triceps curl").status_code == 200
    assert typed(client, workout_id, pec_deck["id"], "Triceps Curl").status_code == 200

    current = entry_of(client, workout_id)
    first = next(item for item in current["slots"] if item["id"] == pressdown["id"])
    second = next(item for item in current["slots"] if item["id"] == pec_deck["id"])
    assert first["effective_exercise_id"] == second["effective_exercise_id"]
    a1 = add_in_slot(client, workout_id, first, "40", 12)
    b1 = add_in_slot(client, workout_id, second, "25", 15)
    a2 = add_in_slot(client, workout_id, first, "40", 11)
    b2 = add_in_slot(client, workout_id, second, "25", 14)
    b3 = add_in_slot(client, workout_id, second, "25", 13)

    sets = {item["id"]: item["slot_id"] for item in entry_of(client, workout_id)["sets"]}
    assert sets == {
        a1["id"]: pressdown["id"],
        a2["id"]: pressdown["id"],
        b1["id"]: pec_deck["id"],
        b2["id"]: pec_deck["id"],
        b3["id"]: pec_deck["id"],
    }
    assert a1["slot_id"] == pressdown["id"]

    # Deleting and reordering keep each set in its own slot.
    assert client.delete(f"/api/sets/{b3['id']}").status_code == 204
    order = [b2["id"], a2["id"], b1["id"], a1["id"]]
    assert (
        client.put(f"/api/workouts/{workout_id}/set-order", json={"set_ids": order}).status_code
        == 200
    )
    complete(client, workout_id)
    after = {item["id"]: item["slot_id"] for item in entry_of(client, workout_id)["sets"]}
    assert after == {
        a1["id"]: pressdown["id"],
        a2["id"]: pressdown["id"],
        b1["id"]: pec_deck["id"],
        b2["id"]: pec_deck["id"],
    }

    # The day timeline: two groups, each with its own planned exercise and its own sets.
    day = client.get("/api/history/days").json()["days"][0]
    groups = [
        (item["exercise"]["name"], item["planned_exercise"]["name"], len(item["sets"]))
        for item in day["workouts"][0]["exercises"]
        if item["exercise"]["name"] == "Triceps Curl"
    ]
    assert sorted(groups) == [
        ("Triceps Curl", "Cable Pressdown", 2),
        ("Triceps Curl", "Reverse Pec Deck", 2),
    ]

    # Exercise history: one exposure per slot, each "in place of" its own planned exercise.
    curl_id = first["effective_exercise_id"]
    exposures = client.get(f"/api/exercises/{curl_id}/history").json()["exposures"]
    assert sorted(
        (item["replaced"]["name"], [s["load_lb"] for s in item["sets"]]) for item in exposures
    ) == [("Cable Pressdown", ["40", "40"]), ("Reverse Pec Deck", ["25", "25"])]
    assert len({item["slot_id"] for item in exposures}) == 2

    # Home's last session shows the two slots apart too.
    recent = client.get("/api/history/recent?limit=1").json()[0]
    curls = [item for item in recent["exercises"] if item["exercise"]["name"] == "Triceps Curl"]
    assert sorted(len(item["sets"]) for item in curls) == [2, 2]


def test_changing_a_slot_after_sets_moves_them_to_extra_work_never_to_another_slot(
    client: TestClient, locked: dict[str, Any]
) -> None:
    entry = open_session(client, locked["planned"]["Upper B"], DAY)
    workout_id = entry["workout"]["id"]
    pressdown = slot_named(entry, "Cable Pressdown")
    saved = add_in_slot(client, workout_id, pressdown, "50", 10)
    assert typed(client, workout_id, pressdown["id"], "Triceps Curl").status_code == 200
    current = entry_of(client, workout_id)
    assert current["sets"][0]["id"] == saved["id"]
    assert current["sets"][0]["slot_id"] is None  # extra work of Cable Pressdown now
    assert current["sets"][0]["exercise_id"] == pressdown["exercise_id"]

    # Back to the planned exercise: the set is not re-placed silently, it stays extra work,
    # and new sets go into the slot.
    back = client.put(
        f"/api/workouts/{workout_id}/slots/{pressdown['id']}/exercise",
        json={"exercise_id": pressdown["exercise_id"]},
    )
    assert back.status_code == 200
    fresh = add_in_slot(client, workout_id, pressdown, "50", 9)
    assert fresh["slot_id"] == pressdown["id"]


def test_a_set_is_refused_in_a_slot_of_another_exercise_or_another_workout(
    client: TestClient, locked: dict[str, Any]
) -> None:
    entry = open_session(client, locked["planned"]["Upper B"], DAY)
    other = open_session(client, locked["planned"]["Upper A"], DAY)
    workout_id = entry["workout"]["id"]
    pressdown = slot_named(entry, "Cable Pressdown")
    wrong_exercise = client.post(
        f"/api/workouts/{workout_id}/sets",
        json={
            "exercise_id": locked["exercises"]["Preacher Curl"],
            "slot_id": pressdown["id"],
            "reps": 5,
        },
    )
    assert wrong_exercise.status_code == 422
    foreign = client.post(
        f"/api/workouts/{other['workout']['id']}/sets",
        json={"exercise_id": pressdown["exercise_id"], "slot_id": pressdown["id"], "reps": 5},
    )
    assert foreign.status_code == 409
    unplanned = client.post("/api/workouts", json={"performed_on": DAY}).json()
    refused = client.post(
        f"/api/workouts/{unplanned['id']}/sets",
        json={"exercise_id": pressdown["exercise_id"], "slot_id": pressdown["id"], "reps": 5},
    )
    assert refused.status_code == 409
    assert entry_of(client, workout_id)["sets"] == []


def test_editing_a_placed_sets_exercise_makes_it_extra_work(
    client: TestClient, locked: dict[str, Any]
) -> None:
    entry = open_session(client, locked["planned"]["Upper B"], DAY)
    workout_id = entry["workout"]["id"]
    pressdown = slot_named(entry, "Cable Pressdown")
    saved = add_in_slot(client, workout_id, pressdown, "50", 10)
    moved = client.patch(
        f"/api/sets/{saved['id']}", json={"exercise_id": locked["exercises"]["Preacher Curl"]}
    )
    assert moved.status_code == 200, moved.text
    assert entry_of(client, workout_id)["sets"][0]["slot_id"] is None


# --- 0008 guards ---------------------------------------------------------------------------


def _raw(db_file: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(db_file)
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def test_0008_triggers_refuse_inconsistent_placements(
    client: TestClient, locked: dict[str, Any], db_file: Path
) -> None:
    entry = open_session(client, locked["planned"]["Upper B"], DAY)
    workout_id = entry["workout"]["id"]
    pressdown = slot_named(entry, "Cable Pressdown")
    curl = slot_named(entry, "Bayesian Cable Curl")
    saved = add_in_slot(client, workout_id, pressdown, "50", 10)
    connection = _raw(db_file)
    try:
        # A placement never changes, and never names a slot of another exercise.
        with pytest.raises(sqlite3.IntegrityError, match="never changes"):
            connection.execute(
                "UPDATE performed_set_slot SET slot_id = ? WHERE set_id = ?",
                (curl["id"], saved["id"]),
            )
        connection.execute("DELETE FROM performed_set_slot WHERE set_id = ?", (saved["id"],))
        with pytest.raises(sqlite3.IntegrityError, match="own exercise"):
            connection.execute(
                "INSERT INTO performed_set_slot VALUES (?, ?, ?, ?, 'x')",
                (saved["id"], workout_id, entry["origin"]["planned_workout_id"], curl["id"]),
            )
        connection.rollback()
        # A placed set keeps its exercise; a slot keeps the exercise of its placed sets.
        with pytest.raises(sqlite3.IntegrityError, match="keeps that slot"):
            connection.execute(
                "UPDATE performed_set SET exercise_id = ? WHERE id = ?",
                (curl["exercise_id"], saved["id"]),
            )
        with pytest.raises(sqlite3.IntegrityError, match="another exercise"):
            connection.execute(
                "INSERT INTO workout_slot_substitution VALUES (?, ?, ?, ?, 'x', 'x')",
                (
                    workout_id,
                    entry["origin"]["planned_workout_id"],
                    pressdown["id"],
                    curl["exercise_id"],
                ),
            )
        connection.rollback()
    finally:
        connection.close()

    # Complete: nothing about placements changes; the guarded delete still removes it all.
    complete(client, workout_id)
    connection = _raw(db_file)
    try:
        with pytest.raises(sqlite3.IntegrityError, match="complete"):
            connection.execute("DELETE FROM performed_set_slot WHERE set_id = ?", (saved["id"],))
    finally:
        connection.close()
    assert client.post(f"/api/workouts/{workout_id}/reopen").status_code == 200
    assert client.delete(f"/api/workouts/{workout_id}").status_code == 204
    with db.connection_scope(db_file) as connection:
        assert connection.execute("SELECT count(*) FROM performed_set_slot").fetchone()[0] == 0


def test_a_complete_workout_with_placements_can_still_be_deleted_by_the_guarded_path(
    client: TestClient, locked: dict[str, Any], db_file: Path
) -> None:
    from fitness_lab.storage.workouts import delete_complete_workout

    entry = open_session(client, locked["planned"]["Upper B"], DAY)
    workout_id = entry["workout"]["id"]
    pressdown = slot_named(entry, "Cable Pressdown")
    assert typed(client, workout_id, pressdown["id"], "Triceps Curl").status_code == 200
    add_in_slot(
        client, workout_id, slot_named(entry_of(client, workout_id), "Cable Pressdown"), "40", 10
    )
    complete(client, workout_id)
    with db.connection_scope(db_file) as connection:
        delete_complete_workout(
            connection, workout_id, db_path=db_file, i_understand_this_deletes_evidence=True
        )
        for table in (
            "workout",
            "performed_set",
            "performed_set_slot",
            "workout_slot_substitution",
        ):
            assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
