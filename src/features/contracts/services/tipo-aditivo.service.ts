import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { Result, ok, fail } from '../../../shared/models/result.model';

export interface TipoAditivoModel {
  id: string; // UUID
  nome: string;
  descricao?: string;
}

@Injectable({
  providedIn: 'root'
})
export class TipoAditivoService {
  private supabaseService = inject(SupabaseService);
  private errorHandler = inject(ErrorHandlerService);

  private _tipos = signal<TipoAditivoModel[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);

  readonly tipos = this._tipos.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor() {
    this.loadTipos();
  }

  async loadTipos(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const { data, error } = await this.supabaseService.client
        .from('tipo_aditivo')
        .select('*')
        .order('nome');

      if (error) throw error;
      
      this._tipos.set(data || []);
    } catch (err: any) {
      this.errorHandler.handle(err, 'TipoAditivoService.loadTipos');
      this._error.set(err.message || 'Erro ao carregar tipos de aditivo');
      this._tipos.set([]);
    } finally {
      this._loading.set(false);
    }
  }
}
