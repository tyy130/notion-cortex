"""
Entry point for the Plan-Preflight-Verify-Execute reasoning agent.

Usage:
    python -m reasoning_agent "Write a summary of all .py files"
    python -m reasoning_agent --resume "Continue the previous task"

The Domain Context Engine runs before asyncio.run():
  • Classifies task intent (RESEARCH / CODE / SYSADMIN / DATA / CREATIVE / GENERAL)
  • Scans cwd for context shards (README.md, schema files, etc.)
  • Builds a TaskContext that is forwarded into AgentDeps

State recovery:
    If a session is interrupted, re-run the same command with --resume.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

_PROJECT_ROOT = str(Path(__file__).parent.parent.resolve())
_MAX_RECOVERY_ATTEMPTS = 3

# Clear broken system-level SOCKS proxy so httpx can reach the OpenAI API.
for _proxy_key in ("ALL_PROXY", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY",
                   "http_proxy", "https_proxy"):
    os.environ.pop(_proxy_key, None)

# Load .env so DATABASE_URL, OPENAI_API_KEY, TAVILY_API_KEY are available.
_env_file = Path(__file__).parent.parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip())

from .agent import get_agent
from .deps import AgentDeps
from .orchestrator import build_context
from .recovery import get_recovery_agent
from .schemas import TaskContext
from .state import StateManager
from .tools import NeedsHumanClarification

# Memory import commented out until memory.py is created in Chunk 4.
# from .memory import store_trace

_DEFAULT_TASK = (
    "List all Python files in the current directory and write a brief "
    "summary of each file's purpose to output/summary.md"
)


async def _handle_clarification(
    exc: NeedsHumanClarification, task: str, sm: StateManager
) -> str:
    print(f"\n{'─' * 60}")
    print("⚠️  CLARIFICATION REQUIRED — write blocked by preflight gate")
    print(f"{'─' * 60}")
    print(exc.question)
    print(f"{'─' * 60}\n")

    answer = input("Your response (yes / no / provide guidance): ").strip().lower()

    if answer in ("yes", "y"):
        amended_task = (
            f"{task}\n\n"
            f"[Human approved the following blocked action]\n"
            f"{exc.question}\n"
            f"Human said: proceed"
        )
        return await run(amended_task, resume=True)
    else:
        reason = answer if answer not in ("no", "n", "") else "User declined"
        print(f"Task aborted: {reason}")
        sm.mark_complete(f"ABORTED — {reason}")
        return f"Aborted: {reason}"


async def run(task: str, resume: bool = False, task_context: TaskContext | None = None) -> str:
    state_file = Path("agent_state.json")

    if not resume and state_file.exists():
        state_file.unlink()

    sm = StateManager(state_file)
    sm.load_or_create(task)

    deps = AgentDeps(
        state_manager=sm,
        task_context=task_context,
        # memory_namespace is derived automatically in AgentDeps.__post_init__
    )

    for attempt in range(1, _MAX_RECOVERY_ATTEMPTS + 1):
        try:
            agent = get_agent()
            async with agent.run_mcp_servers():
                result = await agent.run(task, deps=deps)

            sm.mark_complete(result.output)

            # Memory trace write — uncomment after memory.py is created (Task 12).
            # trace_task = asyncio.create_task(
            #     store_trace(
            #         namespace=deps.memory_namespace,
            #         task=task,
            #         steps=sm.state.steps,
            #         outcome=result.output,
            #     )
            # )
            # try:
            #     await asyncio.wait_for(asyncio.shield(trace_task), timeout=10.0)
            # except asyncio.TimeoutError:
            #     print("[Memory] store_trace timed out — trace not persisted.", file=sys.stderr)

            return result.output

        except NeedsHumanClarification as exc:
            return await _handle_clarification(exc, task, sm)

        except Exception as exc:
            if attempt >= _MAX_RECOVERY_ATTEMPTS:
                print(
                    f"\n[Outer Loop] All {_MAX_RECOVERY_ATTEMPTS} recovery attempts "
                    "exhausted. Giving up."
                )
                raise

            print(
                f"\n[Outer Loop] Attempt {attempt}/{_MAX_RECOVERY_ATTEMPTS} failed: "
                f"{type(exc).__name__}: {exc}"
            )

            diagnosis_result = await get_recovery_agent().run(
                f"Task: {task}\n\nError ({type(exc).__name__}):\n{exc}"
            )
            diagnosis = diagnosis_result.output

            print(f"[Outer Loop] Category   : {diagnosis.error_category.value}")
            print(f"[Outer Loop] Fixable    : {diagnosis.is_fixable}")
            print(f"[Outer Loop] Explanation: {diagnosis.explanation}")

            if not diagnosis.is_fixable:
                print("[Outer Loop] Error classified as non-fixable — propagating.")
                raise

            if diagnosis.remediation_command:
                cmd = diagnosis.remediation_command
                print(f"[Outer Loop] Remediating: {cmd}")
                proc = await asyncio.create_subprocess_shell(
                    cmd,
                    cwd=_PROJECT_ROOT,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout_b, stderr_b = await asyncio.wait_for(
                    proc.communicate(), timeout=120.0
                )
                if proc.returncode != 0:
                    err_snippet = stderr_b.decode(errors="replace")[:500]
                    raise RuntimeError(
                        f"Remediation command failed (exit {proc.returncode}): "
                        f"{err_snippet}"
                    )
                print(
                    f"[Outer Loop] Remediation succeeded. "
                    f"Resuming (attempt {attempt + 1})..."
                )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="reasoning_agent")
    parser.add_argument("task", nargs="*", help="Task description")
    parser.add_argument("--resume", action="store_true", help="Resume previous session")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    task = " ".join(args.task) if args.task else _DEFAULT_TASK

    # Sync — safe to call before asyncio.run(); blocking input() works here
    task_context = build_context(task, cwd=Path.cwd())

    result = asyncio.run(run(task, resume=args.resume, task_context=task_context))
    print(f"\n{'═' * 60}")
    print("RESULT")
    print(f"{'═' * 60}")
    print(result)


if __name__ == "__main__":
    main()
