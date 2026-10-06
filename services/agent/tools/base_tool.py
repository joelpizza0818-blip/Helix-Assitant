from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field
import json

@dataclass
class ToolResult:
    success: bool
    output: Any
    error: Optional[str] = None
    side_effects: Optional[List[Any]] = field(default_factory=list)

@dataclass
class ToolSchema:
    name: str
    description: str
    parameters: Dict[str, Any]
    permission_level: str
    requires_confirmation: bool

class BaseTool(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        pass

    @property
    @abstractmethod
    def permission_level(self) -> str:
        pass

    @property
    @abstractmethod
    def requires_confirmation(self) -> bool:
        pass

    @abstractmethod
    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        pass

    @abstractmethod
    def validate_params(self, params: Dict[str, Any]) -> bool:
        pass

    @abstractmethod
    def get_schema(self) -> Dict[str, Any]:
        pass
