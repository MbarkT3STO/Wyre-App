/**
 * Component.ts
 * Abstract base class for all UI components.
 * Provides a minimal lifecycle: mount, unmount, render, update.
 * Components manage their own DOM subtree and clean up listeners on unmount.
 */

export abstract class Component {
  protected container: HTMLElement | null = null;
  protected element: HTMLElement | null = null;
  private cleanupFns: Array<() => void> = [];

  /** Mount this component into a container element */
  mount(container: HTMLElement): void {
    this.container = container;
    this.element = this.render();
    container.appendChild(this.element);
    this.onMount();
  }

  /** Remove this component from the DOM and clean up */
  unmount(): void {
    this.onUnmount();
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
    this.element?.remove();
    this.element = null;
    this.container = null;
  }

  /** Replace the current element with a fresh render */
  protected update(): void {
    if (!this.container || !this.element) return;
    this.onUnmount();
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
    const newElement = this.render();
    this.container.replaceChild(newElement, this.element);
    this.element = newElement;
    this.onMount();
  }

  /** Register a cleanup function to run on unmount */
  protected addCleanup(fn: () => void): void {
    this.cleanupFns.push(fn);
  }

  /** Register an event listener that auto-cleans up on unmount */
  protected listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Window | Document,
    event: K,
    handler: (e: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(event as string, handler as EventListener, options);
    this.addCleanup(() => target.removeEventListener(event as string, handler as EventListener, options));
  }

  /** Create an element with optional class and attributes */
  protected el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    attrs?: Record<string, string>,
  ): HTMLElementTagNameMap[K] {
    const elem = document.createElement(tag);
    if (className) elem.className = className;
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        elem.setAttribute(k, v);
      }
    }
    return elem;
  }

  /** Called after element is mounted to the DOM */
  protected onMount(): void {}

  /** Called before element is removed from the DOM */
  protected onUnmount(): void {}

  /** Must return the root HTMLElement for this component */
  abstract render(): HTMLElement;
}
