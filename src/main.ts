import { defaultConfig } from './config/gameConfig';
import { GameManager } from './core/GameManager';
import { LoopDriver } from './core/LoopDriver';

const app = document.getElementById('app');
if (!app) throw new Error('#app not found');

const game = new GameManager(defaultConfig);
const driver = new LoopDriver(game);
game.start();
driver.start();

// Minimal readout. Cooking is a PLACEHOLDER timer until Phase 2.
function render(): void {
  const s = game.snapshot();
  app!.textContent =
    `PLACEHOLDER COOKING | state=${s.state} round=${s.roundId} roundsCompleted=${s.roundsCompleted}`;
}
render();
setInterval(render, 100);
