import os
import sys
import logging
import importlib.util
from typing import List, Dict, Optional
from .base_plugin import BasePlugin, PluginContext

logger = logging.getLogger(__name__)

class PluginManager:
    def __init__(self, event_bus, tool_registry, skill_registry):
        self.event_bus = event_bus
        self.tool_registry = tool_registry
        self.skill_registry = skill_registry
        self.plugins: Dict[str, BasePlugin] = {}
        self.plugin_paths: Dict[str, str] = {}

    async def load_plugin(self, plugin_path: str) -> str:
        if not os.path.exists(plugin_path):
            raise FileNotFoundError(f"Plugin path {plugin_path} does not exist")
            
        module_name = os.path.basename(plugin_path).replace('.py', '')
        if os.path.isdir(plugin_path):
            main_file = os.path.join(plugin_path, '__init__.py')
            if not os.path.exists(main_file):
                main_file = os.path.join(plugin_path, 'main.py')
        else:
            main_file = plugin_path
            
        if not os.path.exists(main_file):
            raise FileNotFoundError(f"Cannot find entry point for plugin at {plugin_path}")
            
        spec = importlib.util.spec_from_file_location(module_name, main_file)
        if not spec or not spec.loader:
            raise ImportError(f"Cannot create spec for {main_file}")
            
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        
        # Find the BasePlugin implementation
        plugin_class = None
        for item_name in dir(module):
            item = getattr(module, item_name)
            if isinstance(item, type) and issubclass(item, BasePlugin) and item is not BasePlugin:
                plugin_class = item
                break
                
        if not plugin_class:
            raise ValueError(f"No BasePlugin subclass found in {plugin_path}")
            
        plugin_instance: BasePlugin = plugin_class()
        
        if not await self._validate_plugin(plugin_instance):
            raise ValueError(f"Plugin validation failed for {plugin_path}")
            
        metadata = plugin_instance.get_metadata()
        name = metadata.name
        
        if name in self.plugins:
            logger.warning(f"Plugin {name} is already loaded. Unloading first.")
            await self.unload_plugin(name)
            
        context = PluginContext(
            event_bus=self.event_bus,
            tool_registry=self.tool_registry,
            skill_registry=self.skill_registry,
            config={}
        )
        
        await plugin_instance.initialize(context)
        await self._register_plugin_tools(plugin_instance)
        await self._register_plugin_events(plugin_instance)
        
        self.plugins[name] = plugin_instance
        self.plugin_paths[name] = plugin_path
        
        logger.info(f"Successfully loaded plugin: {name} v{metadata.version}")
        if self.event_bus:
            await self.event_bus.publish('plugin.loaded', {'name': name, 'version': metadata.version})
            
        return name

    async def load_plugins_from_directory(self, plugins_dir: str):
        if not os.path.exists(plugins_dir):
            logger.warning(f"Plugins directory {plugins_dir} does not exist")
            return
            
        for item in os.listdir(plugins_dir):
            if item.startswith('__') or item.startswith('.'):
                continue
                
            full_path = os.path.join(plugins_dir, item)
            if os.path.isfile(full_path) and item in {'base_plugin.py', 'plugin_manager.py'}:
                continue
            if os.path.isfile(full_path) and not item.endswith('.py'):
                continue
            try:
                await self.load_plugin(full_path)
            except Exception as e:
                logger.error(f"Failed to load plugin from {full_path}: {e}")

    async def unload_plugin(self, name: str):
        if name not in self.plugins:
            return
            
        plugin = self.plugins[name]
        try:
            # Unregister events
            handlers = plugin.get_event_handlers()
            if self.event_bus:
                for event_name, handler in handlers.items():
                    await self.event_bus.unsubscribe(event_name, handler)
                    
            # Unregister tools
            tools = plugin.get_tools()
            if hasattr(self.tool_registry, 'unregister_tool'):
                for tool in tools:
                    self.tool_registry.unregister_tool(tool.name)
                    
            await plugin.shutdown()
        except Exception as e:
            logger.error(f"Error unloading plugin {name}: {e}")
        finally:
            del self.plugins[name]
            if name in self.plugin_paths:
                del self.plugin_paths[name]
            logger.info(f"Unloaded plugin: {name}")
            
            if self.event_bus:
                await self.event_bus.publish('plugin.unloaded', {'name': name})

    async def reload_plugin(self, name: str):
        if name not in self.plugin_paths:
            raise ValueError(f"Plugin {name} path is unknown, cannot reload")
            
        path = self.plugin_paths[name]
        await self.unload_plugin(name)
        await self.load_plugin(path)

    def get_plugin(self, name: str) -> Optional[BasePlugin]:
        return self.plugins.get(name)

    def get_all_plugins(self) -> List[BasePlugin]:
        return list(self.plugins.values())

    def is_loaded(self, name: str) -> bool:
        return name in self.plugins

    async def _validate_plugin(self, plugin: BasePlugin) -> bool:
        try:
            metadata = plugin.get_metadata()
            if not metadata or not metadata.name or not metadata.version:
                return False
            return True
        except Exception as e:
            logger.error(f"Plugin validation error: {e}")
            return False

    async def _register_plugin_tools(self, plugin: BasePlugin):
        if not hasattr(self.tool_registry, 'register_tool'):
            return
            
        try:
            tools = plugin.get_tools()
            for tool in tools:
                self.tool_registry.register_tool(tool)
        except Exception as e:
            logger.error(f"Failed to register tools for plugin: {e}")

    async def _register_plugin_events(self, plugin: BasePlugin):
        if not self.event_bus:
            return
            
        try:
            handlers = plugin.get_event_handlers()
            for event_name, handler in handlers.items():
                await self.event_bus.subscribe(event_name, handler)
        except Exception as e:
            logger.error(f"Failed to register events for plugin: {e}")
