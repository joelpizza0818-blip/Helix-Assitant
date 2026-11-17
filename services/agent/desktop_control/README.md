# Desktop Control

`computer.desktop_control` can drive one of two backends:

- **Isolated Docker desktop:** a Debian Stable container running XFCE on a virtual X display. HELIX builds the image on first setup, stores the desktop home in a named Docker volume, and starts the container on demand.
- **Windows host (explicit consent only):** the real Windows desktop, for users who deliberately choose it.

## Selecting a backend

Settings control the backend:

- `computer_use_mode`: `auto` (default), `isolated`, or `host`.
- `computer_use_host_consent`: must be `true` before any host action; `mode=host` alone is not enough.

In `auto`, the consented Windows desktop is selected when the user has granted host consent; otherwise HELIX selects the isolated container. The desktop image and container are prepared automatically at app startup when host consent is absent, and the selected backend is cached for 300 seconds so a task cannot switch desktops mid-flight. If Docker is unavailable or still preparing, the action reports Docker readiness and never falls back to the Windows host. Direct host actions always require consent, and host actions are rejected while isolated mode is selected.

## Isolated Docker desktop

Docker Desktop with its Linux container engine must be installed and running. Setup builds `apps/desktop/computer-use-image/Dockerfile` from Debian Stable, installs XFCE, Xvfb, `xdotool`, FFmpeg, and the authenticated guest agent, then creates `helix-computer-desktop`. The Xfce desktop runs at 1440x900 on the container's virtual display. This desktop backend uses a Docker image and container; it does not provision or start a Hyper-V virtual machine.

Only the guest agent's WebSocket port is published, bound to a dynamically selected `127.0.0.1` host port. The container's `/home/helix` is persisted at `Desktop\helix-storage\computer-home`; no other Windows folder or the Docker socket is mounted into the container. A random 256-bit token authenticates control. Desktop screenshots are sent through the existing agent event stream to the Desktop Preview; screenshots contain only the container's virtual display.

The assistant can screenshot, move/click, type, press keys, scroll, and launch a desktop-file identifier. Arbitrary shell execution is not exposed as a computer-use action. The container has normal outbound network access, but no host files or host application windows are shared with it.

The container persists after it is stopped. Its user home and installed applications are kept under `helix-storage\computer-home`; after two hours idle the container is stopped, not deleted. During setup, an existing HELIX container that uses the previous named Docker volume is copied into this folder before the container is recreated; the old volume is left untouched. The Docker image and Docker Engine's own internal cache remain managed by Docker Desktop. HELIX does not delete older VM files as part of normal operation.

## HELIX storage

On Windows, HELIX writes generated data under `%USERPROFILE%\Desktop\helix-storage` (or the absolute path configured by `HELIX_STORAGE_DIR`):

- `desktop`: Electron settings, pairing state, capabilities, and Docker session metadata.
- `agent`: learned profile, memories, skills, and browser profile.
- `models` and `bin`: local GGUF models and llama.cpp binaries.
- `computer-home`: persistent home directory for the isolated Docker desktop.
- `cache`, `logs`, and `temp`: Electron/AI model caches, application logs, and temporary files.

Existing Electron settings and Python agent data are copied to the new location on first launch without deleting their old copies. Existing GGUF models in `%APPDATA%\Helix\models` remain discoverable; new downloads use `helix-storage\models`.

## Windows application recommendations

The Toolbox can explicitly scan installed-app registry entries, Start Menu shortcuts, and AppX package names. It returns application display names only; it does not copy Windows executables, app settings, credentials, or user data. Known apps can be mapped to Debian equivalents. The user selects recommendations and confirms installation in a native confirmation dialog before HELIX runs `apt-get` for the fixed, allow-listed package IDs inside the isolated container. Unknown apps remain suggestions without an install action.

## Windows host backend

Host actions use the existing Windows UI Automation and input tools. The real host is controlled only after explicit user consent. In `auto`, an explicit host consent selects the host; without consent, HELIX stays in the isolated container and never silently falls back to the host.

Host preflight lists open application windows without capturing the monitor, and excludes windows titled as HELIX. HELIX prefers UI Automation for the selected app, including when another window obscures it. When visual details are needed, `host_screenshot` requires that app's `window_handle` and uses Windows `PrintWindow` to capture only that window; it never substitutes a full-monitor image. Minimized windows and apps that cannot render through `PrintWindow` return an explicit error. Multiple apps can be compared through separate, sequential captures. Host actions do not attach incidental monitor screenshots.

On-demand `computer.observe_screen` also selects one non-HELIX application window using the request context (or the foremost app when no title matches), attaches only that window image, and returns the available window handles. The model can request additional apps by handle in sequential observations. The legacy `screenshot_tool` still supports a deliberate full-monitor capture; use `capture_window` when an unobstructed app view is needed.

## Boundaries and verification

- The desktop preview is fed by authenticated frames from the Docker container; host frames are not included.
- A targeted host capture is limited to the requested native window. Some hardware-accelerated or protected apps may not support `PrintWindow`; those captures fail instead of returning an obstructed monitor image.
- Docker setup requires a running Docker Engine and network access to build the image and fetch Debian packages.
- Docker containers share the Docker Engine's Linux kernel; this is not the same isolation boundary as a dedicated VM. HELIX does not mount the Docker socket or any host directories into this container.
- The Docker backend does not create, start, or manage virtual machines. The Windows host backend remains available only with explicit user consent.

Run the focused agent tests from the repository root:

```powershell
python -m pytest services/agent/tests/test_desktop_control_tool.py services/agent/desktop_control/tests -q
```
