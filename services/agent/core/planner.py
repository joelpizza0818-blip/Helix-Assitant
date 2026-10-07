import json
from dataclasses import dataclass
from typing import List

try:
    from services.agent.ai.base_provider import ChatMessage
except ImportError:
    pass

@dataclass
class PlanStep:
    id: str
    action: str
    params: dict
    dependencies: List[str]

@dataclass
class Plan:
    steps: List[PlanStep]

class Planner:
    def __init__(self, react_loop, role_config, tool_registry, skill_registry=None):
        self.react_loop = react_loop
        self.role_config = role_config
        self.tool_registry = tool_registry
        self.skill_registry = skill_registry

    async def create_plan(self, task_description: str, context: dict) -> Plan:
        tools = self.tool_registry.get_tool_schemas()
        prompt = self._build_planning_prompt(task_description, tools, context)
        
        messages = [
            ChatMessage(role="system", content="You are a planning AI. Output ONLY valid JSON representing the plan."),
            ChatMessage(role="user", content=prompt)
        ]
        
        response = await self.react_loop.execute(messages, role="planning", max_iterations=1)
        
        try:
            content = response.content
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            data = json.loads(content)
            steps = []
            for s in data.get("steps", []):
                steps.append(PlanStep(
                    id=s["id"],
                    action=s["action"],
                    params=s.get("params", {}),
                    dependencies=s.get("dependencies", [])
                ))
            return Plan(steps=steps)
        except Exception as e:
            return Plan(steps=[PlanStep(id="1", action="execute_direct", params={"task": task_description}, dependencies=[])])

    async def replan(self, failed_step: PlanStep, error_info: str, original_plan: Plan) -> Plan:
        prompt = f"The step {failed_step.id} ({failed_step.action}) failed with error: {error_info}. Replan to recover."
        return await self.create_plan(prompt, {})

    def _build_planning_prompt(self, task: str, tools: List[dict], context: dict) -> str:
        return f"""
        Task: {task}
        Context: {json.dumps(context)}
        Available Tools: {json.dumps([t['name'] for t in tools])}
        
        Decompose this task into a series of steps. 
        Each step must have:
        - "id": string identifier
        - "action": tool name or 'delegate'
        - "params": dictionary of arguments
        - "dependencies": list of step ids that must finish before this one
        
        Output format:
        {{
            "steps": [
                {{"id": "step1", "action": "tool_name", "params": {{}}, "dependencies": []}}
            ]
        }}
        """
