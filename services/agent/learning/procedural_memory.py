"""Procedural and Semantic Long-Term Memory for HELIX Adaptive Learning.

Distills episodic experiences into a consolidated user preference profile and
procedural knowledge graph. Supports fast semantic scoring, rule conflict detection,
and outcome validation (improving rules that succeed, pruning/deprecating rules that fail).
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

    def __init__(
        self,
        storage_path: Optional[Path] = None,
        profile_id: str = "default",
    ):
        self.profile_id = profile_id
        if storage_path:
            self.storage_path = Path(storage_path)
        else:
            if profile_id and profile_id != "default":
                self.storage_path = Path.home() / ".helix" / "profiles" / profile_id / "user_learned_profile.json"
            else:
                self.storage_path = DEFAULT_PROFILE_PATH

        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_storage()

    def _ensure_storage(self) -> None:
        if not self.storage_path.exists():
            initial_data = {
                "version": "1.1.0",
                "profile_id": self.profile_id,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "preferences": {
                    "preferred_language": {"value": "es", "source": "user_configured"},
                    "style_preference": {"value": "concise", "source": "user_configured"},
                    "terminal_preference": {"value": "powershell", "source": "user_configured"},
                    "browser_automation": {"value": "playwright", "source": "user_configured"},
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
            data = json.loads(content)
            # Ensure learned_rules list exists
            data.setdefault("learned_rules", [])
            return data
        except Exception as e:
            logger.error("Failed to load procedural memory: %s", e)
            return {"learned_rules": [], "preferences": {}}

    def save_profile(self, data: Dict[str, Any]) -> None:
        """Atomically saves the updated profile to disk."""
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        temp_file = self.storage_path.with_suffix(".tmp")
        temp_file.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        temp_file.replace(self.storage_path)

    def detect_conflicts(self, new_rule_text: str, category: str) -> List[Dict[str, Any]]:
        """Identifies existing active rules that conflict with or are superseded by the new rule."""
        profile = self.load_profile()
        rules: List[Dict[str, Any]] = profile.get("learned_rules", [])
        conflicts = []

        new_norm = new_rule_text.lower()
        new_words = set(re.findall(r"\w+", new_norm))

        for existing in rules:
            if not existing.get("is_active", True):
                continue
            ex_norm = existing.get("rule", "").lower()
            ex_words = set(re.findall(r"\w+", ex_norm))

            # Direct opposing keywords detection (e.g. bash vs powershell, npm vs pnpm, tabs vs spaces)
            opposing_pairs = [
                ("powershell", "bash"),
                ("cmd", "bash"),
                ("npm", "pnpm"),
                ("npm", "yarn"),
                ("pnpm", "yarn"),
                ("tabs", "spaces"),
                ("concise", "verbose"),
                ("typescript", "javascript"),
            ]
            for a, b in opposing_pairs:
                if (a in new_norm and b in ex_norm) or (b in new_norm and a in ex_norm):
                    conflicts.append(existing)
                    break

            # Or substitution rule targeting an existing rule's recommendation
            if "en vez de" in new_norm or "instead of" in new_norm:
                overlap = new_words.intersection(ex_words)
                if len(overlap) >= 2:
                    conflicts.append(existing)

        return conflicts

    def add_learned_rule(
        self,
        category: str,
        rule_text: str,
        confidence: float = 1.0,
        trigger_keywords: Optional[List[str]] = None,
        source_episode_id: Optional[str] = None,
        source_type: str = "system_inferred",
        context_scope: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Adds, reinforces, or resolves conflicting procedural rules."""
        profile = self.load_profile()
        rules: List[Dict[str, Any]] = profile.setdefault("learned_rules", [])

        norm_rule = rule_text.strip().lower()

        # 1. Reinforce if duplicate
        for existing in rules:
            if existing.get("rule", "").strip().lower() == norm_rule:
                existing["confidence"] = min(5.0, existing.get("confidence", 1.0) + 0.5)
                existing["updated_at"] = datetime.now(timezone.utc).isoformat()
                existing["usage_count"] = existing.get("usage_count", 0) + 1
                existing["is_active"] = True
                self.save_profile(profile)
                logger.info("Reinforced existing rule [%s] -> confidence=%.2f", existing["id"], existing["confidence"])
                return existing

        # 2. Check for contradictions with older rules
        conflicts = self.detect_conflicts(rule_text, category)
        conflict_ids = {c["id"] for c in conflicts if "id" in c}
        new_id = f"rule_{uuid.uuid4().hex[:8]}"

        for old_rule in rules:
            if old_rule.get("id") in conflict_ids:
                logger.info("Superseding conflicting rule [%s] ('%s') with new rule [%s]", old_rule["id"], old_rule["rule"], new_id)
                old_rule["is_active"] = False
                old_rule["superseded_by"] = new_id
                old_rule["confidence"] = max(0.1, old_rule.get("confidence", 1.0) - 0.6)
                old_rule["updated_at"] = datetime.now(timezone.utc).isoformat()

        # 3. Create fresh rule
        rule_entry = {
            "id": new_id,
            "category": category,
            "rule": rule_text.strip(),
            "confidence": float(confidence),
            "usage_count": 1,
            "success_count": 0,
            "failure_count": 0,
            "is_active": True,
            "superseded_by": None,
            "source_type": source_type,
            "context_scope": context_scope,
            "trigger_keywords": [k.lower() for k in (trigger_keywords or [])],
            "source_episode_id": source_episode_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        rules.append(rule_entry)
        self.save_profile(profile)
        logger.info("Added procedural rule [%s]: %s (confidence=%.2f)", new_id, rule_text[:60], confidence)
        return rule_entry

    def record_rule_outcome(
        self,
        rule_id: str,
        success: bool,
        feedback_text: Optional[str] = None,
    ) -> bool:
        """Validates real-world effectiveness of a learned rule based on task outcome."""
        profile = self.load_profile()
        rules: List[Dict[str, Any]] = profile.get("learned_rules", [])

        target_rule = next((r for r in rules if r.get("id") == rule_id), None)
        if not target_rule:
            return False

        target_rule["usage_count"] = target_rule.get("usage_count", 0) + 1
        target_rule["updated_at"] = datetime.now(timezone.utc).isoformat()

        if success:
            target_rule["success_count"] = target_rule.get("success_count", 0) + 1
            # Proven quality increases confidence
            target_rule["confidence"] = min(5.0, target_rule.get("confidence", 1.0) + 0.15)
            logger.info("Rule [%s] validated successfully: confidence -> %.2f", rule_id, target_rule["confidence"])
        else:
            target_rule["failure_count"] = target_rule.get("failure_count", 0) + 1
            # User correction following this rule penalizes confidence significantly
            target_rule["confidence"] = max(0.0, target_rule.get("confidence", 1.0) - 0.45)
            logger.warning("Rule [%s] penalized by negative feedback: confidence -> %.2f", rule_id, target_rule["confidence"])
            if target_rule["confidence"] < 0.35:
                target_rule["is_active"] = False
                logger.info("Rule [%s] invalidated and deactivated due to low confidence", rule_id)

        self.save_profile(profile)
        return True

    def prune_stale_rules(self, min_confidence: float = 0.5, max_rules: int = 50) -> int:
        """Active pruning: eliminates rules with low confidence, superseded status, or stale records."""
        profile = self.load_profile()
        rules: List[Dict[str, Any]] = profile.get("learned_rules", [])
        initial_count = len(rules)

        # Retain active rules that exceed min_confidence and have not been superseded
        filtered = [
            r for r in rules
            if r.get("confidence", 1.0) >= min_confidence
            and r.get("is_active", True)
            and not r.get("superseded_by")
        ]
        filtered.sort(
            key=lambda r: (r.get("confidence", 1.0), r.get("success_count", 0), r.get("usage_count", 1)),
            reverse=True,
        )
        profile["learned_rules"] = filtered[:max_rules]
        pruned_count = initial_count - len(profile["learned_rules"])
        if pruned_count > 0:
            self.save_profile(profile)
            logger.info("Pruned %d stale or invalidated procedural rules", pruned_count)
        return pruned_count

    def find_relevant_rules(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Retrieves active, high-confidence rules matching the active query."""
        profile = self.load_profile()
        rules: List[Dict[str, Any]] = profile.get("learned_rules", [])
        if not rules:
            return []

        clean_words = set(re.findall(r"\w+", query.lower()))
        scored: List[tuple[float, Dict[str, Any]]] = []

        for r in rules:
            if not r.get("is_active", True):
                continue

            score = 0.0
            rule_words = set(re.findall(r"\w+", r.get("rule", "").lower()))
            overlap = len(clean_words.intersection(rule_words))
            if overlap > 0:
                score += overlap * 1.5

            keywords = set(r.get("trigger_keywords", []))
            kw_overlap = len(clean_words.intersection(keywords))
            score += kw_overlap * 2.5

            # Context scope boost
            scope = r.get("context_scope")
            if scope and scope.lower() in query.lower():
                score += 3.0

            # Quality factor based on success ratio and confidence
            confidence = r.get("confidence", 1.0)
            successes = r.get("success_count", 0)
            failures = r.get("failure_count", 0)
            total = successes + failures
            quality_factor = (successes + 1.0) / (total + 1.0) if total > 0 else 1.0

            final_score = score * confidence * quality_factor
            if final_score > 0.0 or score > 0.0:
                scored.append((final_score, r))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [item[1] for item in scored[:top_k]]
