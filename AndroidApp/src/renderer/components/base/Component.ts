/**
 * Component.ts — identical to desktop version, fully portable.
 */

export abstract class Component {
  protected container: HTMLElement | null = null;
  protected element: HTMLElement | null = null;
  private cleanupFns: Array<() => void> = [];

  mount(container: HTMLElement): void {
    this.container = container;
    this.element = this.render();
    container.appendChild(this.element);
    this.onMount();
  }

  unmount(): void {
    this.onUnmount();
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
    this.element?.remove();
    this.element = null;
    this.container = null;
  }

  protected update(): void {
    if (!this.container || !this.element) return;
    const newElement = this.render();
    this.container.replaceChild(newElement, this.element);
    this.element = newElement;
  }

  protected addCleanup(fn: () => void): void {
    this.cleanupFns.push(fn);
  }

  protected listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Window | Document,
    event: K,
    handler: (e: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(event as string, handler as EventListener, options);
    this.addCleanup(() => target.removeEventListener(event as string, handler as EventListener, options));
  }

  protected el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    attrs?: Record<string, string>,
  ): HTMLElementTagNameMap[K] {
    const elem = document.createElement(tag);
    if (className) elem.className = className;
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) elem.setAttribute(k, v);
    }
    return elem;
  }

  protected onMount(): void {}
  protected onUnmount(): void {}
  abstract render(): HTMLElement;
}
