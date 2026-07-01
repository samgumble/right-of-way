import './style.css';
import { Game } from './game/Game';

const app = document.querySelector<HTMLDivElement>('#app')!;
const game = new Game(app);
if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
