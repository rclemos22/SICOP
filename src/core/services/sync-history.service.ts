import { Injectable, signal } from '@angular/core';

export interface SyncLogEntry {
  id: string;
  timestamp: string;
  type: 'start' | 'info' | 'success' | 'error';
  action: string;
  source: string;
  message: string;
  details?: string;
}

const STORAGE_KEY = 'sigef_sync_logs';
const MAX_ENTRIES = 1000;

@Injectable({ providedIn: 'root' })
export class SyncHistoryService {
  private _entries = signal<SyncLogEntry[]>([]);
  readonly entries = this._entries.asReadonly();

  constructor() {
    this._load();
  }

  addEntry(
    type: SyncLogEntry['type'],
    action: string,
    source: string,
    message: string,
    details?: string
  ): void {
    const entry: SyncLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      type,
      action,
      source,
      message,
      details,
    };
    this._entries.update(list => [entry, ...list].slice(0, MAX_ENTRIES));
    this._save();
  }

  clear(): void {
    this._entries.set([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  private _load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: SyncLogEntry[] = JSON.parse(raw);
        this._entries.set(parsed.slice(0, MAX_ENTRIES));
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private _save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._entries()));
    } catch {
      // localStorage cheio ou indisponível — ignora
    }
  }
}
