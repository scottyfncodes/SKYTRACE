import './ui/styles.css';
import { RescueGame } from './game/RescueGame';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');

function boot(): void {
  try {
    new RescueGame(root!);
  } catch (err) {
    const loading = document.getElementById('loading');
    if (loading) loading.textContent = `SKYTRACE could not start: ${(err as Error).message}`;
    console.error(err);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
