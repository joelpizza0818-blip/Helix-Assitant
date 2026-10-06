import logging
import asyncio
import uuid
from enum import Enum, auto
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

class ConfirmationStatus(Enum):
    PENDING = auto()
    CONFIRMED = auto()
    REJECTED = auto()
    TIMEOUT = auto()

@dataclass
class ConfirmationRequest:
    id: str
    action: str
    what_will_change: str
    why: str
    level: str
    status: ConfirmationStatus
    created_at: datetime
    timeout_at: datetime

class EventBus: # Stub
    @staticmethod
    def emit(event_type: str, data: dict):
        logger.info(f"EventBus emit: {event_type} - {data}")
    @staticmethod
    def subscribe(event_type: str, callback):
        pass

class ConfirmationManager:
    def __init__(self):
        self.requests: Dict[str, ConfirmationRequest] = {}
        EventBus.subscribe("GESTURE_CONFIRM", self._handle_gesture_confirm)
        EventBus.subscribe("GESTURE_REJECT", self._handle_gesture_reject)

    async def request_confirmation(self, action: str, what_will_change: str, why: str, level: str, timeout: int = 60) -> ConfirmationRequest:
        req_id = str(uuid.uuid4())
        now = datetime.now()
        req = ConfirmationRequest(
            id=req_id,
            action=action,
            what_will_change=what_will_change,
            why=why,
            level=level,
            status=ConfirmationStatus.PENDING,
            created_at=now,
            timeout_at=now + timedelta(seconds=timeout)
        )
        self.requests[req_id] = req
        EventBus.emit("CONFIRMATION_REQUIRED", {"request_id": req_id, "action": action, "timeout": timeout})
        logger.info(f"Requested confirmation {req_id} for {action}")
        
        asyncio.create_task(self._auto_reject_on_timeout(req_id, timeout))
        return req

    async def wait_for_confirmation(self, request_id: str, timeout: int = 60) -> ConfirmationStatus:
        start = datetime.now()
        while datetime.now() - start < timedelta(seconds=timeout):
            req = self.requests.get(request_id)
            if not req:
                return ConfirmationStatus.REJECTED
            if req.status != ConfirmationStatus.PENDING:
                return req.status
            await asyncio.sleep(0.5)
        self.reject(request_id)
        return ConfirmationStatus.TIMEOUT

    def confirm(self, request_id: str) -> bool:
        if request_id in self.requests and self.requests[request_id].status == ConfirmationStatus.PENDING:
            self.requests[request_id].status = ConfirmationStatus.CONFIRMED
            logger.info(f"Request {request_id} confirmed")
            return True
        return False

    def reject(self, request_id: str) -> bool:
        if request_id in self.requests and self.requests[request_id].status == ConfirmationStatus.PENDING:
            self.requests[request_id].status = ConfirmationStatus.REJECTED
            logger.info(f"Request {request_id} rejected")
            return True
        return False

    def get_pending_confirmations(self) -> List[ConfirmationRequest]:
        return [r for r in self.requests.values() if r.status == ConfirmationStatus.PENDING]

    async def _auto_reject_on_timeout(self, request_id: str, timeout: int):
        await asyncio.sleep(timeout)
        if request_id in self.requests and self.requests[request_id].status == ConfirmationStatus.PENDING:
            self.requests[request_id].status = ConfirmationStatus.TIMEOUT
            logger.info(f"Request {request_id} timed out")

    def _handle_gesture_confirm(self, data: dict):
        pending = self.get_pending_confirmations()
        if pending:
            most_recent = max(pending, key=lambda x: x.created_at)
            self.confirm(most_recent.id)

    def _handle_gesture_reject(self, data: dict):
        pending = self.get_pending_confirmations()
        if pending:
            most_recent = max(pending, key=lambda x: x.created_at)
            self.reject(most_recent.id)
