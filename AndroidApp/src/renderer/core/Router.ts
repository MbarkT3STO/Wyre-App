/**
 * Router.ts — identical to desktop version, fully portable.
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

    const route = this.routes.get(path) ?? this.routes.get('/home');
    if (!route) return;

    this.currentPath = path;
    StateManager.setState('currentRoute', path);

    const existing = this.outlet.firstElementChild as HTMLElement | null;
    if (existing) {
      existing.classList.add('route-exit');
      setTimeout(() => existing.remove(), 200);
    }

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
