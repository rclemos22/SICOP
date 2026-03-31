import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { Result, ok, fail } from '../../../shared/models/result.model';

export interface Setor {
  id: string; // UUID
  nome: string;
  sigla?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SetorService {
  private supabaseService = inject(SupabaseService);
  private errorHandler = inject(ErrorHandlerService);

  private _setores = signal<Setor[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);

  readonly setores = this._setores.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor() {
    this.loadSetores();
  }

  async loadSetores(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const { data, error } = await this.supabaseService.client
        .from('setores')
        .select('*')
        .order('nome');

      if (error) throw error;
      
      this._setores.set(data || []);
    } catch (err: any) {
      this.errorHandler.handle(err, 'SetorService.loadSetores');
      this._error.set(err.message || 'Erro ao carregar setores');
      this._setores.set([]);
    } finally {
      this._loading.set(false);
    }
  }
}
