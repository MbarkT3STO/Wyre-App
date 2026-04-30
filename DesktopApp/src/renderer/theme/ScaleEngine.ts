/**
 * ScaleEngine.ts
 * Applies the UI scale factor to the #app element via CSS zoom.
 *
 * Zooming #app instead of <html> keeps the viewport dimensions intact.
 * We compensate by setting the app height to (100vh / scale) so the
 * scaled content always fills the full window without clipping.
 */

import type { UiScale } from '../../shared/models/AppSettings';

export class ScaleEngine {
  apply(scale: UiScale): void {
    const app = document.getElementById('app');
    if (!app) return;

    const s = scale as number;

    // Scale the app container
    (app.style as CSSStyleDeclaration & { zoom: string }).zoom = String(s);

    // Compensate height: zoomed element shrinks visually, so expand it
    // so it still fills the full window height.
    app.style.height = `${(100 / s).toFixed(4)}vh`;
    app.style.width  = `${(100 / s).toFixed(4)}vw`;
  }
}
