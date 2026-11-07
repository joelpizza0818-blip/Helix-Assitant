import importlib
import inspect
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def discover_native_tools(registry: Any, tools_dir: str) -> None:
    """Load constructible native tool classes from the configured tools package."""
    if not os.path.exists(tools_dir):
        return

    package_name = (
        f"{__package__.rsplit('.', 1)[0]}.tools"
        if __package__ and "." in __package__
        else "tools"
    )

    for filename in os.listdir(tools_dir):
        if filename.endswith(".py") and filename != "__init__.py":
            module_name = filename[:-3]
            module = importlib.import_module(f"{package_name}.{module_name}")

            for _, tool_class in inspect.getmembers(module, inspect.isclass):
                if (
                    tool_class.__module__ != module.__name__
                    or tool_class.__name__ == "BaseTool"
                ):
                    continue
                constructor_parameters = inspect.signature(
                    tool_class
                ).parameters.values()
                required_parameters = [
                    parameter
                    for parameter in constructor_parameters
                    if parameter.kind in {
                        inspect.Parameter.POSITIONAL_ONLY,
                        inspect.Parameter.POSITIONAL_OR_KEYWORD,
                        inspect.Parameter.KEYWORD_ONLY,
                    }
                    and parameter.default is inspect.Parameter.empty
                ]
                if required_parameters:
                    logger.debug(
                        "Skipping runtime-configured tool %s from %s",
                        tool_class.__name__,
                        filename,
                    )
                    continue
                try:
                    if hasattr(tool_class, "execute") and hasattr(tool_class, "name"):
                        registry.register_tool(tool_class(), source="native")
                except TypeError:
                    logger.exception(
                        "Could not initialize tool %s from %s",
                        tool_class.__name__,
                        filename,
                    )
