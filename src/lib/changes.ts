/** Transparent CAB risk model (0-100). Every point is attributable to a named factor. */
export interface RiskInputs {
  impact: number; // 1 (single user) .. 5 (company-wide)
  affectedCount: number;
  hasRollbackPlan: boolean;
  testedInStaging: boolean;
  outsideMaintenanceWindow: boolean;
  touchesSecurityControls: boolean;
}

export const CAB_THRESHOLD = 50;

export function scoreChange(r: RiskInputs) {
  const factors: Record<string, number> = {
    [`Impact (${r.impact}/5)`]: Math.max(1, Math.min(r.impact, 5)) * 8,
    [`Blast radius (${r.affectedCount} CIs)`]: Math.min(r.affectedCount, 10) * 2,
    'No rollback plan': r.hasRollbackPlan ? 0 : 15,
    'Not tested in staging': r.testedInStaging ? 0 : 10,
    'Outside maintenance window': r.outsideMaintenanceWindow ? 5 : 0,
    'Touches security controls': r.touchesSecurityControls ? 10 : 0,
  };
  const score = Math.min(100, Object.values(factors).reduce((a, b) => a + b, 0));
  const level: 'LOW' | 'MEDIUM' | 'HIGH' = score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW';
  return {
    score,
    level,
    cabRequired: score >= CAB_THRESHOLD,
    factors: Object.fromEntries(Object.entries(factors).filter(([, v]) => v > 0)),
  };
}
