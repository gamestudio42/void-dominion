/**
 * Agent Arena JSON contracts (version 1.0.0).
 * These types define the protocol between the Arena and external agents.
 *
 * Fields marked optional were added after 1.0.0 shipped. They are additive, so the
 * version string did not change: the Arena checks it exactly on every reply, and a
 * new version would refuse every agent written against 1.0.0. An agent must ignore
 * fields it does not know.
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
  /** Supply in use and the cap; a unit is refused when it would pass the cap. */
  supplyUsed?: number;
  supplyCap?: number;
  /** Power produced and drawn. Below the draw, turrets stop firing. */
  powerGive?: number;
  powerTake?: number;
  units: ObservationUnit[];
  buildings: ObservationBuilding[];
  nodes: ObservationNode[];
  /** What became of the actions of this seat's previous decision. Absent before the first one. */
  lastDecision?: DecisionFeedback;
}

export interface DecisionFeedback {
  requestId: string;
  /** The agent did not answer in time or validly, and the fallback decided instead. */
  fallback: boolean;
  /** One entry per action, in the order they were sent. */
  results: ActionResult[];
}

export interface ActionResult {
  index: number;
  accepted: boolean;
  /** The engine's reason key when the action was refused, such as `no_ore` or `unknown_unit`. */
  reason?: string;
}

export interface ObservationUnit {
  id: number;
  owner: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  /** The seat's own units only: the current order, such as `idle`, `gather` or `build`. */
  order?: string;
  /** The seat's own units only: what an engineer carries back. */
  carryOre?: number;
  carryAether?: number;
}

export interface ObservationBuilding {
  id: number;
  owner: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  wreck: boolean;
  /** True for a foreign building out of sight, as it was last seen. Its hp may be stale. */
  remembered?: boolean;
  /** In sight or owned: construction share from 0 to 1, and whether it is finished. */
  progress?: number;
  complete?: boolean;
  /** The seat's own buildings only: the unit in production, its ticks left, and the queue behind it. */
  producing?: string | null;
  producingTicksLeft?: number;
  queue?: string[];
}

export interface ObservationNode {
  id: number;
  kind: 'ore' | 'aether';
  x: number;
  y: number;
  /** Current stock, only while the node's cell is in sight. */
  amount?: number;
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
