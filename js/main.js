// ============================================================================
// Fruit Hockey — bootstrap
// ============================================================================
import { store } from './storage.js';
import { ui } from './ui.js';

store.load();

function boot() {
  ui.init();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => { /* offline cache optional */ });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
