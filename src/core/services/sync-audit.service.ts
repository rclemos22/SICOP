import { Injectable, signal, computed } from '@angular/core';

export interface SyncFailureItem {
  id: string;
  timestamp: string;
  ne?: string;
  ob?: string;
  pp?: string; // document_number / processo de pagamento / parcela
  contractId?: string;
  contractNumber?: string;
  stage: 'API_DOWNLOAD' | 'CACHE_SAVE' | 'TRANSACTION_INSERT' | 'TOTALS_CALC';
  errorType: 'DATABASE_ERROR' | 'API_ERROR' | 'VALIDATION_ERROR';
  errorMessage: string;
  details?: string;
}

const STORAGE_KEY = 'sigef_sync_audit_failures';
const MAX_FAILURES = 1000;

@Injectable({
  providedIn: 'root'
})
export class SyncAuditService {
  private _failures = signal<SyncFailureItem[]>([]);
  readonly failures = this._failures.asReadonly();

  readonly hasFailures = computed(() => this._failures().length > 0);
  readonly failureCount = computed(() => this._failures().length);

  constructor() {
    this._load();
  }

  addFailure(failure: Omit<SyncFailureItem, 'id' | 'timestamp'>): void {
    const item: SyncFailureItem = {
      ...failure,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString()
    };

    console.warn(`[SyncAuditService] Inconsistência registrada: [${item.stage}] NE:${item.ne || '-'} OB:${item.ob || '-'} PP:${item.pp || '-'} - ${item.errorMessage}`);

    this._failures.update(list => [item, ...list].slice(0, MAX_FAILURES));
    this._save();
  }

  clearFailures(): void {
    this._failures.set([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  exportCsv(): void {
    const items = this._failures();
    if (items.length === 0) return;

    const headers = ['Data/Hora', 'Estágio', 'Tipo Erro', 'Contrato', 'NE', 'OB', 'PP/Documento', 'Mensagem de Erro', 'Detalhes'];
    const rows = items.map(f => [
      new Date(f.timestamp).toLocaleString('pt-BR'),
      f.stage,
      f.errorType,
      f.contractNumber || f.contractId || '-',
      f.ne || '-',
      f.ob || '-',
      f.pp || '-',
      `"${(f.errorMessage || '').replace(/"/g, '""')}"`,
      `"${(f.details || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria_sincronizacao_sigef_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private _load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: SyncFailureItem[] = JSON.parse(raw);
        this._failures.set(parsed.slice(0, MAX_FAILURES));
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private _save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._failures()));
    } catch {
      // localStorage cheio — ignora silenciosamente
    }
  }
}
