import os
import importlib
from typing import List, Dict, Optional
import inspect

try:
    from services.agent.tools.base_tool import BaseTool
except ImportError:
    pass # Will be handled by whoever provides BaseTool

class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, 'BaseTool'] = {}

    def register_tool(self, tool: 'BaseTool'):
        self._tools[tool.name] = tool

    def get_tool(self, name: str) -> Optional['BaseTool']:
        return self._tools.get(name)

    def get_all_tools(self) -> List['BaseTool']:
        return list(self._tools.values())

    def get_tools_for_capability(self, capability: str) -> List['BaseTool']:
        return [t for t in self._tools.values() if capability.lower() in t.description.lower() or capability.lower() in t.name.lower()]

    def get_tool_schemas(self) -> List[dict]:
        schemas = []
        for tool in self._tools.values():
            schema = tool.get_schema()
            parameters = schema.get("parameters", schema)
            schemas.append({
                "name": schema.get("name", tool.name),
                "description": schema.get("description", tool.description),
                "parameters": parameters,
            })
        return schemas

    def auto_discover(self, tools_dir: str):
        if not os.path.exists(tools_dir):
            return

        package_name = (
            f"{__package__.rsplit('.', 1)[0]}.tools"
            if __package__ and "." in __package__
            else "tools"
        )
        
        for filename in os.listdir(tools_dir):
            if filename.endswith('.py') and filename != '__init__.py':
                module_name = filename[:-3]
                module = importlib.import_module(f"{package_name}.{module_name}")

                for _, obj in inspect.getmembers(module, inspect.isclass):
                    if obj.__module__ == module.__name__ and obj.__name__ != 'BaseTool':
                        try:
                            if hasattr(obj, 'execute') and hasattr(obj, 'name'):
                                tool_instance = obj()
                                self.register_tool(tool_instance)
                        except TypeError:
                            pass
