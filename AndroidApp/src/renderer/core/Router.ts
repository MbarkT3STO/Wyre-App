/**
 * Router.ts — Android version.
 * Fixed rapid-tap stacking: all pending exit elements are removed immediately
 * on each new navigation, and rapid taps are debounced so only the last
 * destination renders.
 */

import { StateManager } from './StateManager';

export type ViewFactory = () => HTMLElement;

export interface Route {
  path: string;
  factory: ViewFactory;
  title: string;
}

export class Router {
  private routes: Map<string, Route> = new Map();
  private outlet: HTMLElement | null = null;
  private currentPath = '';
  /** Pending removal timers — cancelled and flushed on every new navigation */
  private exitTimers: ReturnType<typeof setTimeout>[] = [];
  /** Debounce timer for rapid taps */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 80;

  register(route: Route): this {
    this.routes.set(route.path, route);
    return this;
  }

  mount(outlet: HTMLElement): void {
    this.outlet = outlet;
    window.addEventListener('hashchange', () => this.handleHashChange());
    this.handleHashChange();
  }

  navigate(path: string): void {
    window.location.hash = path;
  }

  private handleHashChange(): void {
    const hash = window.location.hash.slice(1) || '/home';

    // Debounce: if the user taps rapidly, only honour the last destination
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.render(hash);
    }, this.DEBOUNCE_MS);
  }

  private render(path: string): void {
    if (!this.outlet) return;
    if (path === this.currentPath) return;

    const route = this.routes.get(path) ?? this.routes.get('/home');
    if (!route) return;

    this.currentPath = path;
    StateManager.setState('currentRoute', path);

    // Cancel all pending exit timers and immediately remove every child that
    // is still in the outlet — prevents stacking from rapid navigation.
    for (const t of this.exitTimers) clearTimeout(t);
    this.exitTimers = [];
    while (this.outlet.firstChild) {
      this.outlet.removeChild(this.outlet.firstChild);
    }

    // Build and mount the new view
    const view = route.factory();
    view.classList.add('route-enter');
    this.outlet.appendChild(view);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        view.classList.remove('route-enter');
        view.classList.add('route-active');
      });
    });

    document.title = `Wyre — ${route.title}`;
  }
}
