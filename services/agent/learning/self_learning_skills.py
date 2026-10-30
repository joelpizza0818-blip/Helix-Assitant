"""Self-Learning Skill Layer for HELIX Adaptive Harness.

Implements safe and verified skill acquisition:
- Pattern Discovery & Coherence Validation: Checks that repeating tool sequences
  share semantic intent and positive outcomes before creating candidate skills.
- Multi-Stage Lifecycle: Staged (in evaluation) -> Validated (active in registry) -> Deprecated.
- Active Telemetry & Pruning: Monitors usage, success, and user rejections; automatically
  prunes skills that underperform or produce misalignments.
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

DEFAULT_LEARNED_SKILLS_DIR = Path.home() / ".helix" / "learned_skills"


class SelfLearningSkillManager:
    """Manages the lifecycle of automatically created, validated, and pruned skills."""

    def __init__(
        self,
        skills_dir: Optional[Path] = None,
        episodic_memory=None,
        skill_registry=None,
    ):
        self.skills_dir = Path(skills_dir or DEFAULT_LEARNED_SKILLS_DIR)
        self.skills_dir.mkdir(parents=True, exist_ok=True)
        self.episodic_memory = episodic_memory
        self.skill_registry = skill_registry
        self.metrics_file = self.skills_dir / "skills_telemetry.json"
        self._ensure_metrics()

    def _ensure_metrics(self) -> None:
        if not self.metrics_file.exists():
            self.metrics_file.write_text("{}", encoding="utf-8")

    def load_telemetry(self) -> Dict[str, Dict[str, Any]]:
        try:
            content = self.metrics_file.read_text(encoding="utf-8").strip()
            return json.loads(content) if content else {}
        except Exception:
            return {}

    def save_telemetry(self, data: Dict[str, Dict[str, Any]]) -> None:
        temp = self.metrics_file.with_suffix(".tmp")
        temp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        temp.replace(self.metrics_file)

    def record_skill_usage(self, skill_name: str, succeeded: bool = True) -> None:
        """Records telemetry when a learned skill is triggered."""
        telemetry = self.load_telemetry()
        entry = telemetry.setdefault(
            skill_name,
            {
                "status": "staged",
                "invocations": 0,
                "successes": 0,
                "rejections": 0,
                "last_used": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        entry["invocations"] += 1
        if succeeded:
            entry["successes"] += 1
        else:
            entry["rejections"] += 1
        entry["last_used"] = datetime.now(timezone.utc).isoformat()

        # Auto-promote to validated if proven reliable
        if entry["invocations"] >= 3 and (entry["successes"] / entry["invocations"]) >= 0.8:
            if entry.get("status") == "staged":
                entry["status"] = "validated"
                logger.info("Skill [%s] promoted to VALIDATED status based on telemetry", skill_name)

        self.save_telemetry(telemetry)

    def validate_semantic_coherence(self, queries: List[str]) -> bool:
        """Validates that a set of queries sharing a tool sequence have coherent intent.

        Prevents accidental skill creation from unrelated tasks that happened to use similar tools.
        """
        if len(queries) < 2:
            return True

        # Extract words from each query
        token_sets = [set(re.findall(r"\w{3,}", q.lower())) for q in queries if q.strip()]
        if not token_sets:
            return False

        # Calculate pairwise Jaccard overlap
        overlaps = []
        for i in range(len(token_sets)):
            for j in range(i + 1, len(token_sets)):
                union = token_sets[i].union(token_sets[j])
                if not union:
                    continue
                intersection = token_sets[i].intersection(token_sets[j])
                overlaps.append(len(intersection) / len(union))

        if not overlaps:
            return False

        avg_overlap = sum(overlaps) / len(overlaps)
        # Require a minimum shared vocabulary / intent
        return avg_overlap >= 0.15

    def synthesize_skill_from_pattern(
        self,
        name: str,
        description: str,
        tool_sequence: List[str],
        sample_queries: List[str],
        status: str = "staged",
    ) -> Optional[Path]:
        """Synthesizes a new self-learned skill with frontmatter and instructions.

        Starts in 'staged' mode unless explicitly validated.
        """
        if len(tool_sequence) < 2:
            logger.debug("Refusing to synthesize skill for trivial sequence of length < 2")
            return None

        clean_name = re.sub(r"[^a-z0-9_-]", "-", name.lower().strip()).strip("-")
        if not clean_name:
            clean_name = f"learned-skill-{uuid.uuid4().hex[:6]}"

        skill_folder = self.skills_dir / clean_name
        skill_folder.mkdir(parents=True, exist_ok=True)
        skill_file = skill_folder / "SKILL.md"

        triggers_yaml = "\n".join([f"  - \"{q.strip()}\"" for q in sample_queries[:4]])
        tools_yaml = "\n".join([f"  - \"{t.strip()}\"" for t in tool_sequence])

        content = f"""---
