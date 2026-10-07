import asyncio
from unittest.mock import AsyncMock

from services.agent.plugins.plugin_manager import PluginManager


def test_plugin_discovery_skips_manager_support_modules(tmp_path):
    (tmp_path / "base_plugin.py").write_text("", encoding="utf-8")
    (tmp_path / "plugin_manager.py").write_text("", encoding="utf-8")
    load_plugin = AsyncMock()
    manager = PluginManager(None, None, None)
    manager.load_plugin = load_plugin

    asyncio.run(manager.load_plugins_from_directory(str(tmp_path)))

    load_plugin.assert_not_awaited()
