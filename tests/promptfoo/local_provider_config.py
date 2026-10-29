import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from services.agent.ai.fallback_manager import FallbackManager
from services.agent.ai.model_router import TaskRequirements


class _NoConfiguredProviders:
    def get_fallback_candidates(self, *_args, **_kwargs):
        return []

    def get_balanced_candidate(self, candidates):
        return candidates[0] if candidates else None


class _NoConfiguredKeys:
    def get_configured_providers(self):
        return []


async def main():
    manager = FallbackManager(
        _NoConfiguredProviders(),
        _NoConfiguredKeys(),
        event_bus=None,
    )
    try:
        await manager.execute_with_fallback(
            lambda *_args: None,
            TaskRequirements(),
            {},
        )
    except RuntimeError as error:
        print(json.dumps({"output": str(error)}))
        return
    raise RuntimeError("The no-provider scenario unexpectedly succeeded.")


if __name__ == "__main__":
    asyncio.run(main())
