/**
 * FileDropZone.ts
 * Drag-and-drop + file/folder picker area for selecting items to send.
 * Supports multiple files, folders, and multi-device selection.
 *
 * Design rule: NEVER call super.update() from a StateManager subscriber.
 * State changes only patch the DOM in-place (enabled/disabled class).
 * super.update() is only called when the file list itself changes.
 */

import { Component } from './base/Component';
import { StateManager } from '../core/StateManager';
import { IpcClient } from '../core/IpcClient';
import { formatFileSize } from '../../shared/utils/formatters';

export interface SelectedFile {
  path: string;
  name: string;
  size: number;
  type?: 'file' | 'folder';
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
    const hasDevice = StateManager.get('selectedDeviceIds').length > 0;
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
      hasDevice ? 'Drop files or folders here or click to browse' : 'Select a device first',
    );

    if (!hasDevice) {
      this.dropZoneEl.setAttribute('title', 'Select a device first');
    }

    if (hasFiles) {
      const listItems = this.selectedFiles.map((f, idx) => {
        const isFolder = f.type === 'folder';
        const icon = isFolder
          ? `<i class="fa-solid fa-folder file-drop-zone__file-icon file-drop-zone__file-icon--folder"></i>`
          : `<i class="fa-solid fa-file-lines file-drop-zone__file-icon"></i>`;
        return `
          <div class="file-drop-zone__file-item" data-idx="${idx}">
            ${icon}
            <div class="file-drop-zone__file-details">
              <span class="file-drop-zone__file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
              <span class="file-drop-zone__file-size">${isFolder ? 'Folder' : formatFileSize(f.size)}</span>
            </div>
            <button class="file-drop-zone__clear" aria-label="Remove ${escapeHtml(f.name)}" type="button" data-remove="${idx}">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        `;
      }).join('');

      this.dropZoneEl.innerHTML = `
        <div class="file-drop-zone__file-list">${listItems}</div>
        <button class="file-drop-zone__add-more" type="button" aria-label="Add more files">
          <i class="fa-solid fa-plus"></i>
          <span>Add more files</span>
        </button>
      `;
    } else {
      this.dropZoneEl.innerHTML = `
        <i class="fa-solid fa-cloud-arrow-up file-drop-zone__icon"></i>
        <p class="file-drop-zone__label">Drop files or folders here or <span class="file-drop-zone__browse">click to browse</span></p>
        <span class="file-drop-zone__hint">${hasDevice ? 'Any file type · folders · multiple files allowed' : 'Select a device first'}</span>
        ${hasDevice ? `<button class="file-drop-zone__browse-folder btn btn--ghost btn--sm" type="button" aria-label="Browse for a folder">
          <i class="fa-solid fa-folder-open btn__icon"></i>
          Browse folder
        </button>` : ''}
      `;
    }

    wrapper.appendChild(this.dropZoneEl);
    return wrapper;
  }

  protected onMount(): void {
    // Attach all interaction events once, on the stable dropZoneEl reference.
    this.attachDropZoneEvents();

    // When device selection changes, just toggle the disabled state in-place.
    // Never call super.update() from this subscriber — that causes infinite loops
    // because update() → onMount() → new subscriber → update() → ...
    const unsub = StateManager.subscribe('selectedDeviceIds', () => {
      this.applyDeviceState();
    });
    this.addCleanup(unsub);
  }

  /** Toggle enabled/disabled appearance without re-rendering */
  private applyDeviceState(): void {
    if (!this.dropZoneEl) return;
    const hasDevice = StateManager.get('selectedDeviceIds').length > 0;
    this.dropZoneEl.classList.toggle('file-drop-zone--disabled', !hasDevice);
    this.dropZoneEl.setAttribute('tabindex', hasDevice ? '0' : '-1');

    // Update hint text
    const hint = this.dropZoneEl.querySelector('.file-drop-zone__hint');
    if (hint) {
      hint.textContent = hasDevice
        ? 'Any file type · folders · multiple files allowed'
        : 'Select a device first';
    }

    // Show/hide the browse-folder button
    const existingBtn = this.dropZoneEl.querySelector('.file-drop-zone__browse-folder');
    if (hasDevice && !existingBtn && this.selectedFiles.length === 0) {
      const btn = document.createElement('button');
      btn.className = 'file-drop-zone__browse-folder btn btn--ghost btn--sm';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Browse for a folder');
      btn.innerHTML = `<i class="fa-solid fa-folder-open btn__icon"></i> Browse folder`;
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.openFolderPicker(); });
      this.dropZoneEl.appendChild(btn);
    } else if (!hasDevice && existingBtn) {
      existingBtn.remove();
    }
  }

  /** Attach all event listeners to dropZoneEl exactly once after mount/re-render */
  private attachDropZoneEvents(): void {
    if (!this.dropZoneEl) return;

    // Click to browse — delegate so we don't need to re-attach after file list changes
    this.dropZoneEl.addEventListener('click', (e) => {
      if (!StateManager.get('selectedDeviceIds').length) return;
      const target = e.target as HTMLElement;

      // Remove button
      const removeBtn = target.closest('[data-remove]') as HTMLElement | null;
      if (removeBtn) {
        e.stopPropagation();
        const idx = parseInt(removeBtn.dataset['remove'] ?? '0', 10);
        this.removeFile(idx);
        return;
      }

      // Add-more button
      if (target.closest('.file-drop-zone__add-more')) {
        e.stopPropagation();
        this.openFilePicker();
        return;
      }

      // Browse-folder button
      if (target.closest('.file-drop-zone__browse-folder')) {
        e.stopPropagation();
        this.openFolderPicker();
        return;
      }

      // Anywhere else on the zone — open file picker
      this.openFilePicker();
    });

    // Drag events
    this.dropZoneEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (StateManager.get('selectedDeviceIds').length) {
        this.dropZoneEl?.classList.add('file-drop-zone--drag-over');
      }
    });

    this.dropZoneEl.addEventListener('dragleave', () => {
      this.dropZoneEl?.classList.remove('file-drop-zone--drag-over');
    });

    this.dropZoneEl.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZoneEl?.classList.remove('file-drop-zone--drag-over');
      if (StateManager.get('selectedDeviceIds').length) {
        this.handleDrop(e);
      }
    });

    // Keyboard
    this.dropZoneEl.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && StateManager.get('selectedDeviceIds').length) {
        e.preventDefault();
        this.openFilePicker();
      }
    });
  }

  private handleDrop(e: DragEvent): void {
    const items = e.dataTransfer?.items;
    const newFiles: SelectedFile[] = [];

    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        const entry = item.webkitGetAsEntry?.();
        const file = item.getAsFile();
        if (!file) continue;
        const filePath = (file as File & { path?: string }).path ?? file.name;
        if (entry?.isDirectory) {
          newFiles.push({ path: filePath, name: file.name, size: 0, type: 'folder' });
        } else {
          newFiles.push({ path: filePath, name: file.name, size: file.size, type: 'file' });
        }
      }
    } else if (e.dataTransfer?.files) {
      const files = e.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file) {
          const filePath = (file as File & { path?: string }).path ?? file.name;
          newFiles.push({ path: filePath, name: file.name, size: file.size, type: 'file' });
        }
      }
    }

    if (newFiles.length > 0) this.addFiles(newFiles);
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
          newFiles.push({ path: filePath, name: file.name, size: file.size, type: 'file' });
        }
      }
      if (newFiles.length > 0) this.addFiles(newFiles);
    };
    input.click();
  }

  private openFolderPicker(): void {
    IpcClient.openDirectory().then((folderPath) => {
      if (!folderPath) return;
      const parts = folderPath.replace(/\\/g, '/').split('/');
      const folderName = parts[parts.length - 1] ?? folderPath;
      this.addFiles([{ path: folderPath, name: folderName, size: 0, type: 'folder' }]);
    }).catch(() => { /* cancelled */ });
  }

  private addFiles(files: SelectedFile[]): void {
    const existingPaths = new Set(this.selectedFiles.map(f => f.path));
    const unique = files.filter(f => !existingPaths.has(f.path));
    if (unique.length === 0) return;
    this.selectedFiles = [...this.selectedFiles, ...unique];
    // Re-render the file list only — this is triggered by user file selection, not state changes
    super.update();
    this.options.onFilesSelected([...this.selectedFiles]);
  }

  private removeFile(idx: number): void {
    this.selectedFiles = this.selectedFiles.filter((_, i) => i !== idx);
    super.update();
    this.options.onFilesSelected([...this.selectedFiles]);
  }

  getFiles(): SelectedFile[] {
    return [...this.selectedFiles];
  }

  getSelectedFile(): SelectedFile | null {
    return this.selectedFiles[0] ?? null;
  }

  clearSelection(): void {
    if (this.selectedFiles.length === 0) return;
    this.selectedFiles = [];
    super.update();
    this.options.onFilesSelected([]);
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
