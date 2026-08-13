from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


class AccountRestoreError(RuntimeError):
    """A diagnostic account could not be returned to its recorded state."""


@dataclass(slots=True)
class WorkerRuntime:
    index: int
    worker_id: str
    status: str
    started_at: datetime
    state_changed_at: datetime
    last_heartbeat_at: datetime
    current_run_id: str = ""
    current_account_id: int | None = None
    current_account_name: str = ""
    current_profile_id: str = ""
    current_profile_name: str = ""
    current_execution_mode: str = ""
    current_round: int | None = None
    current_target_key: str = ""
    current_run_started_at: datetime | None = None
    completed_runs: int = 0
    failed_runs: int = 0
    last_error: str = ""
