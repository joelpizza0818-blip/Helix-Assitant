from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


_PROFILE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{1,39}$")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
_ROUTES = {"planning", "coding", "automation", "research", "analysis", "general"}
_MAX_PROFILES = 100
_DEFAULT_PROFILES = (
    {
        "profile_id": "harvey",
        "name": "Harvey",
        "role": "planning",
        "description": "Coordinación y planificación; divide tareas y mantiene visión de conjunto.",
        "capabilities": ["planning", "coordination"],
        "color": "#ee6018",
    },
    {
        "profile_id": "joel",
        "name": "Joel",
        "role": "coding",
        "description": "Ingeniería de software; implementación y arquitectura.",
        "capabilities": ["coding", "architecture"],
        "color": "#02b8cc",
    },
    {
        "profile_id": "flowbot",
        "name": "Flowbot",
        "role": "automation",
        "description": "Automatización de flujos y herramientas; navegador y tareas repetibles.",
        "capabilities": ["automation", "browser", "workflow"],
        "color": "#8b5cf6",
    },
    {
        "profile_id": "eliot",
        "name": "Eliot",
        "role": "research",
        "description": "Investigación, análisis crítico y verificación de resultados.",
        "capabilities": ["research", "analysis", "verification"],
        "color": "#a0ca92",
    },
)


@dataclass
class AgentProfile:
    profile_id: str
    name: str
    role: str
    description: str
    capabilities: list[str]
    color: str
    instructions: str = ""
    model_route: Optional[dict] = None
    promotion_history: list[str] = field(default_factory=list)
    created_by: str = "default"
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def public_dict(self) -> dict:
        return asdict(self)


