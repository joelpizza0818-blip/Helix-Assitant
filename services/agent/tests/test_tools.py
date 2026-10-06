import pytest
from services.agent.tools.base_tool import BaseTool, ToolResult
from services.agent.security.permission_manager import PermissionLevel

class DummyTool(BaseTool):
    @property
    def name(self) -> str:
        return "dummy_tool"

    @property
    def description(self) -> str:
        return "Tool for testing contracts"

    @property
    def permission_level(self) -> PermissionLevel:
        return PermissionLevel.READ_ONLY

    @property
    def requires_confirmation(self) -> bool:
        return False

    def get_schema(self) -> dict:
        return {"name": self.name, "description": self.description, "parameters": {}}

    def validate_params(self, params: dict) -> bool:
        return "input" in params

    async def execute(self, params: dict) -> ToolResult:
        if not self.validate_params(params):
            return ToolResult(success=False, output=None, error="Invalid parameters")
        return ToolResult(success=True, output=f"Processed {params['input']}")

@pytest.mark.asyncio
async def test_tool_contract_execution():
    tool = DummyTool()
    assert tool.name == "dummy_tool"
    assert tool.permission_level == PermissionLevel.READ_ONLY
    assert tool.requires_confirmation is False

    # Valid execution
    res = await tool.execute({"input": "test_data"})
    assert res.success is True
    assert "Processed test_data" in res.output
    assert res.error is None

    # Invalid execution
    fail_res = await tool.execute({})
    assert fail_res.success is False
    assert fail_res.error == "Invalid parameters"
