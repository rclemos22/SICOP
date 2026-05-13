import { Injectable, signal } from '@angular/core';

export interface LogEntry {
  timestamp: Date;
  type: 'info' | 'warn' | 'error' | 'api' | 'sync' | 'cache';
  message: string;
  data?: any;
}

@Injectable({ providedIn: 'root' })
export class DebugService {
  private _logs = signal<LogEntry[]>([]);
  private maxEntries = 200;

  readonly logs = this._logs.asReadonly();

  add(type: LogEntry['type'], message: string, data?: any) {
    this._logs.update(prev => {
      const next = [...prev, { timestamp: new Date(), type, message, data }];
      return next.length > this.maxEntries ? next.slice(-this.maxEntries) : next;
    });
  }

  info(msg: string, data?: any) { this.add('info', msg, data); }
  warn(msg: string, data?: any) { this.add('warn', msg, data); }
  error(msg: string, data?: any) { this.add('error', msg, data); }
  api(msg: string, data?: any) { this.add('api', msg, data); }
  sync(msg: string, data?: any) { this.add('sync', msg, data); }
  cache(msg: string, data?: any) { this.add('cache', msg, data); }

  clear() { this._logs.set([]); }
}
