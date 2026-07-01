export interface HudState {
  capEx: number;
  crewHours: number;
  crewHoursMax: number;
  context: string;
  faultCount: number;
  repairCapEx: number;
  repairCrewHours: number;
  hint: string;
}

/** Minimal SCADA-style corner readout — a status meter, not a menu. */
export class Hud {
  private readonly capExEl: HTMLElement;
  private readonly crewEl: HTMLElement;
  private readonly contextEl: HTMLElement;
  private readonly faultEl: HTMLElement;
  private readonly hintEl: HTMLElement;

  constructor(container: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'hud';
    root.innerHTML = `
      <div class="hud-panel">
        <div class="hud-row"><span class="hud-label">CAPEX</span><span class="hud-value" data-capex></span></div>
        <div class="hud-row"><span class="hud-label">CREW-HRS</span><span class="hud-value" data-crew></span></div>
      </div>
      <div class="hud-note hud-note--fault" data-fault></div>
      <div class="hud-note hud-note--context" data-context></div>
      <div class="hud-note hud-note--hint" data-hint></div>
    `;
    container.appendChild(root);

    this.capExEl = root.querySelector('[data-capex]')!;
    this.crewEl = root.querySelector('[data-crew]')!;
    this.contextEl = root.querySelector('[data-context]')!;
    this.faultEl = root.querySelector('[data-fault]')!;
    this.hintEl = root.querySelector('[data-hint]')!;
  }

  update(state: HudState): void {
    this.capExEl.textContent = `$${Math.floor(state.capEx).toLocaleString()}`;
    this.crewEl.textContent = `${Math.floor(state.crewHours)} / ${state.crewHoursMax}`;
    this.contextEl.textContent = state.context;
    this.faultEl.textContent =
      state.faultCount > 0
        ? `⚠ ${state.faultCount} FAULT${state.faultCount > 1 ? 'S' : ''} — click a red line to repair ($${state.repairCapEx} / ${state.repairCrewHours}h)`
        : '';
    this.hintEl.textContent = state.hint;
  }
}
