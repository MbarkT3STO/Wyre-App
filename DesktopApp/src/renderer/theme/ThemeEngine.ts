/**
 * ThemeEngine.ts
 * Applies dark/light mode based on settings and system preference.
 * Persists preference and responds to system changes.
 */

import type { ThemePreference } from '../../shared/models/AppSettings';

export class ThemeEngine {
  private current: ThemePreference = 'system';
  private mediaQuery: MediaQueryList;

  constructor() {
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  }

  apply(preference: ThemePreference): void {
    this.current = preference;

    if (preference === 'system') {
      this.applyResolved(this.mediaQuery.matches ? 'dark' : 'light');
      this.mediaQuery.addEventListener('change', this.handleSystemChange);
    } else {
      this.mediaQuery.removeEventListener('change', this.handleSystemChange);
      this.applyResolved(preference);
    }
  }

  private handleSystemChange = (e: MediaQueryListEvent): void => {
    if (this.current === 'system') {
      this.applyResolved(e.matches ? 'dark' : 'light');
    }
  };

  private applyResolved(theme: 'dark' | 'light'): void {
    document.documentElement.setAttribute('data-theme', theme);
  }

  getResolved(): 'dark' | 'light' {
    if (this.current === 'system') {
      return this.mediaQuery.matches ? 'dark' : 'light';
    }
    return this.current;
  }

  destroy(): void {
    this.mediaQuery.removeEventListener('change', this.handleSystemChange);
  }
}
