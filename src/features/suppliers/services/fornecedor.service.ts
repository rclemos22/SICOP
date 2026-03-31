import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { Result, ok, fail } from '../../../shared/models/result.model';

export interface Fornecedor {
  id: string; // UUID
  razao_social: string;
  cnpj_cpf?: string;
}

@Injectable({
  providedIn: 'root'
})
export class FornecedorService {
  private supabaseService = inject(SupabaseService);
  private errorHandler = inject(ErrorHandlerService);

  private _fornecedores = signal<Fornecedor[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);

  readonly fornecedores = this._fornecedores.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor() {
    this.loadFornecedores();
  }

  async loadFornecedores(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const { data, error } = await this.supabaseService.client
        .from('fornecedores')
        .select('*')
        .order('razao_social');

      if (error) throw error;
      
      this._fornecedores.set(data || []);
    } catch (err: any) {
      this.errorHandler.handle(err, 'FornecedorService.loadFornecedores');
      this._error.set(err.message || 'Erro ao carregar fornecedores');
      this._fornecedores.set([]);
    } finally {
      this._loading.set(false);
    }
  }
}
