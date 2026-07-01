import guideMd from '../../GUIDE.md?raw';
import { renderMarkdown } from './markdown';

/** In-game player guide: a corner button toggling a scrollable overlay panel, rendered
 * from GUIDE.md at build time via a raw Vite import — the markdown file is the single
 * source of truth, so there's no separate in-game copy to drift out of sync with it. */
export class Guide {
  private readonly overlay: HTMLDivElement;
  private open = false;

  constructor(container: HTMLElement) {
    const button = document.createElement('button');
    button.className = 'guide-button';
    button.type = 'button';
    button.textContent = '?';
    button.setAttribute('aria-label', 'Open guide');
    button.addEventListener('click', () => this.toggle());
    container.appendChild(button);

    this.overlay = document.createElement('div');
    this.overlay.className = 'guide-overlay';
    this.overlay.innerHTML = `
      <div class="guide-panel">
        <button class="guide-close" type="button" aria-label="Close guide">&times;</button>
        <div class="guide-content">${renderMarkdown(guideMd)}</div>
      </div>
    `;
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.overlay.querySelector('.guide-close')!.addEventListener('click', () => this.close());
    container.appendChild(this.overlay);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.close();
    });
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openGuide();
  }

  private openGuide(): void {
    this.open = true;
    this.overlay.classList.add('guide-overlay--visible');
  }

  close(): void {
    this.open = false;
    this.overlay.classList.remove('guide-overlay--visible');
  }

  isOpen(): boolean {
    return this.open;
  }
}
