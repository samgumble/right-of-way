import { ECONOMY } from './constants';

/** Tracks the two Phase 2 resources: CapEx (capital) and Crew-Hours (labor). */
export class Economy {
  capEx: number = ECONOMY.startingCapEx;
  crewHours: number = ECONOMY.startingCrewHours;
  readonly crewHoursMax: number = ECONOMY.crewHoursMax;

  canAfford(capExCost: number, crewHoursCost: number): boolean {
    return this.capEx >= capExCost && this.crewHours >= crewHoursCost;
  }

  spend(capExCost: number, crewHoursCost: number): void {
    this.capEx -= capExCost;
    this.crewHours -= crewHoursCost;
  }

  /** `capExIncomeRate` is CapEx/sec, already summed across every energized span's own
   * rate (which varies by throughput tier — see `Span.incomeRate()`) — `Economy` stays
   * a dumb accumulator and doesn't need to know spans or tiers exist. */
  tick(dt: number, capExIncomeRate: number): void {
    this.capEx += capExIncomeRate * dt;
    this.crewHours = Math.min(this.crewHoursMax, this.crewHours + ECONOMY.crewHoursRegenPerSec * dt);
  }

  restore(capEx: number, crewHours: number): void {
    this.capEx = capEx;
    this.crewHours = Math.min(this.crewHoursMax, crewHours);
  }
}
