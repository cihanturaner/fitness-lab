"""The layering invariant: domain -> storage -> api, never the other way."""

from __future__ import annotations

import ast
import re
from pathlib import Path

DOMAIN_DIR = Path(__file__).resolve().parents[1] / "src" / "fitness_lab" / "domain"
FORBIDDEN_FOR_DOMAIN = ("fitness_lab.storage", "fitness_lab.api", "sqlite3", "fastapi")
STORAGE_DIR = Path(__file__).resolve().parents[1] / "src" / "fitness_lab" / "storage"
FORBIDDEN_FOR_STORAGE = ("fitness_lab.api", "fastapi")
GRAMS_TOKEN = re.compile(r"\bload_g\b")


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


def test_storage_does_not_depend_on_the_api_layer() -> None:
    offenders: list[str] = []
    for source in STORAGE_DIR.rglob("*.py"):
        for imported in _imported_modules(source):
            if imported.startswith(FORBIDDEN_FOR_STORAGE):
                offenders.append(f"{source.name} imports {imported}")

    assert offenders == [], f"storage must not depend on the HTTP boundary: {offenders}"


def test_domain_never_references_the_grams_column() -> None:
    """The domain speaks kilograms. ``load_g`` is a storage representation detail."""
    offenders = [
        f"{source.name}:{number}"
        for source in DOMAIN_DIR.rglob("*.py")
        for number, line in enumerate(source.read_text(encoding="utf-8").splitlines(), start=1)
        if GRAMS_TOKEN.search(line)
    ]

    assert offenders == [], f"grams must not leak into the domain layer: {offenders}"
