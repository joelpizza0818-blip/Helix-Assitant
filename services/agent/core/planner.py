from dataclasses import dataclass, field
from typing import List, Dict, Optional

@dataclass
class PlanStep:
    step_id: str
    description: str
    tool_name: Optional[str] = None
    params: Dict = field(default_factory=dict)
    requires_confirmation: bool = False
    depends_on: List[str] = field(default_factory=list)

@dataclass
class Plan:
    steps: List[PlanStep]
    estimated_tools: List[str]
    total_steps: int

class Planner:
    def __init__(self, model_router, fallback_manager):
        self.model_router = model_router
        self.fallback_manager = fallback_manager

    async def create_plan(self, task_description: str, context: dict) -> Plan:
        step = PlanStep(step_id="1", description="Execute task", tool_name="bash", requires_confirmation=False)
        return Plan(steps=[step], estimated_tools=["bash"], total_steps=1)

    async def replan(self, failed_step: PlanStep, error_info: str) -> Plan:
        return Plan(steps=[], estimated_tools=[], total_steps=0)
