import { liveConfig } from './config/gameConfig';
import { Game } from './Game';
import { LoopDriver } from './core/LoopDriver';
import { ALL_DESSERTS } from './dessert/data';
import { DessertManager } from './dessert/DessertManager';

const app = document.getElementById('app');
if (!app) throw new Error('#app not found');

const unlocked = ALL_DESSERTS.filter((d) => 'default' in d.unlock).map((d) => d.id);
const game = new Game(liveConfig, new DessertManager(ALL_DESSERTS, unlocked));

// ?speed=N runs N updates per frame (test aid for smoke tests); capped to keep it safe.
const speed = Math.min(50, Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1));
const driver = new LoopDriver({
  update(dtMs: number): void {
    for (let i = 0; i < speed; i++) game.update(dtMs);
  },
});
game.start();
driver.start();

// Plain-text readout; the real HUD arrives in Phase 5.
function render(): void {
  const s = game.snapshot();
  app!.textContent =
    `ขนม: ${s.dessertNameTh ?? '-'} | ขั้นตอน: ${s.stepNameTh ?? '-'} | ความคืบหน้า: ${s.progress.toFixed(0)}% | ` +
    `ถัดไป: ${s.nextDessertNameTh} | state=${s.state} round=${s.roundId} done=${s.roundsCompleted}`;
}
render();
setInterval(render, 100);
