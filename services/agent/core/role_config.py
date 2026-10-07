import json
import os
from dataclasses import dataclass
from typing import Optional, Dict

try:
    from services.agent.ai.model_router import TaskRequirements
except ImportError:
    pass

@dataclass
class RoleAssignment:
    role: str
    provider: Optional[str]
    model: Optional[str]
    requirements: 'TaskRequirements'

class RoleConfig:
    def __init__(self, config_path: Optional[str] = None):
        self.config_path = config_path
        self._assignments: Dict[str, RoleAssignment] = {}
        self._load_config()

    def _load_config(self):
        if self.config_path and os.path.exists(self.config_path):
            with open(self.config_path, 'r') as f:
                data = json.load(f)
                for role, conf in data.items():
                    req_dict = conf.get('requirements', {})
                    reqs = TaskRequirements(**req_dict)
                    self._assignments[role] = RoleAssignment(
                        role=role,
                        provider=conf.get('provider'),
                        model=conf.get('model'),
                        requirements=reqs
                    )
        
        for default_role in ['main', 'coding', 'research', 'vision', 'planning']:
            if default_role not in self._assignments:
                reqs = TaskRequirements()
                if default_role == 'coding':
                    reqs.coding = True
                elif default_role == 'vision':
                    reqs.vision = True
                elif default_role == 'planning':
                    reqs.reasoning = True
                    
                self._assignments[default_role] = RoleAssignment(
                    role=default_role,
                    provider=None,
                    model=None,
                    requirements=reqs
                )

    def get_assignment(self, role: str) -> RoleAssignment:
        if role not in self._assignments:
            self._assignments[role] = RoleAssignment(role=role, provider=None, model=None, requirements=TaskRequirements())
        return self._assignments[role]

    def set_assignment(self, role: str, provider: str = None, model: str = None):
        assignment = self.get_assignment(role)
        assignment.provider = provider
        assignment.model = model
        if provider:
            assignment.requirements.preferred_provider = provider
        if model:
            assignment.requirements.preferred_model = model

    def get_requirements_for_role(self, role: str) -> 'TaskRequirements':
        return self.get_assignment(role).requirements
