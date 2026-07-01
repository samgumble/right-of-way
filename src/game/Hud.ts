export interface HudState {
  capEx: number;
  crewHours: number;
  crewHoursMax: number;
  context: string;
  faultCount: number;
  repairCapEx: number;
  repairCrewHours: number;
  hint: string;
  stormWarning: boolean;
  blackoutCount: number;
  objectiveStatus: string;
  completedObjectives: number;
  capacityWarningCount: number;
}

/** Minimal SCADA-style corner readout — a status meter, not a menu. */
export class Hud {
  private readonly capExEl: HTMLElement;
  private readonly crewEl: HTMLElement;
  private readonly milestonesEl: HTMLElement;
  private readonly contextEl: HTMLElement;
  private readonly objectiveEl: HTMLElement;
  private readonly faultEl: HTMLElement;
  private readonly blackoutEl: HTMLElement;
  private readonly warningEl: HTMLElement;
  private readonly capacityWarningEl: HTMLElement;
  private readonly hintEl: HTMLElement;

  constructor(container: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'hud';
    root.innerHTML = `
      <div class="hud-panel">
        <div class="hud-row"><span class="hud-label">CAPEX</span><span class="hud-value" data-capex></span></div>
        <div class="hud-row"><span class="hud-label">CREW-HRS</span><span class="hud-value" data-crew></span></div>
        <div class="hud-row"><span class="hud-label">MILESTONES</span><span class="hud-value" data-milestones></span></div>
      </div>
      <div class="hud-note hud-note--objective" data-objective></div>
      <div class="hud-note hud-note--fault" data-blackout></div>
      <div class="hud-note hud-note--fault" data-fault></div>
      <div class="hud-note hud-note--warning" data-warning></div>
      <div class="hud-note hud-note--warning" data-capacity-warning></div>
      <div class="hud-note hud-note--context" data-context></div>
      <div class="hud-note hud-note--hint" data-hint></div>
    `;
    container.appendChild(root);

    this.capExEl = root.querySelector('[data-capex]')!;
    this.crewEl = root.querySelector('[data-crew]')!;
    this.milestonesEl = root.querySelector('[data-milestones]')!;
    this.contextEl = root.querySelector('[data-context]')!;
    this.objectiveEl = root.querySelector('[data-objective]')!;
    this.faultEl = root.querySelector('[data-fault]')!;
    this.blackoutEl = root.querySelector('[data-blackout]')!;
    this.warningEl = root.querySelector('[data-warning]')!;
    this.capacityWarningEl = root.querySelector('[data-capacity-warning]')!;
    this.hintEl = root.querySelector('[data-hint]')!;
  }

  update(state: HudState): void {
    this.capExEl.textContent = `$${Math.floor(state.capEx).toLocaleString()}`;
    this.crewEl.textContent = `${Math.floor(state.crewHours)} / ${state.crewHoursMax}`;
    this.milestonesEl.textContent = `${state.completedObjectives}`;
    this.contextEl.textContent = state.context;
    this.objectiveEl.textContent = state.objectiveStatus;
    this.blackoutEl.textContent =
      state.blackoutCount > 0
        ? `⚠ ${state.blackoutCount} NEIGHBORHOOD${state.blackoutCount > 1 ? 'S' : ''} BLACKED OUT — restore its last path to recover`
        : '';
    this.faultEl.textContent =
      state.faultCount > 0
        ? `⚠ ${state.faultCount} FAULT${state.faultCount > 1 ? 'S' : ''} — click a red line to repair ($${state.repairCapEx} / ${state.repairCrewHours}h)`
        : '';
    this.warningEl.textContent = state.stormWarning ? 'STORM ROLLING IN' : '';
    this.capacityWarningEl.textContent =
      state.capacityWarningCount > 0
        ? `NEIGHBORHOOD${state.capacityWarningCount > 1 ? 'S' : ''} APPROACHING CAPACITY`
        : '';
    this.hintEl.textContent = state.hint;
  }
}
