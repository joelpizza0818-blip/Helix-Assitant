"""Run the bundled HELIX Python agent from a PyInstaller distribution."""

from pathlib import Path
import runpy
import sys


def main() -> None:
    bundle_root = Path(__file__).resolve().parent
    agent_main = bundle_root / "services" / "agent" / "main.py"
    if not agent_main.exists():
        raise FileNotFoundError(f"Bundled HELIX agent entrypoint not found: {agent_main}")

    # main.py imports both `core.*` (from the agent directory) and
    # `services.agent.*` (from the bundled project root).
    sys.path.insert(0, str(agent_main.parent))
    sys.path.insert(1, str(bundle_root))
    runpy.run_path(str(agent_main), run_name="__main__")


if __name__ == "__main__":
    main()
