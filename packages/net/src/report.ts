/**
 * The text both players copy after an online match. English and stable, so two
 * notes from different languages can be compared.
 */

export interface FieldReport {
  role: 'host' | 'guest';
  tick: number;
  pingMs: number | null;
  iceLocal: string | null;
  iceRemote: string | null;
  drops: number;
  audit: 'pending' | 'pass' | 'fail';
  auditReason: string | null;
  result: 'playing' | 'victory' | 'defeat' | 'draw';
}

export function formatFieldReport(report: FieldReport): string {
  const audit = report.audit === 'fail' && report.auditReason ? `fail ${report.auditReason}` : report.audit;
  return [
    'void-dominion field test',
    `role: ${report.role}`,
    `tick: ${report.tick}`,
    `ping_ms: ${report.pingMs === null ? 'none' : String(report.pingMs)}`,
    `ice_local: ${report.iceLocal ?? 'unknown'}`,
    `ice_remote: ${report.iceRemote ?? 'unknown'}`,
    `drops: ${report.drops}`,
    `audit: ${audit}`,
    `result: ${report.result}`,
  ].join('\n');
}
