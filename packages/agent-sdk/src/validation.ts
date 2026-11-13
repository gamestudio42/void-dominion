import {
  SCHEMA_VERSION,
  type ActResponse,
  type Action,
  type Command,
  type ObserveRequest,
  type ResetRequest,
  type StepRequest,
  type StrategicPlan,
} from './contracts.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isCell(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && isInteger(value.x) && isInteger(value.y);
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isInteger);
}

export function validateObserveRequest(value: unknown): ObserveRequest | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== SCHEMA_VERSION) return null;
  if (!isString(value.requestId)) return null;
  if (value.type !== 'agent.observe') return null;
  if (!isInteger(value.seat)) return null;
  if (!isInteger(value.tick)) return null;
  if (!isNumber(value.ore)) return null;
  if (!isNumber(value.aether)) return null;
  if (!Array.isArray(value.units)) return null;
  if (!Array.isArray(value.buildings)) return null;
  if (!Array.isArray(value.nodes)) return null;
  return value as ObserveRequest;
}

export function validateResetRequest(value: unknown): ResetRequest | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== SCHEMA_VERSION) return null;
  if (value.type !== 'agent.reset') return null;
  if (!isInteger(value.seed)) return null;
  if (!isInteger(value.seat)) return null;
  return value as ResetRequest;
}

export function validateStepRequest(value: unknown): StepRequest | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== SCHEMA_VERSION) return null;
  if (value.type !== 'agent.step') return null;
  if (!isInteger(value.tick)) return null;
  return value as StepRequest;
}

function validateStrategicPlan(value: unknown): StrategicPlan | null {
  if (!isRecord(value)) return null;
  if (value.type === 'produce') {
    if (!isInteger(value.buildingId)) return null;
    if (!isString(value.kind)) return null;
    return value as StrategicPlan;
  }
  if (value.type === 'group') {
    if (!isIntegerArray(value.unitIds)) return null;
    if (!isCell(value.to)) return null;
    return value as StrategicPlan;
  }
  if (value.type === 'defend') {
    if (!isCell(value.at)) return null;
    return value as StrategicPlan;
  }
  return null;
}

function validateCommand(value: unknown): Command | null {
  if (!isRecord(value)) return null;
  if (value.type === 'move' || value.type === 'attack_move') {
    if (!isIntegerArray(value.unitIds)) return null;
    if (!isCell(value.to)) return null;
    return value as Command;
  }
  if (value.type === 'stop') {
    if (!isIntegerArray(value.unitIds)) return null;
    return value as Command;
  }
  if (value.type === 'attack') {
    if (!isIntegerArray(value.unitIds)) return null;
    if (!isInteger(value.targetId)) return null;
    return value as Command;
  }
  if (value.type === 'gather') {
    if (!isIntegerArray(value.unitIds)) return null;
    if (!isInteger(value.nodeId)) return null;
    return value as Command;
  }
  if (value.type === 'build') {
    if (!isIntegerArray(value.unitIds)) return null;
    if (!isString(value.kind)) return null;
    if (!isCell(value.at)) return null;
    return value as Command;
  }
  if (value.type === 'produce') {
    if (!isInteger(value.buildingId)) return null;
    if (!isString(value.kind)) return null;
    return value as Command;
  }
  return null;
}

function validateAction(value: unknown): Action | null {
  if (!isRecord(value)) return null;
  if (value.type === 'strategic_plan') {
    const plan = validateStrategicPlan(value.plan);
    if (!plan) return null;
    return value as Action;
  }
  if (value.type === 'command') {
    const command = validateCommand(value.command);
    if (!command) return null;
    return value as Action;
  }
  if (value.type === 'noop') {
    return value as Action;
  }
  return null;
}

export function validateActResponse(value: unknown): ActResponse | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== SCHEMA_VERSION) return null;
  if (!isString(value.requestId)) return null;
  if (value.type !== 'agent.act') return null;
  if (!Array.isArray(value.actions)) return null;
  for (const action of value.actions) {
    if (!validateAction(action)) return null;
  }
  return value as ActResponse;
}
