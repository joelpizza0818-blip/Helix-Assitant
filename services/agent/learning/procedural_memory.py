"""Procedural and Semantic Long-Term Memory for HELIX Adaptive Learning.

Distills episodic experiences into a consolidated user preference profile and
procedural knowledge graph. Supports fast semantic scoring and synthesis
inspired by MemoHarness.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DEFAULT_PROFILE_PATH = Path.home() / ".helix" / "user_learned_profile.json"


class ProceduralSemanticMemory:
    """Stores long-term user habits, constraints, workflow rules, and preferences."""

    def __init__(self, storage_path: Optional[Path] = None):
        self.storage_path = Path(storage_path or DEFAULT_PROFILE_PATH)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_storage()

    def _ensure_storage(self) -> None:
        if not self.storage_path.exists():
            initial_data = {
                "version": "1.0.0",
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "preferences": {
                    "preferred_language": "es",
                    "style_preference": "concise",
                    "terminal_preference": "powershell",
                    "browser_automation": "playwright",
                },
                "learned_rules": [],
                "learned_constraints": [],
                "frequent_patterns": [],
            }
            self.save_profile(initial_data)

    def load_profile(self) -> Dict[str, Any]:
        """Loads the consolidated user profile."""
        try:
            content = self.storage_path.read_text(encoding="utf-8").strip()
            if not content:
                return {}
            return json.loads(content)
        except Exception as e:
            logger.error("Failed to load procedural memory: %s", e)
            return {}

    def save_profile(self, data: Dict[str, Any]) -> None:
        """Atomically saves the updated profile to disk."""
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        temp_file = self.storage_path.with_suffix(".tmp")
        temp_file.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        temp_file.replace(self.storage_path)

    def add_learned_rule(
        self,
        category: str,
        rule_text: str,
        confidence: float = 1.0,
        trigger_keywords: Optional[List[str]] = None,
        source_episode_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Adds or updates a procedural rule derived from user behavior or corrections."""
        profile = self.load_profile()
        rules: List[Dict[str, Any]] = profile.setdefault("learned_rules", [])

        # Avoid exact duplicates; reinforce confidence if repeated
        norm_rule = rule_text.strip().lower()
        for existing in rules:
            if existing.get("rule", "").strip().lower() == norm_rule:
                existing["confidence"] = min(5.0, existing.get("confidence", 1.0) + 0.5)
                existing["updated_at"] = datetime.now(timezone.utc).isoformat()
                existing["usage_count"] = existing.get("usage_count", 0) + 1
                self.save_profile(profile)
                return existing

        rule_entry = {
            "id": f"rule_{uuid.uuid4().hex[:8]}",
            "category": category,
            "rule": rule_text.strip(),
            "confidence": float(confidence),
            "usage_count": 1,
            "trigger_keywords": [k.lower() for k in (trigger_keywords or [])],
            "source_episode_id": source_episode_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        rules.append(rule_entry)
        self.save_profile(profile)
        logger.info("Added procedural rule [%s]: %s", rule_entry["id"], rule_text[:60])
        return rule_entry

    def prune_stale_rules(self, min_confidence: float = 0.5, max_rules: int = 50) -> int:
        """Active pruning: eliminates rules with low confidence or stale/decayed validation."""
        profile = self.load_profile()
        rules: List[Dict[str, Any]] = profile.get("learned_rules", [])
        initial_count = len(rules)

        # Keep rules exceeding threshold, sorted by confidence & usage
        filtered = [
            r for r in rules if r.get("confidence", 1.0) >= min_confidence
        ]
        filtered.sort(
            key=lambda r: (r.get("confidence", 1.0), r.get("usage_count", 1)),
            reverse=True,
        )
        profile["learned_rules"] = filtered[:max_rules]
        pruned_count = initial_count - len(profile["learned_rules"])
        if pruned_count > 0:
            self.save_profile(profile)
            logger.info("Pruned %d stale procedural rules", pruned_count)
        return pruned_count

    def find_relevant_rules(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Retrieves rules whose trigger keywords or description match the active query."""
        profile = self.load_profile()
        rules: List[Dict[str, Any]] = profile.get("learned_rules", [])
        if not rules:
            return []

        clean_words = set(re.findall(r"\w+", query.lower()))
        scored: List[tuple[float, Dict[str, Any]]] = []

        for r in rules:
            score = 0.0
            rule_words = set(re.findall(r"\w+", r.get("rule", "").lower()))
            overlap = len(clean_words.intersection(rule_words))
            score += overlap * 1.5

            triggers = set(r.get("trigger_keywords", []))
            trigger_overlap = len(clean_words.intersection(triggers))
            score += trigger_overlap * 3.0

            # Confidence weighting
            score *= r.get("confidence", 1.0)

            if score > 0.5 or overlap > 0:
                scored.append((score, r))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [item[1] for item in scored[:top_k]]
