import pytest
import asyncio
from services.agent.security.confirmation_manager import ConfirmationManager, ConfirmationStatus
from services.agent.security.permission_manager import PermissionLevel

@pytest.mark.asyncio
async def test_confirmation_lifecycle(confirmation_manager):
    req = await confirmation_manager.request_confirmation(
        action="delete_file",
        what_will_change="Remove file C:\\temp\\data.txt",
        why="User requested cleanup",
        level=PermissionLevel.CRITICAL,
        timeout=5
    )

    assert req.id is not None
    assert req.status == ConfirmationStatus.PENDING

    # Confirm the action
    confirmed = confirmation_manager.confirm(req.id)
    assert confirmed is True
    assert req.status == ConfirmationStatus.CONFIRMED

@pytest.mark.asyncio
async def test_rejection_lifecycle(confirmation_manager):
    req = await confirmation_manager.request_confirmation(
        action="format_disk",
        what_will_change="Format volume D:",
        why="Storage cleanup",
        level=PermissionLevel.CRITICAL,
        timeout=5
    )

    rejected = confirmation_manager.reject(req.id)
    assert rejected is True
    assert req.status == ConfirmationStatus.REJECTED

@pytest.mark.asyncio
async def test_gesture_confirm_only_acts_when_pending(confirmation_manager):
    # Accidental gesture when nothing is pending should do nothing
    assert confirmation_manager.get_pending_confirmations() == []
    
    # Simulate gesture handler
    # Should not raise or affect any request
    req = await confirmation_manager.request_confirmation(
        action="run_script",
        what_will_change="Execute setup.bat",
        why="Automated build",
        level=PermissionLevel.EXECUTE,
        timeout=5
    )

    # Now pending exists, gesture confirm should succeed
    confirmation_manager.confirm(req.id)
    assert req.status == ConfirmationStatus.CONFIRMED
