/**
 * Turns variable frame times into a whole number of fixed simulation steps.
 * When a frame is too long, the excess is dropped instead of queued.
 */
export interface FixedStepOptions {
  /** Seconds per simulation step. */
  dt: number;
  /** Longest frame accepted, in seconds. */
  maxFrameTime: number;
  /** Most steps run in one frame. */
  maxStepsPerFrame: number;
}

export interface FixedStepResult {
  steps: number;
  /** Fraction of a step left over, for render interpolation, in [0, 1). */
  alpha: number;
  /** Seconds discarded this frame because the machine could not keep up. */
  droppedTime: number;
}

export class FixedStepper {
  private accumulator = 0;

  constructor(readonly options: FixedStepOptions) {}

  advance(elapsedSeconds: number): FixedStepResult {
    const { dt, maxFrameTime, maxStepsPerFrame } = this.options;
    let dropped = 0;
    let elapsed = elapsedSeconds < 0 ? 0 : elapsedSeconds;
    if (elapsed > maxFrameTime) {
      dropped += elapsed - maxFrameTime;
      elapsed = maxFrameTime;
    }
    this.accumulator += elapsed;
    let steps = Math.floor(this.accumulator / dt);
    if (steps > maxStepsPerFrame) {
      dropped += (steps - maxStepsPerFrame) * dt;
      steps = maxStepsPerFrame;
    }
    this.accumulator -= steps * dt;
    if (this.accumulator >= dt) {
      dropped += this.accumulator - (this.accumulator % dt);
      this.accumulator %= dt;
    }
    return { steps, alpha: this.accumulator / dt, droppedTime: dropped };
  }

  reset(): void {
    this.accumulator = 0;
  }
}

/** Simulation rate. Rendering is independent and may run faster. */
export const SIMULATION_HZ = 20;
export const FIXED_DT = 1 / SIMULATION_HZ;