name: {clean_name}
description: "{description}"
version: "1.0.0"
status: "{status}"
triggers:
{triggers_yaml}
tools:
{tools_yaml}
---

# Learned Skill: {clean_name}

> Stage: {status.upper()} · Synthesized by HELIX Self-Learning Skill Layer.

## Instructions
1. When the user requests an operation matching these patterns ({', '.join(sample_queries[:2])}):
2. Execute the verified tool sequence in order:
{chr(10).join([f"   - Step {idx+1}: `{tool}`" for idx, tool in enumerate(tool_sequence)])}
3. Confirm the outcome concisely.
"""
        skill_file.write_text(content, encoding="utf-8")
        logger.info("Synthesized self-learned skill (%s) at: %s", status, skill_file)

        # Update telemetry
        telemetry = self.load_telemetry()
        telemetry[clean_name] = {
            "status": status,
            "invocations": 1,
            "successes": 1,
            "rejections": 0,
            "last_used": datetime.now(timezone.utc).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.save_telemetry(telemetry)

        # Only register in live agent registry if validated
        if status == "validated" and self.skill_registry is not None:
            self._register_in_live_catalog(clean_name, skill_file)

        return skill_file

    def _register_in_live_catalog(self, clean_name: str, skill_file: Path) -> None:
        try:
            from services.agent.skills.skill_loader import SkillLoader
            loader = SkillLoader()
            skill_def = loader.load_from_file(str(skill_file))
            self.skill_registry.register_skill(skill_def)
            logger.info("Successfully registered validated skill [%s] into live registry", clean_name)
        except Exception as e:
            logger.warning("Could not register skill [%s]: %s", clean_name, e)

    def promote_staged_skill(self, skill_name: str) -> bool:
        """Promotes a staged skill to validated status and registers it in the live registry."""
        skill_folder = self.skills_dir / skill_name
        skill_file = skill_folder / "SKILL.md"
        if not skill_file.exists():
            return False

        telemetry = self.load_telemetry()
        entry = telemetry.setdefault(skill_name, {})
        entry["status"] = "validated"
        self.save_telemetry(telemetry)

        # Update file content
        content = skill_file.read_text(encoding="utf-8")
        content = content.replace('status: "staged"', 'status: "validated"')
        content = content.replace('Stage: STAGED', 'Stage: VALIDATED')
        skill_file.write_text(content, encoding="utf-8")

        if self.skill_registry is not None:
            self._register_in_live_catalog(skill_name, skill_file)

        return True

    def run_auto_fusion(self, min_frequency: int = 3) -> List[str]:
        """Identifies recurring tool sequences with verified intent coherence and fuses them."""
        if self.episodic_memory is None:
            return []

        patterns = self.episodic_memory.find_frequent_tool_sequences(
            min_frequency=min_frequency,
            min_length=2,
        )
        created_skills = []

        for p in patterns:
            sequence = p.get("sequence", [])
            sample_queries = p.get("sample_queries", [])
            if not sequence or len(sequence) < 2:
                continue

            # Validate semantic coherence across queries
            if not self.validate_semantic_coherence(sample_queries):
                logger.debug(
                    "Skipping auto-fusion for sequence %s: queries lack semantic coherence (%s)",
                    sequence,
                    sample_queries[:3],
                )
                continue

            skill_name = f"auto-{'-'.join(sequence[:3])}"
            desc = f"Verified automated sequence for: {', '.join(sequence)}"

            # Candidate starts in staged mode
            path = self.synthesize_skill_from_pattern(
                name=skill_name,
                description=desc,
                tool_sequence=sequence,
                sample_queries=sample_queries,
                status="staged",
            )
            if path:
                created_skills.append(skill_name)

        return created_skills

    def prune_underperforming_skills(
        self,
        min_invocations: int = 3,
        max_rejection_ratio: float = 0.5,
    ) -> List[str]:
        """Prunes skills with high user rejection rates or stale failures."""
        telemetry = self.load_telemetry()
        pruned = []

        for name, stats in list(telemetry.items()):
            invocations = stats.get("invocations", 0)
            rejections = stats.get("rejections", 0)

            if invocations >= min_invocations:
                rejection_ratio = rejections / max(1, invocations)
                if rejection_ratio >= max_rejection_ratio:
                    folder = self.skills_dir / name
                    if folder.exists():
                        import shutil
                        shutil.rmtree(folder, ignore_errors=True)
                    del telemetry[name]
                    pruned.append(name)
                    logger.info(
                        "Pruned underperforming learned skill [%s] (rejection ratio: %.2f)",
                        name,
                        rejection_ratio,
                    )

        if pruned:
            self.save_telemetry(telemetry)
        return pruned
