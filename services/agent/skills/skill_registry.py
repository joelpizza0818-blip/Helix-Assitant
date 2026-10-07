from typing import List, Optional, Dict
from .skill_loader import SkillLoader, SkillDefinition
import logging

logger = logging.getLogger(__name__)

class SkillRegistry:
    def __init__(self, skill_loader: SkillLoader):
        self.skill_loader = skill_loader
        self._skills: Dict[str, SkillDefinition] = {}
        self._active_skills: set = set()

    def register_skill(self, skill: SkillDefinition):
        self._skills[skill.name] = skill
        logger.info(f"Skill registered: {skill.name}")

    def unregister_skill(self, name: str):
        if name in self._skills:
            del self._skills[name]
            self._active_skills.discard(name)
            logger.info(f"Skill unregistered: {name}")

    def get_skill(self, name: str) -> Optional[SkillDefinition]:
        return self._skills.get(name)

    def get_all_skills(self) -> List[SkillDefinition]:
        return list(self._skills.values())

    def discover_skills(self, skills_dir: str):
        loaded_skills = self.skill_loader.load_from_directory(skills_dir)
        for skill in loaded_skills:
            self.register_skill(skill)

    def get_skills_for_tools(self, tool_names: List[str]) -> List[SkillDefinition]:
        tool_set = set(tool_names)
        matched_skills = []
        for skill in self._skills.values():
            if set(skill.tools).intersection(tool_set):
                matched_skills.append(skill)
        return matched_skills

    def get_skill_instructions(self, name: str) -> str:
        skill = self.get_skill(name)
        if skill:
            return skill.instructions
        return ""

    def get_active_skills(self) -> List[SkillDefinition]:
        return [self._skills[name] for name in self._active_skills if name in self._skills]

    def activate_skill(self, name: str):
        if name in self._skills:
            self._active_skills.add(name)
            logger.info(f"Skill activated: {name}")

    def deactivate_skill(self, name: str):
        self._active_skills.discard(name)
        logger.info(f"Skill deactivated: {name}")
