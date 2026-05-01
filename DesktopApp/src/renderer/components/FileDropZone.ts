/**
 * FileDropZone.ts
 * Drag-and-drop + file picker area for selecting files to send.
 * Supports multiple file selection (Feature 1).
 */

import { Component } from './base/Component';
import { StateManager } from '../core/StateManager';
import { formatFileSize } from '../../shared/utils/formatters';

export interface SelectedFile {
  path: string;
  name: string;
  size: number;
}

export interface FileDropZoneOptions {
  onFilesSelected: (files: SelectedFile[]) => void;
}

export class FileDropZone extends Component {
  private options: FileDropZoneOptions;
  private selectedFiles: SelectedFile[] = [];
  private dropZoneEl: HTMLElement | null = null;

  constructor(options: FileDropZoneOptions) {
    super();
    this.options = options;
  }

  render(): HTMLElement {
    const hasDevice = StateManager.get('selectedDeviceId') !== null;
    const wrapper = this.el('div', 'file-drop-zone-wrapper');

    const hasFiles = this.selectedFiles.length > 0;
    const zoneClass = [
      'file-drop-zone',
      !hasDevice ? 'file-drop-zone--disabled' : '',
      hasFiles ? 'file-drop-zone--has-file' : '',
    ].filter(Boolean).join(' ');

    this.dropZoneEl = this.el('div', zoneClass);
    this.dropZoneEl.setAttribute('role', 'button');
    this.dropZoneEl.setAttribute('tabindex', hasDevice ? '0' : '-1');
    this.dropZoneEl.setAttribute(
      'aria-label',
      hasDevice ? 'Drop files here or click to browse' : 'Select a device first',
    );

    if (!hasDevice) {
      this.dropZoneEl.setAttribute('title', 'Select a device first');
    }

    if (hasFiles) {
      const listItems = this.selectedFiles.map((f, idx) => `
        <div class="file-drop-zone__file-item" data-idx="${idx}">
          <i class="fa-solid fa-file-lines file-drop-zone__file-icon"></i>
          <div class="file-drop-zone__file-details">
            <span class="file-drop-zone__file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
            <span class="file-drop-zone__file-size">${formatFileSize(f.size)}</span>
          </div>
          <button class="file-drop-zone__clear" aria-label="Remove ${escapeHtml(f.name)}" type="button" data-remove="${idx}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `).join('');

      this.dropZoneEl.innerHTML = `
        <div class="file-drop-zone__file-list">
          ${listItems}
        </div>
        <button class="file-drop-zone__add-more" type="button" aria-label="Add more files">
          <i class="fa-solid fa-plus"></i>
          <span>Add more files</span>
        </button>
      `;
    } else {
      this.dropZoneEl.innerHTML = `
        <i class="fa-solid fa-cloud-arrow-up file-drop-zone__icon"></i>
        <p class="file-drop-zone__label">Drop files here or <span class="file-drop-zone__browse">click to browse</span></p>
        <span class="file-drop-zone__hint">${hasDevice ? 'Any file type supported · multiple files allowed' : 'Select a device first'}</span>
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

    // Click to browse (but not on remove buttons or add-more)
    this.dropZoneEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-remove]') || target.closest('.file-drop-zone__add-more')) return;
      this.openFilePicker();
    });

    // "Add more files" button
    const addMoreBtn = this.dropZoneEl.querySelector('.file-drop-zone__add-more');
    if (addMoreBtn) {
      addMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openFilePicker();
      });
    }

    // Remove buttons
    this.dropZoneEl.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset['remove'] ?? '0', 10);
        this.removeFile(idx);
      });
    });

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
        const newFiles: SelectedFile[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file) {
            const filePath = (file as File & { path?: string }).path ?? file.name;
            newFiles.push({ path: filePath, name: file.name, size: file.size });
          }
        }
        this.addFiles(newFiles);
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
    input.multiple = true;
    input.onchange = () => {
      if (!input.files) return;
      const newFiles: SelectedFile[] = [];
      for (let i = 0; i < input.files.length; i++) {
        const file = input.files[i];
        if (file) {
          const filePath = (file as File & { path?: string }).path ?? file.name;
          newFiles.push({ path: filePath, name: file.name, size: file.size });
        }
      }
      if (newFiles.length > 0) this.addFiles(newFiles);
    };
    input.click();
  }

  private addFiles(files: SelectedFile[]): void {
    // Deduplicate by path
    const existingPaths = new Set(this.selectedFiles.map(f => f.path));
    const unique = files.filter(f => !existingPaths.has(f.path));
    this.selectedFiles = [...this.selectedFiles, ...unique];
    super.update();
    this.attachEvents();
    this.options.onFilesSelected([...this.selectedFiles]);
  }

  private removeFile(idx: number): void {
    this.selectedFiles = this.selectedFiles.filter((_, i) => i !== idx);
    super.update();
    this.attachEvents();
    this.options.onFilesSelected([...this.selectedFiles]);
  }

  /** Returns all currently selected files */
  getFiles(): SelectedFile[] {
    return [...this.selectedFiles];
  }

  /** Legacy single-file accessor for backward compatibility */
  getSelectedFile(): SelectedFile | null {
    return this.selectedFiles[0] ?? null;
  }

  clearSelection(): void {
    this.selectedFiles = [];
    super.update();
    this.attachEvents();
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
