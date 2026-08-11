"""Compatibility imports for the SQLAlchemy persistence layer."""

from .core.clock import utc_now
from .persistence.database import Database

__all__ = ["Database", "utc_now"]
