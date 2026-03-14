"""
AgentDeps — the dependency container injected into every tool via RunContext[AgentDeps].

PydanticAI passes this through ctx.deps, giving tools access to:
  • state_manager     — persists every step to agent_state.json
  • task_context      — auto-classified intent + cwd context shards (None = unclassified)
  • memory_namespace  — pgvector partition key (derived from task_context.intent or "general")
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .state import StateManager
from .schemas import TaskContext


@dataclass
class AgentDeps:
    state_manager: StateManager
    task_context: TaskContext | None = None   # None = unclassified general mode
    memory_namespace: str = field(init=False)  # always derived — never set by caller

    def __post_init__(self) -> None:
        self.memory_namespace = (
            self.task_context.memory_namespace
            if self.task_context is not None
            else "general"
        )
