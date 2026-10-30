"""Episodic Memory for HELIX Adaptive Learning Harness.

Stores raw session episodes (queries, tool actions taken, outcomes, and user corrections)
in a persistent SQLite database at ~/.helix/learning_harness.db.
Inspired by MemoHarness short-term episodic memory architecture.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DEFAULT_LEARNING_DB_PATH = Path.home() / ".helix" / "learning_harness.db"


class EpisodicMemory:
    """Manages raw task episodes and feedback logs in SQLite."""

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = Path(db_path or DEFAULT_LEARNING_DB_PATH)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS episodes (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    user_query TEXT NOT NULL,
                    intent_category TEXT,
                    actions_taken TEXT,
                    tool_sequence TEXT,
                    outcome TEXT NOT NULL,
                    feedback_score REAL DEFAULT 0.0,
                    correction_notes TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_episodes_outcome ON episodes(outcome)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_episodes_created ON episodes(created_at)"
            )
            conn.commit()

    def record_episode(
        self,
        session_id: str,
        task_id: str,
        user_query: str,
        actions_taken: List[Dict[str, Any]],
        outcome: str = "success",
        intent_category: Optional[str] = None,
        feedback_score: float = 1.0,
        correction_notes: Optional[str] = None,
    ) -> str:
        """Records an episodic interaction."""
        episode_id = f"ep_{uuid.uuid4().hex[:12]}"
        created_at = datetime.now(timezone.utc).isoformat()
        tools = [
            a.get("tool") or a.get("action")
            for a in actions_taken
            if isinstance(a, dict) and (a.get("tool") or a.get("action"))
        ]
        tool_sequence_str = json.dumps(tools)
        actions_json = json.dumps(actions_taken, ensure_ascii=False)

        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO episodes (
                    id, session_id, task_id, user_query, intent_category,
                    actions_taken, tool_sequence, outcome, feedback_score,
                    correction_notes, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    episode_id,
                    session_id,
                    task_id,
                    user_query.strip(),
                    intent_category or "general",
                    actions_json,
                    tool_sequence_str,
                    outcome,
                    float(feedback_score),
                    correction_notes or "",
                    created_at,
                ),
            )
            conn.commit()

        logger.info(
            "Recorded episode %s for task %s (outcome: %s)",
            episode_id,
            task_id,
            outcome,
        )
        return episode_id

    def get_recent_episodes(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Retrieves the most recent episodes across sessions."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT id, session_id, task_id, user_query, intent_category,
                       actions_taken, tool_sequence, outcome, feedback_score,
                       correction_notes, created_at
                FROM episodes
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (max(1, limit),),
            )
            rows = cursor.fetchall()

        result = []
        for r in rows:
            d = dict(r)
            try:
                d["actions_taken"] = json.loads(d["actions_taken"])
            except Exception:
                d["actions_taken"] = []
            try:
                d["tool_sequence"] = json.loads(d["tool_sequence"])
            except Exception:
                d["tool_sequence"] = []
            result.append(d)
        return result

    def get_recent_corrections(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Fetches episodes marked as user corrections or failures."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT id, session_id, task_id, user_query, intent_category,
                       actions_taken, tool_sequence, outcome, feedback_score,
                       correction_notes, created_at
                FROM episodes
                WHERE outcome IN ('user_correction', 'failure')
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (max(1, limit),),
            )
            rows = cursor.fetchall()

        result = []
        for r in rows:
            d = dict(r)
            try:
                d["actions_taken"] = json.loads(d["actions_taken"])
            except Exception:
                d["actions_taken"] = []
            result.append(d)
        return result

    def find_frequent_tool_sequences(
        self, min_frequency: int = 2, min_length: int = 2
    ) -> List[Dict[str, Any]]:
        """Identifies recurring successful action sequences for skill synthesis."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT tool_sequence, count(*) as freq, group_concat(user_query, ' || ') as sample_queries
                FROM episodes
                WHERE outcome = 'success' AND tool_sequence != '[]'
                GROUP BY tool_sequence
                HAVING count(*) >= ?
                ORDER BY count(*) DESC
                """,
                (min_frequency,),
            )
            rows = cursor.fetchall()

        frequent = []
        for r in rows:
            try:
                seq = json.loads(r["tool_sequence"])
            except Exception:
                continue
            if len(seq) >= min_length:
                frequent.append(
                    {
                        "sequence": seq,
                        "frequency": r["freq"],
                        "queries": str(r["sample_queries"]).split(" || ")[:3],
                    }
                )
        return frequent
