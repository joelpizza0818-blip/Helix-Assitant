from typing import List, Optional
from dataclasses import dataclass
import re
from .skill_registry import SkillRegistry
from .skill_loader import SkillDefinition
import logging

logger = logging.getLogger(__name__)

@dataclass
class SkillMatch:
    skill: SkillDefinition
    confidence: float
    matched_triggers: List[str]
    reasoning: str

class IntentMatcher:
    def __init__(self, skill_registry: SkillRegistry):
        self.registry = skill_registry

    def match(self, user_input: str) -> List[SkillMatch]:
        user_input_lower = user_input.casefold()
        matches = []
        
        for skill in self.registry.get_all_skills():
            matched_triggers = []
            for trigger in skill.triggers:
                normalized_trigger = trigger.strip().casefold()
                if normalized_trigger and re.search(
                    rf"(?<!\w){re.escape(normalized_trigger)}(?!\w)",
                    user_input_lower,
                ):
                    matched_triggers.append(trigger)
                    
            if matched_triggers:
                # Basic confidence score based on number of matched triggers
                confidence = min(0.1 + (len(matched_triggers) * 0.2), 0.9)
                matches.append(SkillMatch(
                    skill=skill,
                    confidence=confidence,
                    matched_triggers=matched_triggers,
                    reasoning=f"Matched keywords: {', '.join(matched_triggers)}"
                ))
                
        # Sort by confidence descending
        matches.sort(key=lambda x: x.confidence, reverse=True)
        return matches

    def get_best_match(self, user_input: str) -> Optional[SkillMatch]:
        matches = self.match(user_input)
        if matches:
            return matches[0]
        return None

    async def llm_match(self, user_input: str, provider_fn) -> List[SkillMatch]:
        skills = self.registry.get_all_skills()
        if not skills:
            return []
            
        skills_info = "\n".join([f"- {s.name}: {s.description}" for s in skills])
        
        prompt = f"""
Given the user input, which of the following skills are relevant?
User Input: "{user_input}"

Available Skills:
{skills_info}

Respond with the names of the relevant skills, separated by commas.
"""
        try:
            response = await provider_fn(prompt)
            matched_names = [name.strip() for name in response.split(',')]
            
            matches = []
            for name in matched_names:
                skill = self.registry.get_skill(name)
                if skill:
                    matches.append(SkillMatch(
                        skill=skill,
                        confidence=0.9,
                        matched_triggers=[],
                        reasoning="LLM semantic matching"
                    ))
            return matches
        except Exception as e:
            logger.error(f"LLM match failed: {e}")
            return self.match(user_input)
