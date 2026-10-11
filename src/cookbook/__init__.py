"""Cookbook: validate recipe/meal JSON files and compile the static site.

Standard library only. See cookbook/README.md for the data format.
Build with ``PYTHONPATH=src python3 -m cookbook``.
"""

from .schema import (
    EFFORTS,
    ROLES,
    ValidationError,
    validate_meal,
    validate_recipe,
)

__all__ = ["EFFORTS", "ROLES", "ValidationError", "validate_meal", "validate_recipe"]
