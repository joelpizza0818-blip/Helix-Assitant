"""Adaptive Learning Harness for HELIX.

Unified controller implementing:
1. Multi-Layer Memory (Episodic in SQLite + Procedural/Semantic in User Profile)
2. Profile & Namespace Isolation (supports multiple profiles without cross-contamination)
3. Intent-Aware Correction Filtering (distinguishes one-off fixes from permanent rules)
4. Outcome-Driven Rule Validation & Pruning (rewards rules that work, penalizes failing rules)
5. Self-Learning Skill Pipeline (semantic coherence verification & staging before activation)
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .episodic_memory import EpisodicMemory
from .procedural_memory import ProceduralSemanticMemory
from .feedback_sensor import FeedbackSensor, AlignmentCorrection, CorrectionIntent
from .feedforward_guide import FeedforwardGuide
from .self_learning_skills import SelfLearningSkillManager

logger = logging.getLogger(__name__)


class AdaptiveLearningHarness:
    """Master controller orchestrating the entire continuous learning lifecycle."""

    _instances: Dict[str, AdaptiveLearningHarness] = {}

    @classmethod
    def get_instance(cls, profile_id: str = "default") -> AdaptiveLearningHarness:
        if profile_id not in cls._instances:
            cls._instances[profile_id] = cls(profile_id=profile_id)
        return cls._instances[profile_id]

    def __init__(
        self,
        base_dir: Optional[Path] = None,
        skill_registry=None,
        profile_id: str = "default",
    ):
        self.profile_id = profile_id
        if base_dir:
            self.base_dir = Path(base_dir)
        else:
            if profile_id and profile_id != "default":
                self.base_dir = Path.home() / ".helix" / "profiles" / profile_id
            else:
                self.base_dir = Path.home() / ".helix"

        self.base_dir.mkdir(parents=True, exist_ok=True)

        self.episodic_memory = EpisodicMemory(db_path=self.base_dir / "learning_harness.db")
        self.procedural_memory = ProceduralSemanticMemory(
            storage_path=self.base_dir / "user_learned_profile.json",
            profile_id=profile_id,
        )
        self.feedback_sensor = FeedbackSensor()
        self.feedforward_guide = FeedforwardGuide(
            user_md_path=self.base_dir / "USER.md",
            procedural_memory=self.procedural_memory,
        )
        self.skill_manager = SelfLearningSkillManager(
            skills_dir=self.base_dir / "learned_skills",
            episodic_memory=self.episodic_memory,
            skill_registry=skill_registry,
        )

        self._last_task_actions: Dict[str, List[Dict[str, Any]]] = {}
        self._last_task_rules: Dict[str, List[str]] = {}

    def process_incoming_user_message(
        self,
        user_text: str,
        session_id: str = "default",
        recent_task_id: Optional[str] = None,
    ) -> Tuple[AlignmentCorrection, str]:
        """Intercepts incoming user message, detects alignment corrections, and returns feedforward prompt."""
        prev_actions = self._last_task_actions.get(recent_task_id or "") if recent_task_id else None
        correction = self.feedback_sensor.inspect_message(user_text, previous_actions=prev_actions)

        if correction.is_correction:
            # 1. Penalize any rules applied during the previous task if the user had to correct us
            if recent_task_id and recent_task_id in self._last_task_rules:
                for rule_id in self._last_task_rules[recent_task_id]:
                    self.procedural_memory.record_rule_outcome(
                        rule_id=rule_id,
                        success=False,
                        feedback_text=user_text,
                    )

            # 2. Record negative feedback / alignment event in episodic memory for transparency
            if recent_task_id:
                self.episodic_memory.record_episode(
                    session_id=session_id,
                    task_id=f"corr_{recent_task_id}",
                    user_query=user_text,
                    actions_taken=[],
                    outcome="user_correction",
                    feedback_score=-1.0,
                    correction_notes=correction.extracted_rule or correction.trigger_text,
                )

            # 3. Only persist into procedural memory if this is an actionable long-term preference,
            # NOT a one-off task fix or raw emotional feedback!
            if correction.should_persist_rule and correction.extracted_rule:
                self.procedural_memory.add_learned_rule(
                    category=correction.correction_type,
                    rule_text=correction.extracted_rule,
                    confidence=correction.confidence,
                    trigger_keywords=user_text.split()[:4],
                    source_episode_id=recent_task_id,
                    source_type="system_inferred",
                    context_scope=correction.context_scope,
                )

                # Sync validated state to USER.md
                profile = self.procedural_memory.load_profile()
                self.feedforward_guide.sync_from_profile(profile)

        # Build feedforward prompt block for system prompt
        feedforward_prompt = self.feedforward_guide.build_feedforward_prompt(query=user_text)

        # Track relevant rules injected for this query
        relevant = self.procedural_memory.find_relevant_rules(user_text, top_k=4)
        if recent_task_id:
            self._last_task_rules[recent_task_id] = [r["id"] for r in relevant if "id" in r]

        return correction, feedforward_prompt

    def record_task_outcome(
        self,
        session_id: str,
        task_id: str,
        user_query: str,
        actions_taken: List[Dict[str, Any]],
        outcome: str = "success",
        feedback_score: float = 1.0,
    ) -> str:
        """Records task execution and triggers continuous learning consolidation."""
        self._last_task_actions[task_id] = actions_taken
        ep_id = self.episodic_memory.record_episode(
            session_id=session_id,
            task_id=task_id,
            user_query=user_query,
            actions_taken=actions_taken,
            outcome=outcome,
            feedback_score=feedback_score,
        )

        # If task succeeded, reward the rules that guided it
        if outcome == "success":
            rules_used = self._last_task_rules.get(task_id, [])
            for r_id in rules_used:
                self.procedural_memory.record_rule_outcome(rule_id=r_id, success=True)

            # Periodic consolidation / auto scenario fusion
            try:
                self.skill_manager.run_auto_fusion(min_frequency=3)
            except Exception as e:
                logger.debug("Scenario fusion check skipped: %s", e)

        return ep_id

    def run_maintenance(self) -> Dict[str, Any]:
        """Runs pruning and maintenance on procedural rules and learned skills."""
        pruned_rules = self.procedural_memory.prune_stale_rules(min_confidence=0.5)
        pruned_skills = self.skill_manager.prune_underperforming_skills()
        profile = self.procedural_memory.load_profile()
        self.feedforward_guide.sync_from_profile(profile)

        return {
            "pruned_rules_count": pruned_rules,
            "pruned_skills_count": len(pruned_skills),
            "profile_id": self.profile_id,
        }
