/**
 * FileDropZone.ts
 * Drag-and-drop + file picker area for selecting files to send.
 */

import { Component } from './base/Component';
import { StateManager } from '../core/StateManager';
import { formatFileSize } from '../../shared/utils/formatters';

export interface FileDropZoneOptions {
  onFileSelected: (filePath: string, fileName: string, fileSize: number) => void;
}

export class FileDropZone extends Component {
  private options: FileDropZoneOptions;
  private selectedFile: { path: string; name: string; size: number } | null = null;
  private dropZoneEl: HTMLElement | null = null;

  constructor(options: FileDropZoneOptions) {
    super();
    this.options = options;
  }

  render(): HTMLElement {
    const hasDevice = StateManager.get('selectedDeviceId') !== null;
    const wrapper = this.el('div', 'file-drop-zone-wrapper');

    this.dropZoneEl = this.el('div', `file-drop-zone${!hasDevice ? ' file-drop-zone--disabled' : ''}${this.selectedFile ? ' file-drop-zone--has-file' : ''}`);
    this.dropZoneEl.setAttribute('role', 'button');
    this.dropZoneEl.setAttribute('tabindex', hasDevice ? '0' : '-1');
    this.dropZoneEl.setAttribute('aria-label', hasDevice ? 'Drop files here or click to browse' : 'Select a device first');

    if (!hasDevice) {
      this.dropZoneEl.setAttribute('title', 'Select a device first');
    }

    if (this.selectedFile) {
      this.dropZoneEl.innerHTML = `
        <div class="file-drop-zone__file-info">
          <svg class="file-drop-zone__file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <div class="file-drop-zone__file-details">
            <span class="file-drop-zone__file-name" title="${escapeHtml(this.selectedFile.name)}">${escapeHtml(this.selectedFile.name)}</span>
            <span class="file-drop-zone__file-size">${formatFileSize(this.selectedFile.size)}</span>
          </div>
          <button class="file-drop-zone__clear" aria-label="Remove file" type="button">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/></svg>
          </button>
        </div>
      `;
    } else {
      this.dropZoneEl.innerHTML = `
        <svg class="file-drop-zone__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 5.75 5.75 0 011.344 11.095H6.75z"/>
        </svg>
        <p class="file-drop-zone__label">Drop files here or <span class="file-drop-zone__browse">click to browse</span></p>
        <span class="file-drop-zone__hint">${hasDevice ? 'Any file type supported' : 'Select a device first'}</span>
      `;
    }

    wrapper.appendChild(this.dropZoneEl);
    return wrapper;
  }

  protected onMount(): void {
    this.attachEvents();

    const unsub = StateManager.subscribe('selectedDeviceId', () => {
      super.update();
      this.attachEvents();
    });
    this.addCleanup(unsub);
  }

  private attachEvents(): void {
    if (!this.dropZoneEl) return;
    const hasDevice = StateManager.get('selectedDeviceId') !== null;
    if (!hasDevice) return;

    // Click to browse
    this.dropZoneEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.file-drop-zone__clear')) return;
      this.openFilePicker();
    });

    // Clear button
    const clearBtn = this.dropZoneEl.querySelector('.file-drop-zone__clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearFile();
      });
    }

    // Drag events
    this.dropZoneEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZoneEl?.classList.add('file-drop-zone--drag-over');
    });

    this.dropZoneEl.addEventListener('dragleave', () => {
      this.dropZoneEl?.classList.remove('file-drop-zone--drag-over');
    });

    this.dropZoneEl.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZoneEl?.classList.remove('file-drop-zone--drag-over');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        // In Electron, File objects have a path property
        const filePath = (file as File & { path?: string }).path ?? file.name;
        this.setFile(filePath, file.name, file.size);
      }
    });

    // Keyboard
    this.dropZoneEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openFilePicker();
      }
    });
  }

  private openFilePicker(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        const filePath = (file as File & { path?: string }).path ?? file.name;
        this.setFile(filePath, file.name, file.size);
      }
    };
    input.click();
  }

  private setFile(path: string, name: string, size: number): void {
    this.selectedFile = { path, name, size };
    super.update();
    this.attachEvents();
    this.options.onFileSelected(path, name, size);
  }

  private clearFile(): void {
    this.selectedFile = null;
    super.update();
    this.attachEvents();
  }

  getSelectedFile(): { path: string; name: string; size: number } | null {
    return this.selectedFile;
  }

  clearSelection(): void {
    this.clearFile();
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
