from abc import ABC, abstractmethod
from typing import List, Dict, Callable, Any
from dataclasses import dataclass
from services.agent.tools.base_tool import BaseTool

@dataclass
class PluginMetadata:
    name: str
    version: str
    description: str
    author: str
    dependencies: List[str]
    permissions: List[str]

@dataclass
class PluginContext:
    event_bus: Any
    tool_registry: Any
    skill_registry: Any
    config: dict

class BasePlugin(ABC):
    @abstractmethod
    def get_metadata(self) -> PluginMetadata:
        pass

    
    @abstractmethod
    async def initialize(self, context: PluginContext):
        pass
        
    @abstractmethod
    async def shutdown(self):
        pass
        
    def get_tools(self) -> List[BaseTool]:
        return []
        
    def get_skills(self) -> List[str]:
        return []
        
    def get_event_handlers(self) -> Dict[str, Callable]:
        return {}
        
    def get_mcp_servers(self) -> List[dict]:
        return []
