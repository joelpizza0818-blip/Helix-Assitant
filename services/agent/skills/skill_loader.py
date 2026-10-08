import os
import json
try:
    import yaml
except ImportError:
    yaml = None

from typing import List, Tuple, Dict, Any
from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)


@dataclass
class SkillDefinition:
    name: str
    description: str
    version: str
    triggers: List[str]
    tools: List[str]
    instructions: str
    dependencies: List[str] = field(default_factory=list)
    permissions: List[str] = field(default_factory=list)
    examples: List[dict] = field(default_factory=list)
    config: dict = field(default_factory=dict)

class SkillLoader:
    def load_from_file(self, path: str) -> SkillDefinition:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            frontmatter, body = self._parse_frontmatter(content)
            
            name = frontmatter.get('name', 'unknown')
            description = frontmatter.get('description', '')
            version = str(frontmatter.get('version', '1.0.0'))
            tools = frontmatter.get('tools', [])
            dependencies = frontmatter.get('dependencies', [])
            permissions = frontmatter.get('permissions', [])
            
            triggers = self._extract_triggers(frontmatter, body)
            examples = self._extract_examples(body)
            
            instructions = body.strip()
            
            return SkillDefinition(
                name=name,
                description=description,
                version=version,
                triggers=triggers,
                tools=tools,
                instructions=instructions,
                dependencies=dependencies,
                permissions=permissions,
                examples=examples,
                config=frontmatter
            )
        except Exception as e:
            logger.error(f"Failed to load skill from {path}: {e}")
            raise

    def load_from_directory(self, skills_dir: str) -> List[SkillDefinition]:
        skills = []
        if not os.path.exists(skills_dir):
            logger.warning(f"Skills directory not found: {skills_dir}")
            return skills
            
        for root, _, files in os.walk(skills_dir):
            for file in files:
                if file == "SKILL.md":
                    path = os.path.join(root, file)
                    try:
                        skill = self.load_from_file(path)
                        skills.append(skill)
                        logger.info(f"Loaded skill: {skill.name} from {path}")
                    except Exception as e:
                        logger.error(f"Error loading skill at {path}: {e}")
                        
        return skills

    def _parse_frontmatter(self, content: str) -> Tuple[dict, str]:
        if not content.startswith("---"):
            return {}, content
            
        parts = content.split("---", 2)
        if len(parts) >= 3:
            if yaml is not None:
                try:
                    frontmatter = yaml.safe_load(parts[1]) or {}
                    body = parts[2]
                    return frontmatter, body
                except Exception as e:
                    logger.error(f"Error parsing YAML frontmatter: {e}")
            
            # Simple fallback parser when PyYAML is not installed
            frontmatter = {}
            lines = parts[1].strip().split('\n')
            current_key = None
            for line in lines:
                line_str = line.strip()
                if line_str.startswith('- ') and current_key:
                    if not isinstance(frontmatter.get(current_key), list):
                        frontmatter[current_key] = []
                    frontmatter[current_key].append(
                        self._parse_simple_yaml_value(line_str[2:].strip())
                    )
                elif ':' in line_str:
                    key, val = line_str.split(':', 1)
                    current_key = key.strip()
                    val_str = val.strip()
                    if val_str:
                        frontmatter[current_key] = self._parse_simple_yaml_value(val_str)
                    else:
                        frontmatter[current_key] = []
            return frontmatter, parts[2]
                
        return {}, content

    @staticmethod
    def _parse_simple_yaml_value(value: str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value


    def _extract_triggers(self, frontmatter: dict, body: str) -> List[str]:
        return frontmatter.get('triggers', [])

    def _extract_examples(self, body: str) -> List[dict]:
        examples = []
        in_examples = False
        current_example = {}
        for line in body.split('\n'):
            line = line.strip()
            if line.startswith('## Examples'):
                in_examples = True
                continue
            elif line.startswith('## ') and in_examples:
                in_examples = False
                
            if in_examples:
                if line.startswith('- User:'):
                    if current_example:
                        examples.append(current_example)
                        current_example = {}
                    current_example['user'] = line.replace('- User:', '').strip()
                elif line.startswith('Agent:') and 'user' in current_example:
                    current_example['agent'] = line.replace('Agent:', '').strip()
                    
        if current_example:
            examples.append(current_example)
            
        return examples
