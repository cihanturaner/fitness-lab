"""The layering invariant: domain -> storage -> api, never the other way."""

from __future__ import annotations

import ast
import re
from pathlib import Path

SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
DOMAIN_DIR = SRC_ROOT / "fitness_lab" / "domain"
FORBIDDEN_FOR_DOMAIN = ("fitness_lab.storage", "fitness_lab.api", "sqlite3", "fastapi")
STORAGE_DIR = SRC_ROOT / "fitness_lab" / "storage"
FORBIDDEN_FOR_STORAGE = ("fitness_lab.api", "fastapi")
GRAMS_TOKEN = re.compile(r"\bload_g\b")


def _containing_package(source: Path, src_root: Path) -> str:
    """Dotted package a relative import in ``source`` resolves against.

    A plain module's own package is its parent directory's dotted path; an
    ``__init__.py`` counts as the package it lives in, which is the same computation
    (drop the last path component either way).
    """
    relative = source.relative_to(src_root).with_suffix("")
    return ".".join(relative.parts[:-1])


def _resolve_relative(package: str, level: int, module: str | None) -> str:
    """Resolve ``from . import x`` / ``from ..pkg import y`` against ``package``."""
    parts = package.split(".") if package else []
    drop = level - 1
    base_parts = parts[: len(parts) - drop] if drop <= len(parts) else []
    base = ".".join(base_parts)
    if module:
        return f"{base}.{module}" if base else module
    return base


def _imported_modules(source: Path, src_root: Path = SRC_ROOT) -> set[str]:
    tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
    package = _containing_package(source, src_root)
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level > 0:
                base = _resolve_relative(package, node.level, node.module)
                if node.module is not None:
                    names.add(base)
                else:
                    names.update(
                        f"{base}.{alias.name}" if base else alias.name for alias in node.names
                    )
            elif node.module is not None:
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


def test_a_relative_cross_layer_import_is_caught(tmp_path: Path) -> None:
    """A same-package-looking ``from ..storage import db`` must not evade the guard.

    Reproduced against the pre-fix guard: ``ast.parse`` reports this as
    ``ImportFrom(module='storage', level=2)``, and the plain prefix check against
    ``"fitness_lab.storage"`` never fires because the resolved string was just
    ``"storage"``. This test builds a throwaway ``src/fitness_lab/domain/`` tree so the
    real domain package is never touched, and proves the relative import now resolves
    to the fully-qualified, forbidden module name.
    """
    fake_src = tmp_path / "src"
    fake_domain = fake_src / "fitness_lab" / "domain"
    fake_domain.mkdir(parents=True)
    offender = fake_domain / "sneaky.py"
    offender.write_text("from ..storage import db\n", encoding="utf-8")

    imported = _imported_modules(offender, src_root=fake_src)

    assert any(name.startswith(FORBIDDEN_FOR_DOMAIN) for name in imported), (
        f"relative import should have resolved to a forbidden module: {imported}"
    )


def test_domain_never_references_the_grams_column() -> None:
    """The domain speaks kilograms. ``load_g`` is a storage representation detail."""
    offenders = [
        f"{source.name}:{number}"
        for source in DOMAIN_DIR.rglob("*.py")
        for number, line in enumerate(source.read_text(encoding="utf-8").splitlines(), start=1)
        if GRAMS_TOKEN.search(line)
    ]

    assert offenders == [], f"grams must not leak into the domain layer: {offenders}"
