# Architecture

## System Diagram

```text
+-----------------------------------------------------------+
|                      Windows OS                           |
|  (File System, Processes, Window Management, Inputs)      |
+-----------------------------+-----------------------------+
                              |
+-----------------------------v-----------------------------+
|               HELIX Desktop Shell (Electron)              |
|  - System Tray & Overlay UI                               |
|  - Renderers (React)                                      |
|  - Local Settings & Config                                |
+-----------------------------+-----------------------------+
                     ^        |
          WebSocket  |        | IPC
                     |        v
+--------------------+--------+-----------------------------+
|                 HELIX Agent Process (Python)              |
|                                                           |
|  +-------------------+  +------------------------------+  |
|  | Perception Engine |  |       AI Orchestrator        |  |
|  | - Screen Capture  |  | - Model Router & Registry    |  |
|  | - Audio Wakeword  |  | - Task Manager               |  |
|  | - Gesture/Vision  |  | - Tool System & execution    |  |
|  +-------------------+  +------------------------------+  |
|                                                           |
|  +-------------------+  +------------------------------+  |
|  | Memory Subsystem  |  | Security & Permission Mgr    |  |
|  | - Semantic Search |  | - Request Approvals          |  |
|  | - Vector DB       |  | - OS/Browser Automation      |  |
|  +-------------------+  +------------------------------+  |
+-----------------------------------------------------------+
```

## Component Responsibilities

1. **Desktop Shell (Electron)**: Handles UI, tray icon, transparent overlays, and user interaction.
2. **Agent Process (Python)**: The core intelligence. Manages background tasks, memory, API requests, and tool execution.
3. **Perception Pipeline**: Continuously monitors screen state, voice input, and camera gestures.
4. **AI Orchestrator**: Routes requests to the appropriate model based on required capabilities and handles fallbacks.

## Communication
Electron and Python communicate primarily via WebSocket on `AGENT_WS_PORT` for high-throughput streaming (voice, screen chunks) and general IPC for command/control.

## Tool Execution Flow
1. Model requests a tool call.
2. AI Orchestrator receives the tool call.
3. Permission Manager verifies if the tool needs user confirmation.
4. If approved, the tool executes (e.g., OS command, Browser Automation).
5. Result is returned to the model context.

## Fallback System
The Model Router handles rate limits by rotating through `KEY_1`, `KEY_2`, and `KEY_3` of the same provider.

## Security Model
Capabilities that touch the filesystem, install software, or read sensitive data require explicit or pre-approved user permissions handled by the Permission Manager.
