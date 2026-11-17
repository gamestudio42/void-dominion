/**
 * Agent Arena JSON contracts (version 1.0.0).
 * These types define the protocol between the Arena and external agents.
 */

export const SCHEMA_VERSION = '1.0.0';

export interface ObserveRequest {
  schemaVersion: string;
  requestId: string;
  type: 'agent.observe';
  seat: number;
  tick: number;
  ore: number;
  aether: number;
  units: ObservationUnit[];
  buildings: ObservationBuilding[];
  nodes: ObservationNode[];
}

export interface ObservationUnit {
  id: number;
  owner: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
}

export interface ObservationBuilding {
  id: number;
  owner: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  wreck: boolean;
}

export interface ObservationNode {
  id: number;
  kind: 'ore' | 'aether';
  x: number;
  y: number;
}

export interface ActResponse {
  schemaVersion: string;
  requestId: string;
  type: 'agent.act';
  actions: Action[];
  usage?: UsageTokens;
}

export interface UsageTokens {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type Action = StrategicPlanAction | CommandAction | NoopAction;

export interface StrategicPlanAction {
  type: 'strategic_plan';
  plan: StrategicPlan;
}

export type StrategicPlan = ProducePlan | GroupPlan | DefendPlan;

export interface ProducePlan {
  type: 'produce';
  buildingId: number;
  kind: string;
}

export interface GroupPlan {
  type: 'group';
  unitIds: number[];
  to: { x: number; y: number };
}

export interface DefendPlan {
  type: 'defend';
  at: { x: number; y: number };
}

export interface CommandAction {
  type: 'command';
  command: Command;
}

export type Command =
  | MoveCommand
  | AttackMoveCommand
  | StopCommand
  | AttackCommand
  | GatherCommand
  | BuildCommand
  | ProduceCommand;

export interface MoveCommand {
  type: 'move';
  unitIds: number[];
  to: { x: number; y: number };
}

export interface AttackMoveCommand {
  type: 'attack_move';
  unitIds: number[];
  to: { x: number; y: number };
}

export interface StopCommand {
  type: 'stop';
  unitIds: number[];
}

export interface AttackCommand {
  type: 'attack';
  unitIds: number[];
  targetId: number;
}

export interface GatherCommand {
  type: 'gather';
  unitIds: number[];
  nodeId: number;
}

export interface BuildCommand {
  type: 'build';
  unitIds: number[];
  kind: string;
  at: { x: number; y: number };
}

export interface ProduceCommand {
  type: 'produce';
  buildingId: number;
  kind: string;
}

export interface NoopAction {
  type: 'noop';
}

export interface ResetRequest {
  schemaVersion: string;
  type: 'agent.reset';
  seed: number;
  seat: number;
}

export interface StepRequest {
  schemaVersion: string;
  type: 'agent.step';
  tick: number;
}
