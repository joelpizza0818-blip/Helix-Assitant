import os
import pytest
from services.agent.skills.skill_loader import SkillLoader
from services.agent.skills.skill_registry import SkillRegistry
from services.agent.skills.intent_matcher import IntentMatcher

@pytest.fixture
def skills_dir():
    return os.path.join(os.path.dirname(__file__), "..", "skills")

def test_skill_discovery_and_loading(skills_dir):
    loader = SkillLoader()
    registry = SkillRegistry(loader)
    registry.discover_skills(skills_dir)
    
    skills = registry.get_all_skills()
    assert len(skills) >= 6
    
    skill_names = [s.name for s in skills]
    assert "coding" in skill_names
    assert "research" in skill_names
    assert "browser" in skill_names
    assert "windows" in skill_names
    assert "github" in skill_names
    assert "filesystem" in skill_names

def test_intent_matching(skills_dir):
    loader = SkillLoader()
    registry = SkillRegistry(loader)
    registry.discover_skills(skills_dir)
    matcher = IntentMatcher(registry)
    
    # Test coding intent
    matches = matcher.match("Can you fix this python bug in my code?")
    assert len(matches) > 0
    assert matches[0].skill.name == "coding"
    
    # Test github intent
    matches = matcher.match("Create a pull request on github")
    assert len(matches) > 0
    assert matches[0].skill.name == "github"

def test_skill_activation(skills_dir):
    loader = SkillLoader()
    registry = SkillRegistry(loader)
    registry.discover_skills(skills_dir)
    
    registry.activate_skill("coding")
    active = registry.get_active_skills()
    assert len(active) == 1
    assert active[0].name == "coding"
    
    instructions = registry.get_skill_instructions("coding")
    assert len(instructions) > 0