class AgentProfileStore:
    """Local, non-secret catalog of reusable subagent identities."""

    def __init__(self, path: Optional[Path] = None):
        self.path = path
        if self.path is None:
            self._profiles = {
                profile["profile_id"]: AgentProfile(**profile)
                for profile in _DEFAULT_PROFILES
            }
        else:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if not self.path.exists():
                self._write([
                    AgentProfile(**profile) for profile in _DEFAULT_PROFILES
                ])
            self._profiles = self._read()

    def _read(self) -> dict[str, AgentProfile]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Could not load subagent profiles from {self.path}.") from error
        if not isinstance(data, list):
            raise ValueError(f"Invalid subagent profile catalog in {self.path}.")
        profiles: dict[str, AgentProfile] = {}
        for item in data:
            profile = self._validated_profile(item)
            if profile.profile_id in profiles:
                raise ValueError(f"Duplicate subagent profile: {profile.profile_id}.")
            profiles[profile.profile_id] = profile
        return profiles

    def _write(self, profiles: list[AgentProfile]) -> None:
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps([profile.public_dict() for profile in profiles], indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        temporary.replace(self.path)

    @staticmethod
    def _validated_profile(value: object) -> AgentProfile:
        if not isinstance(value, dict):
            raise ValueError("Subagent profile must be an object.")
        profile_id = value.get("profile_id")
        name = value.get("name")
        role = value.get("role")
        description = value.get("description")
        capabilities = value.get("capabilities")
        color = value.get("color")
        instructions = value.get("instructions", "")
        if not isinstance(profile_id, str) or not _PROFILE_ID.fullmatch(profile_id):
            raise ValueError("Subagent profile id is invalid.")
        if not isinstance(name, str) or not name.strip() or len(name) > 40:
            raise ValueError("Subagent profile name is invalid.")
        if not isinstance(role, str) or role not in _ROUTES:
            raise ValueError("Subagent profile role is unsupported.")
        if not isinstance(description, str) or not description.strip() or len(description) > 500:
            raise ValueError("Subagent profile description is invalid.")
        if (
            not isinstance(capabilities, list)
            or len(capabilities) > 20
            or any(not isinstance(item, str) or not item.strip() or len(item) > 40 for item in capabilities)
        ):
            raise ValueError("Subagent profile capabilities are invalid.")
        if not isinstance(color, str) or not _COLOR.fullmatch(color):
            raise ValueError("Subagent profile color must be a six-digit hex color.")
        if not isinstance(instructions, str) or len(instructions) > 6000:
            raise ValueError("Subagent profile instructions must contain at most 6000 characters.")
        model_route = value.get("model_route")
        if model_route is not None:
            if not isinstance(model_route, dict):
                raise ValueError("Subagent model route must be an object.")
            provider = model_route.get("provider")
            model = model_route.get("model")
            key_slot = model_route.get("key_slot")
            _no_key_providers = {"free", "ollama"}
            if (
                not isinstance(provider, str)
                or not provider.strip()
                or not isinstance(model, str)
                or not model.strip()
            ):
                raise ValueError("Subagent model route must specify provider and model.")
            if provider in _no_key_providers:
                key_slot = 0  # Keyless providers use slot 0 by convention
            elif (
                not isinstance(key_slot, int)
                or isinstance(key_slot, bool)
                or key_slot < 0
            ):
                raise ValueError("Subagent model route must specify provider, model, and key slot.")
            model_route = {
                "provider": provider,
                "model": model,
                "key_slot": key_slot,
            }
        promotion_history = value.get("promotion_history", [])
        if (
            not isinstance(promotion_history, list)
            or len(promotion_history) > 50
            or any(not isinstance(item, str) or not item.strip() or len(item) > 200 for item in promotion_history)
        ):
            raise ValueError("Subagent promotion history is invalid.")
        created_by = value.get("created_by", "default")
        if not isinstance(created_by, str) or not created_by.strip() or len(created_by) > 80:
            raise ValueError("Subagent profile creator is invalid.")
        return AgentProfile(
            profile_id=profile_id,
            name=name.strip(),
            role=role,
            description=description.strip(),
            capabilities=list(dict.fromkeys(item.strip() for item in capabilities)),
            color=color.lower(),
            instructions=instructions.strip(),
            model_route=model_route,
            promotion_history=list(promotion_history),
            created_by=created_by,
            created_at=value.get("created_at") or datetime.now(timezone.utc).isoformat(),
        )

    def list_profiles(self) -> list[AgentProfile]:
        return list(self._profiles.values())

    def get(self, profile_id: str) -> Optional[AgentProfile]:
        return self._profiles.get(profile_id)

    def create(
        self,
        *,
        name: str,
        role: str,
        description: str,
        capabilities: list[str],
        color: str,
        instructions: str = "",
        created_by: str = "model",
    ) -> AgentProfile:
        if not isinstance(name, str):
            raise ValueError("Subagent profile name is invalid.")
        profile_id = re.sub(r"[^a-z0-9_-]+", "-", name.strip().casefold()).strip("-")
        if not _PROFILE_ID.fullmatch(profile_id):
            raise ValueError("Generated subagent name must produce a valid profile id.")
        if len(self._profiles) >= _MAX_PROFILES:
            raise ValueError(f"Subagent catalog is full ({_MAX_PROFILES} profiles).")
        if profile_id in self._profiles:
            raise ValueError(f"A subagent named {name.strip()} already exists.")
        if any(profile.name.casefold() == name.strip().casefold() for profile in self._profiles.values()):
            raise ValueError(f"A subagent named {name.strip()} already exists.")
        profile = self._validated_profile({
            "profile_id": profile_id,
            "name": name,
            "role": role,
            "description": description,
            "capabilities": capabilities,
            "color": color,
            "instructions": instructions,
            "created_by": created_by,
        })
        self._profiles[profile_id] = profile
        self._persist()
        return profile

    def update(
        self,
        profile_id: str,
        *,
        name: str,
        role: str,
        description: str,
        capabilities: list[str],
        color: str,
        instructions: str,
    ) -> AgentProfile:
        profile = self._profiles.get(profile_id)
        if profile is None:
            raise KeyError(f"Subagent profile {profile_id} does not exist.")
        updated = self._validated_profile({
            **profile.public_dict(),
            "name": name,
            "role": role,
            "description": description,
            "capabilities": capabilities,
            "color": color,
            "instructions": instructions,
        })
        if any(
            item.profile_id != profile_id and item.name.casefold() == updated.name.casefold()
            for item in self._profiles.values()
        ):
            raise ValueError(f"A subagent named {updated.name} already exists.")
        profile.name = updated.name
        profile.role = updated.role
        profile.description = updated.description
        profile.capabilities = updated.capabilities
        profile.color = updated.color
        profile.instructions = updated.instructions
        self._persist()
        return profile

    def assign_route(
        self,
        profile_id: str,
        provider: Optional[str],
        model: Optional[str],
        key_slot: Optional[int],
    ) -> AgentProfile:
        profile = self._profiles.get(profile_id)
        if profile is None:
            raise KeyError(f"Subagent profile {profile_id} does not exist.")
        if provider is None and model is None and key_slot is None:
            profile.model_route = None
        else:
            route = self._validated_profile({
                **profile.public_dict(),
                "model_route": {
                    "provider": provider,
                    "model": model,
                    "key_slot": key_slot,
                },
            })
            profile.model_route = route.model_route
        self._persist()
        return profile

    def promote(
        self,
        profile_id: str,
        work: str,
        capabilities: list[str],
    ) -> AgentProfile:
        profile = self._profiles.get(profile_id)
        if profile is None:
            raise KeyError(f"Subagent profile {profile_id} does not exist.")
        if not isinstance(work, str) or not work.strip() or len(work.strip()) > 200:
            raise ValueError("Promotion scope must contain 1 to 200 characters.")
        if (
            not isinstance(capabilities, list)
            or not capabilities
            or len(capabilities) > 5
            or any(not isinstance(item, str) or not item.strip() or len(item) > 40 for item in capabilities)
        ):
            raise ValueError("Promotion capabilities are invalid.")
        additions = list(dict.fromkeys(item.strip() for item in capabilities))
        next_capabilities = list(dict.fromkeys(profile.capabilities + additions))
        if len(next_capabilities) > 20:
            raise ValueError("Subagent capability limit reached.")
        history = profile.promotion_history + [work.strip()]
        if len(history) > 50:
            raise ValueError("Subagent promotion history limit reached.")
        profile.description = f"{profile.description} Additional scope: {work.strip()}".strip()
        if len(profile.description) > 500:
            raise ValueError("Promotion would exceed the profile description limit.")
        profile.capabilities = next_capabilities
        profile.promotion_history = history
        self._persist()
        return profile

    def _persist(self) -> None:
        if self.path is not None:
            self._write(self.list_profiles())
