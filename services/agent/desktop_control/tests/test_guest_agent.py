import base64

import pytest

from services.agent.desktop_control.guest.guest_agent import GuestDesktopAgent


@pytest.mark.asyncio
async def test_guest_agent_requires_token_and_returns_guest_only_screenshots():
    async def frame_provider():
        return b"jpeg-frame"

    async def cursor_provider():
        return {"x": 0.25, "y": 0.5, "visible": True}

    agent = GuestDesktopAgent(
        "a" * 48,
        frame_provider=frame_provider,
        cursor_provider=cursor_provider,
    )

    unauthorized = await agent.dispatch({"token": "wrong", "action": "screenshot"})
    assert unauthorized["ok"] is False

    result = await agent.dispatch({"token": "a" * 48, "action": "screenshot"})
    assert result["ok"] is True
    assert result["capture_source"] == "docker_guest"
    assert base64.b64decode(result["image_base64"]) == b"jpeg-frame"
    assert result["virtual_cursor"] == {"x": 0.25, "y": 0.5, "visible": True}


@pytest.mark.asyncio
async def test_guest_agent_uses_allow_listed_process_arguments_without_shell():
    calls = []

    async def runner(*arguments):
        calls.append(arguments)
        return b""

    agent = GuestDesktopAgent("b" * 48, runner=runner)

    assert await agent.dispatch({
        "token": "b" * 48,
        "action": "click",
        "x": 10,
        "y": 20,
        "button": 1,
    }) == {"ok": True, "action": "click"}
    assert await agent.dispatch({
        "token": "b" * 48,
        "action": "move",
        "x": 40,
        "y": 50,
    }) == {"ok": True, "action": "move"}
    assert calls == [
        ("xdotool", "mousemove", "10", "20", "click", "1"),
        ("xdotool", "mousemove", "40", "50"),
    ]

    with pytest.raises(ValueError, match="unsupported characters"):
        await agent.dispatch({
            "token": "b" * 48,
            "action": "key",
            "key": "ctrl+a; id",
        })
    with pytest.raises(ValueError, match="Mouse button"):
        await agent.dispatch({
            "token": "b" * 48,
            "action": "click",
            "x": 10,
            "y": 20,
            "button": True,
        })
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_guest_agent_limits_text_and_application_launch_identifiers():
    calls = []

    async def runner(*arguments):
        calls.append(arguments)
        return b""

    agent = GuestDesktopAgent("c" * 48, runner=runner)

    with pytest.raises(ValueError, match="16000"):
        await agent.dispatch({
            "token": "c" * 48,
            "action": "type",
            "text": "x" * 16_001,
        })
    with pytest.raises(ValueError, match="desktop-file identifier"):
        await agent.dispatch({
            "token": "c" * 48,
            "action": "launch",
            "application": "app;id",
        })
    assert calls == []


@pytest.mark.asyncio
async def test_guest_agent_launches_applications_without_capturing_their_lifetime():
    launched = []

    async def launcher(application):
        launched.append(application)

    agent = GuestDesktopAgent("e" * 48, launcher=launcher)

    result = await agent.dispatch({
        "token": "e" * 48,
        "action": "launch",
        "application": "xfce4-terminal",
    })
    assert result == {
        "ok": True,
        "action": "launch",
        "application": "xfce4-terminal",
    }
    assert launched == ["xfce4-terminal"]


@pytest.mark.asyncio
async def test_guest_capture_and_cursor_use_the_live_display_dimensions():
    calls = []

    async def runner(*arguments):
        calls.append(arguments)
        if arguments == ("xdotool", "getdisplaygeometry"):
            return b"1920 1080"
        if arguments == ("xdotool", "getmouselocation", "--shell"):
            return b"X=960\nY=540\n"
        return b"jpeg-frame"

    agent = GuestDesktopAgent("d" * 48, runner=runner)

    assert await agent._capture_frame() == b"jpeg-frame"
    ffmpeg_call = calls[1]
    assert ffmpeg_call[ffmpeg_call.index("-video_size") + 1] == "1920x1080"
    assert await agent._cursor_position() == {
        "x": 0.5,
        "y": 0.5,
        "visible": True,
    }
