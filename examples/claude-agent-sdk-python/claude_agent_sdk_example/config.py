"""Shared configuration loaded from `.env.local` next to the project root.

The Claude Agent SDK is configured via `ClaudeAgentOptions(env={...})`
— the SDK spawns the Claude Code CLI, which reads `ANTHROPIC_BASE_URL`
and `ANTHROPIC_API_KEY` from the env we hand it. We point those at the
VM-X `/anthropic` prefix; the CLI appends `/v1/messages` (which VM-X
exposes as an alias for `/anthropic/messages`).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_env_local() -> None:
    here = Path(__file__).resolve()
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
    base_url: str
    workspace_id: str
    environment_id: str
    api_key: str
    anthropic_resource: str

    @property
    def anthropic_base_url(self) -> str:
        """Base URL the Claude Code CLI uses. The CLI appends `/v1/messages`."""
        return (
            f"{self.base_url}/v1/completion/"
            f"{self.workspace_id}/{self.environment_id}/anthropic"
        )


def load() -> GatewayConfig:
    base_url = os.environ.get("VMX_BASE_URL", "http://localhost:3030/api")
    workspace_id = os.environ.get("VMX_WORKSPACE_ID")
    environment_id = os.environ.get("VMX_ENVIRONMENT_ID")
    api_key = os.environ.get("VMX_API_KEY")
    # The agent CLI sends `output_config.effort` on every request, which
    # Haiku models don't accept — point the SDK at the agent-tier resource
    # (Sonnet) that the seed script creates for this purpose.
    anthropic_resource = (
        os.environ.get("VMX_ANTHROPIC_AGENT_RESOURCE")
        or os.environ.get("VMX_ANTHROPIC_RESOURCE")
    )

    resource_var_name = "VMX_ANTHROPIC_AGENT_RESOURCE or VMX_ANTHROPIC_RESOURCE"
    missing = [
        name
        for name, val in (
            ("VMX_WORKSPACE_ID", workspace_id),
            ("VMX_ENVIRONMENT_ID", environment_id),
            ("VMX_API_KEY", api_key),
            (resource_var_name, anthropic_resource),
        )
        if not val
    ]
    if missing:
        raise SystemExit(
            "Missing required env vars: "
            + ", ".join(missing)
            + "\nRun `pnpm exec nx run claude-agent-sdk-python-example:setup` "
            "first, or set them manually in "
            "`examples/claude-agent-sdk-python/.env.local`."
        )

    return GatewayConfig(
        base_url=base_url,
        workspace_id=workspace_id,  # type: ignore[arg-type]
        environment_id=environment_id,  # type: ignore[arg-type]
        api_key=api_key,  # type: ignore[arg-type]
        anthropic_resource=anthropic_resource,  # type: ignore[arg-type]
    )


# Env vars the spawned `claude` CLI inherits from the parent process
# that would make it behave as if it's running inside another Claude
# Code session — and silently skip the `ANTHROPIC_API_KEY` auth path
# in favour of parent-session OAuth tokens. Only relevant when this
# example is run inside another Claude Code session (e.g. during
# development); kept defensive so the example works in either case.
_CLAUDE_PARENT_SESSION_VARS = frozenset(
    [
        "CLAUDECODE",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_EXECPATH",
        "CLAUDE_AGENT_SDK_VERSION",
        "AI_AGENT",
    ]
)


def options_env(cfg: GatewayConfig) -> dict[str, str]:
    """Env dict to pass to `ClaudeAgentOptions(env=...)`.

    Includes the parent process env so the spawned CLI inherits PATH,
    HOME, etc.; only the Anthropic-pointer vars are overridden. Parent-
    Claude-Code-session markers are stripped so the spawned CLI
    doesn't think it's a nested agent and skip ANTHROPIC_API_KEY auth.
    """
    inherited = {
        k: v
        for k, v in os.environ.items()
        if k not in _CLAUDE_PARENT_SESSION_VARS
    }
    return {
        **inherited,
        "ANTHROPIC_BASE_URL": cfg.anthropic_base_url,
        "ANTHROPIC_API_KEY": cfg.api_key,
    }
