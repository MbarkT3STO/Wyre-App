/**
 * Router.ts
 * Lightweight hash-based SPA router.
 * Maps routes to view factory functions and manages transitions.
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
  private currentPath: string | null = null;
  private beforeEachHook: ((to: string, from: string | null) => boolean) | null = null;

  beforeEach(hook: (to: string, from: string | null) => boolean): this {
    this.beforeEachHook = hook;
    return this;
  }

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
    this.render(hash);
  }

  private render(path: string): void {
    if (!this.outlet) return;
    if (path === this.currentPath) return;

    if (this.beforeEachHook && !this.beforeEachHook(path, this.currentPath)) {
      return; // navigation cancelled
    }

    const route = this.routes.get(path) ?? this.routes.get('/home');
    if (!route) return;

    this.currentPath = path;
    StateManager.setState('currentRoute', path);

    // Animate out
    const existing = this.outlet.firstElementChild as HTMLElement | null;
    if (existing) {
      existing.classList.add('route-exit');
      setTimeout(() => existing.remove(), 200);
    }

    // Create new view
    const view = route.factory();
    view.classList.add('route-enter');
    this.outlet.appendChild(view);

    // Trigger enter animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        view.classList.remove('route-enter');
        view.classList.add('route-active');
      });
    });

    document.title = `Wyre — ${route.title}`;
  }
}

/** Module-level singleton — allows views to access the router without prop-drilling. */
export const appRouter = new Router();
