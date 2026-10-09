"""Closed actions a supervising DSH may take. The caller counts earlier actions."""

from pathlib import PurePosixPath


WORKSPACE_ROOT = "/workspace"


class Observation:
    def __init__(self, phase: str | None = None, pause_reason: str | None = None,
                 plan_review_passed: bool = False, review_fault_retryable: bool = False,
                 approvals: int = 0, recovery_resumes: int = 0, restart_resumes: int = 0,
                 review_retries: int = 0, sandbox_path: str | None = None,
                 workspace_root: str = WORKSPACE_ROOT) -> None:
        self.phase = phase
        self.pause_reason = pause_reason
        self.plan_review_passed = plan_review_passed
        self.review_fault_retryable = review_fault_retryable
        self.approvals = approvals
        self.recovery_resumes = recovery_resumes
        self.restart_resumes = restart_resumes
        self.review_retries = review_retries
        self.sandbox_path = sandbox_path
        self.workspace_root = workspace_root


class Decision:
    def __init__(self, action: str, reason: str) -> None:
        self.action = action
        self.reason = reason

    def as_dict(self) -> dict[str, str]:
        return {"action": self.action, "reason": self.reason}


def path_inside_workspace(path: str, root: str = WORKSPACE_ROOT) -> bool:
    if not path or "\x00" in path or not root.startswith("/"):
        return False
    candidate = PurePosixPath(path)
    if not candidate.is_absolute():
        candidate = PurePosixPath(root) / candidate
    if ".." in candidate.parts:
        return False
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return candidate != PurePosixPath(root)


def decide(observation: Observation) -> Decision:
    if observation.sandbox_path is not None:
        if path_inside_workspace(observation.sandbox_path, observation.workspace_root):
            return Decision("allow-once", "sandbox write stays inside the task workspace")
        return Decision("reject", "sandbox request leaves the task workspace")
    if observation.phase == "awaiting-approval" and observation.plan_review_passed and observation.approvals == 0:
        return Decision("approve", "plan review passed and this plan version has no approval")
    if observation.pause_reason == "recovery-stalled" and observation.recovery_resumes == 0:
        return Decision("resume", "one recovery resume without a new objective")
    if observation.pause_reason == "recovery-stalled":
        return Decision("seal", "recovery already resumed once")
    if observation.pause_reason == "restart" and observation.restart_resumes == 0:
        return Decision("resume", "host restart requires one manual resume")
    if observation.pause_reason == "restart":
        return Decision("seal", "restart already resumed once")
    if observation.pause_reason == "review-fault" and observation.review_fault_retryable and observation.review_retries == 0:
        return Decision("retry-review", "one retry of a retryable review fault")
    if observation.pause_reason == "review-fault":
        return Decision("seal", "review fault is not retryable or was already retried")
    if observation.pause_reason in {"decision", "planning-stalled"}:
        return Decision("seal", "this pause waits for a user decision the runner must not invent")
    return Decision("none", "no intervention gate is open")
