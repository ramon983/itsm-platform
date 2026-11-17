"""Change management: CAB risk scoring."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from app.core.config import get_settings
from app.models import ChangeRisk


@dataclass(frozen=True)
class RiskInputs:
    impact: int  # 1 (single user) .. 5 (company-wide)
    affected_ci_count: int
    has_rollback_plan: bool
    tested_in_staging: bool
    outside_maintenance_window: bool
    recent_failed_changes_on_cis: int = 0
    touches_security_controls: bool = False


@dataclass(frozen=True)
class RiskResult:
    score: int
    level: ChangeRisk
    cab_required: bool
    factors: dict[str, int]


def score_change(r: RiskInputs) -> RiskResult:
    """Transparent additive risk model (0-100). Every point is attributable to a named factor."""
    factors = {
        "impact": max(0, min(r.impact, 5)) * 8,  # up to 40
        "blast_radius": min(r.affected_ci_count, 10) * 2,  # up to 20
        "no_rollback_plan": 0 if r.has_rollback_plan else 15,
        "untested": 0 if r.tested_in_staging else 10,
        "outside_window": 5 if r.outside_maintenance_window else 0,
        "failure_history": min(r.recent_failed_changes_on_cis, 3) * 3,  # up to 9
        "security_controls": 10 if r.touches_security_controls else 0,
    }
    score = min(100, sum(factors.values()))
    level = ChangeRisk.HIGH if score >= 60 else ChangeRisk.MEDIUM if score >= 30 else ChangeRisk.LOW
    return RiskResult(
        score=score,
        level=level,
        cab_required=score >= get_settings().cab_required_threshold,
        factors={k: v for k, v in factors.items() if v},
    )


def inputs_dict(r: RiskInputs) -> dict[str, object]:
    return asdict(r)
