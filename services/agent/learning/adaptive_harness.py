"""Adaptive Learning Harness for HELIX.

Unified controller implementing:
1. Dual-Layer Memory (Episodic in SQLite + Procedural/Semantic in User Profile)
2. Self-Learning Skill Layer (Scenario Fusion & Active Pruning)
3. Control Loop (Feedforward USER.md Guidance + Feedback Sensor for alignment errors)
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .episodic_memory import EpisodicMemory
from .procedural_memory import ProceduralSemanticMemory
from .feedback_sensor import FeedbackSensor, AlignmentCorrection
from .feedforward_guide import FeedforwardGuide
from .self_learning_skills import SelfLearningSkillManager

logger = logging.getLogger(__name__)


class AdaptiveLearningHarness:
    """Master controller orchestrating the entire continuous learning lifecycle."""

    _instance: Optional[AdaptiveLearningHarness] = None

    @classmethod
    def get_instance(cls) -> AdaptiveLearningHarness:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(
        self,
        base_dir: Optional[Path] = None,
        skill_registry=None,
    ):
        self.base_dir = Path(base_dir or (Path.home() / ".helix"))
        self.base_dir.mkdir(parents=True, exist_ok=True)

        self.episodic_memory = EpisodicMemory(db_path=self.base_dir / "learning_harness.db")
        self.procedural_memory = ProceduralSemanticMemory(storage_path=self.base_dir / "user_learned_profile.json")
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

    def process_incoming_user_message(
        self,
        user_text: str,
        session_id: str = "default",
        recent_task_id: Optional[str] = None,
    ) -> Tuple[AlignmentCorrection, str]:
        """Intercepts incoming user message, detects alignment corrections, and returns feedforward prompt."""
        prev_actions = self._last_task_actions.get(recent_task_id or "") if recent_task_id else None
        correction = self.feedback_sensor.inspect_message(user_text, previous_actions=prev_actions)

        if correction.is_correction and correction.extracted_rule:
            # Store alignment correction in procedural memory
            self.procedural_memory.add_learned_rule(
                category=correction.correction_type,
                rule_text=correction.extracted_rule,
                confidence=1.2,
                trigger_keywords=user_text.split()[:4],
                source_episode_id=recent_task_id,
            )
            # Record negative feedback in episodic memory
            if recent_task_id:
                self.episodic_memory.record_episode(
                    session_id=session_id,
                    task_id=f"corr_{recent_task_id}",
                    user_query=user_text,
                    actions_taken=[],
                    outcome="user_correction",
                    feedback_score=-1.0,
                    correction_notes=correction.extracted_rule,
                )
            # Sync to USER.md
            profile = self.procedural_memory.load_profile()
            self.feedforward_guide.sync_from_profile(profile)

        # Build feedforward prompt block for system prompt
        feedforward_prompt = self.feedforward_guide.build_feedforward_prompt(query=user_text)
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

        # Periodic consolidation / auto scenario fusion
        if outcome == "success":
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
            "pruned_skills": pruned_skills,
        }
