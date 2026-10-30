"""Unit tests for the HELIX Self-Adapting Learning Harness."""

import shutil
import tempfile
from pathlib import Path
import pytest

from services.agent.learning.episodic_memory import EpisodicMemory
from services.agent.learning.procedural_memory import ProceduralSemanticMemory
from services.agent.learning.feedback_sensor import FeedbackSensor
from services.agent.learning.feedforward_guide import FeedforwardGuide
from services.agent.learning.self_learning_skills import SelfLearningSkillManager
from services.agent.learning.adaptive_harness import AdaptiveLearningHarness


@pytest.fixture
def temp_dir():
    d = tempfile.mkdtemp(prefix="helix_learning_test_")
    yield Path(d)
    shutil.rmtree(d, ignore_errors=True)


def test_episodic_memory_crud(temp_dir):
    db_path = temp_dir / "test_episodes.db"
    mem = EpisodicMemory(db_path=db_path)

    actions = [{"tool": "run_command", "command": "git status"}]
    ep_id = mem.record_episode(
        session_id="s1",
        task_id="t1",
        user_query="check git status",
        actions_taken=actions,
        outcome="success",
    )
    assert ep_id.startswith("ep_")

    recent = mem.get_recent_episodes(limit=5)
    assert len(recent) == 1
    assert recent[0]["task_id"] == "t1"
    assert recent[0]["tool_sequence"] == ["run_command"]

    # Record correction
    mem.record_episode(
        session_id="s1",
        task_id="t2",
        user_query="no, hazlo con powershell",
        actions_taken=[],
        outcome="user_correction",
        feedback_score=-1.0,
        correction_notes="Prefer powershell",
    )
    corrections = mem.get_recent_corrections(limit=5)
    assert len(corrections) == 1
    assert corrections[0]["task_id"] == "t2"


def test_frequent_tool_sequences(temp_dir):
    mem = EpisodicMemory(db_path=temp_dir / "test_episodes.db")
    seq = [{"tool": "browser_control"}, {"tool": "extract_page"}]

    # Record 3 identical successful sequences
    for i in range(3):
        mem.record_episode(
            session_id="s1",
            task_id=f"t_{i}",
            user_query=f"scrape news {i}",
            actions_taken=seq,
            outcome="success",
        )

    patterns = mem.find_frequent_tool_sequences(min_frequency=2, min_length=2)
    assert len(patterns) == 1
    assert patterns[0]["sequence"] == ["browser_control", "extract_page"]
    assert patterns[0]["frequency"] == 3


def test_procedural_memory_rules_and_pruning(temp_dir):
    profile_path = temp_dir / "profile.json"
    proc = ProceduralSemanticMemory(storage_path=profile_path)

    rule1 = proc.add_learned_rule(
        category="preference",
        rule_text="Always quote paths in PowerShell commands",
        confidence=1.5,
        trigger_keywords=["powershell", "path", "command"],
    )
    assert rule1["confidence"] == 1.5

    # Reinforce existing rule
    rule1_updated = proc.add_learned_rule(
        category="preference",
        rule_text="Always quote paths in PowerShell commands",
    )
    assert rule1_updated["confidence"] == 2.0
    assert rule1_updated["usage_count"] == 2

    # Add weak rule and prune
    proc.add_learned_rule(
        category="stale",
        rule_text="Deprecated temporary flag",
        confidence=0.2,
    )
    pruned = proc.prune_stale_rules(min_confidence=0.5)
    assert pruned == 1

    # Search relevant
    relevant = proc.find_relevant_rules("how do I run powershell?")
    assert len(relevant) >= 1
    assert "PowerShell" in relevant[0]["rule"]


def test_feedback_sensor_detection():
    sensor = FeedbackSensor()

    # Spanish corrections
    c1 = sensor.inspect_message("No, hazlo de esta otra forma con powershell")
    assert c1.is_correction is True
    assert c1.confidence > 0.8

    c2 = sensor.inspect_message("Te equivocaste, eso no funciona")
    assert c2.is_correction is True

    c3 = sensor.inspect_message("En vez de bash usa cmd")
    assert c3.is_correction is True
    assert c3.correction_type == "substitution"

    c4 = sensor.inspect_message("Nunca uses git push --force sin avisar")
    assert c4.is_correction is True
    assert c4.correction_type == "constraint"

    # English corrections
    c5 = sensor.inspect_message("No, instead of npm use pnpm")
    assert c5.is_correction is True

    # Normal queries (not corrections)
    normal1 = sensor.inspect_message("Muéstrame el archivo README.md")
    assert normal1.is_correction is False

    normal2 = sensor.inspect_message("Please create a new test file")
    assert normal2.is_correction is False


def test_feedforward_guide_and_user_md(temp_dir):
    user_md = temp_dir / "USER.md"
    guide = FeedforwardGuide(user_md_path=user_md)
    assert user_md.exists()

    profile = {
        "preferences": {"preferred_language": "Español", "shell": "PowerShell"},
        "learned_rules": [{"rule": "Prefer compact diffs", "confidence": 1.5}],
    }
    guide.sync_from_profile(profile)
    content = user_md.read_text(encoding="utf-8")
    assert "Español" in content
    assert "Prefer compact diffs" in content

    prompt = guide.build_feedforward_prompt("write some code")
    assert "USER.md" in prompt


def test_self_learning_skill_synthesis_and_pruning(temp_dir):
    skills_dir = temp_dir / "learned_skills"
    mem = EpisodicMemory(db_path=temp_dir / "episodes.db")
    mgr = SelfLearningSkillManager(skills_dir=skills_dir, episodic_memory=mem)

    # Synthesize skill
    path = mgr.synthesize_skill_from_pattern(
        name="web-research-macro",
        description="Search and extract content",
        tool_sequence=["search_web", "read_file"],
        sample_queries=["search for news", "find documentation"],
    )
    assert path.exists()
    content = path.read_text(encoding="utf-8")
    assert "name: web-research-macro" in content
    assert "search_web" in content

    # Telemetry
    mgr.record_skill_usage("web-research-macro", succeeded=True)
    telemetry = mgr.load_telemetry()
    assert telemetry["web-research-macro"]["successes"] == 2

    # Pruning of underperforming skill
    for _ in range(5):
        mgr.record_skill_usage("web-research-macro", succeeded=False)
    pruned = mgr.prune_underperforming_skills(min_invocations=5, max_rejection_ratio=0.5)
    assert "web-research-macro" in pruned
    assert not path.parent.exists()


def test_adaptive_harness_integration(temp_dir):
    harness = AdaptiveLearningHarness(base_dir=temp_dir)

    # Turn 1: normal request
    corr1, prompt1 = harness.process_incoming_user_message("crea un script python")
    assert corr1.is_correction is False
    assert "USER.md" in prompt1

    h_id = harness.record_task_outcome(
        session_id="s1",
        task_id="t1",
        user_query="crea un script python",
        actions_taken=[{"tool": "write_file", "path": "main.py"}],
        outcome="success",
    )
    assert h_id.startswith("ep_")

    # Turn 2: user correction on turn 1
    corr2, prompt2 = harness.process_incoming_user_message(
        "No, en vez de python usa TypeScript",
        session_id="s1",
        recent_task_id="t1",
    )
    assert corr2.is_correction is True

    # Verify rule was added to procedural memory
    rules = harness.procedural_memory.load_profile()["learned_rules"]
    assert any("TypeScript" in r["rule"] for r in rules)

    # Verify maintenance runs cleanly
    report = harness.run_maintenance()
    assert "pruned_rules_count" in report
