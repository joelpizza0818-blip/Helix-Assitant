import logging
from dataclasses import dataclass
from typing import Optional, List
import re

logger = logging.getLogger(__name__)

@dataclass
class PolicyDecision:
    allowed: bool
    requires_confirmation: bool
    reason: str
    level: str

@dataclass
class Policy:
    name: str
    tool_pattern: re.Pattern
    permission_level: str
    requires_confirmation: bool
    conditions: dict

class PolicyEngine:
    def __init__(self):
        self.policies: List[Policy] = [
            Policy(
                name="Default Execution Policy",
                tool_pattern=re.compile(r'(?i)execute_command'),
                permission_level="EXECUTE",
                requires_confirmation=True,
                conditions={}
            ),
            Policy(
                name="Read Only Policy",
                tool_pattern=re.compile(r'(?i)read_.*'),
                permission_level="READ_ONLY",
                requires_confirmation=False,
                conditions={}
            )
        ]

    def evaluate_action(self, tool_name: str, params: dict, context: dict) -> PolicyDecision:
        for policy in self.policies:
            if policy.tool_pattern.match(tool_name):
                logger.info(f"Policy '{policy.name}' matched for tool '{tool_name}'")
                return PolicyDecision(
                    allowed=True,
                    requires_confirmation=policy.requires_confirmation,
                    reason=f"Matched policy {policy.name}",
                    level=policy.permission_level
                )
        
        logger.warning(f"No policy matched for tool '{tool_name}'. Defaulting to safe.")
        return PolicyDecision(
            allowed=False,
            requires_confirmation=True,
            reason="Unrecognized action",
            level="SYSTEM"
        )
