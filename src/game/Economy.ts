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

  tick(dt: number, energizedSpanCount: number): void {
    this.capEx += energizedSpanCount * ECONOMY.capExIncomePerSpanPerSec * dt;
    this.crewHours = Math.min(this.crewHoursMax, this.crewHours + ECONOMY.crewHoursRegenPerSec * dt);
  }

  restore(capEx: number, crewHours: number): void {
    this.capEx = capEx;
    this.crewHours = Math.min(this.crewHoursMax, crewHours);
  }
}
