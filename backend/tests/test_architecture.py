"""The layering invariant: domain -> storage -> api, never the other way."""

from __future__ import annotations

import ast
from pathlib import Path

DOMAIN_DIR = Path(__file__).resolve().parents[1] / "src" / "fitness_lab" / "domain"
FORBIDDEN_FOR_DOMAIN = ("fitness_lab.storage", "fitness_lab.api", "sqlite3", "fastapi")


def _imported_modules(source: Path) -> set[str]:
    tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            names.add(node.module)
    return names


def test_domain_does_not_depend_on_outer_layers() -> None:
    offenders: list[str] = []
    for source in DOMAIN_DIR.rglob("*.py"):
        for imported in _imported_modules(source):
            if imported.startswith(FORBIDDEN_FOR_DOMAIN):
                offenders.append(f"{source.name} imports {imported}")

    assert offenders == [], f"domain layer must stay pure: {offenders}"
