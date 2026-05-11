"""Shared configuration loaded from environment variables.

Each example reads these values once at import time. Defaults assume
the local docker-compose stack on port 3030 and the env vars produced
by `python -m api_completion_examples.setup` (which writes them to
`.env.local` next to this folder).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_env_local() -> None:
    """Best-effort load of `.env.local` next to the project root.

    `setup.py` writes IDs / keys here after provisioning. Avoids a
    hard dependency on python-dotenv: tiny KEY=VALUE parser is enough.
    """
    here = Path(__file__).resolve()
    # examples/api-completion/api_completion_examples/config.py
    project_root = here.parent.parent
    env_file = project_root / ".env.local"
    if not env_file.exists():
        return
    for raw in env_file.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_local()


@dataclass(frozen=True)
class GatewayConfig:
    """Runtime config the examples need to talk to the gateway."""

    base_url: str
    workspace_id: str
    environment_id: str
    api_key: str
    # Resource names — set by `setup.py`. The examples address resources
    # by name (the public contract); the gateway resolves to UUIDs.
    openai_resource: str
    openai_search_resource: str | None
    anthropic_resource: str | None
    perplexity_resource: str | None
    gemini_resource: str | None

    @property
    def base_completion_url(self) -> str:
        """OpenAI-SDK base_url for /chat/completions and /responses."""
        return (
            f"{self.base_url}/v1/completion/"
            f"{self.workspace_id}/{self.environment_id}"
        )

    @property
    def base_anthropic_url(self) -> str:
        """Anthropic-SDK base_url for /anthropic/messages.

        Anthropic's SDK auto-appends `/v1/messages`, so the URL stops
        at `…/anthropic` (one segment short of the gateway path).
        """
        return (
            f"{self.base_url}/v1/completion/"
            f"{self.workspace_id}/{self.environment_id}/anthropic"
        )


def load() -> GatewayConfig:
    """Read config from env. Fail loudly if a required field is missing."""
    base_url = os.environ.get("VMX_BASE_URL", "http://localhost:3030/api")
    workspace_id = os.environ.get("VMX_WORKSPACE_ID")
    environment_id = os.environ.get("VMX_ENVIRONMENT_ID")
    api_key = os.environ.get("VMX_API_KEY")
    openai_resource = os.environ.get("VMX_OPENAI_RESOURCE")

    missing = [
        name
        for name, val in (
            ("VMX_WORKSPACE_ID", workspace_id),
            ("VMX_ENVIRONMENT_ID", environment_id),
            ("VMX_API_KEY", api_key),
            ("VMX_OPENAI_RESOURCE", openai_resource),
        )
        if not val
    ]
    if missing:
        raise SystemExit(
            "Missing required env vars: "
            + ", ".join(missing)
            + "\nRun `pnpm exec nx run api-completion-example:setup` first to "
            "provision the workspace/environment/connection/resource/api-key, "
            "or set them manually in examples/api-completion/.env.local."
        )

    return GatewayConfig(
        base_url=base_url,
        workspace_id=workspace_id,  # type: ignore[arg-type]
        environment_id=environment_id,  # type: ignore[arg-type]
        api_key=api_key,  # type: ignore[arg-type]
        openai_resource=openai_resource,  # type: ignore[arg-type]
        openai_search_resource=os.environ.get("VMX_OPENAI_SEARCH_RESOURCE"),
        anthropic_resource=os.environ.get("VMX_ANTHROPIC_RESOURCE"),
        perplexity_resource=os.environ.get("VMX_PERPLEXITY_RESOURCE"),
        gemini_resource=os.environ.get("VMX_GEMINI_RESOURCE"),
    )
