import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';

export interface NotaEmpenho {
  ano: number;
  cdunidadegestora: string;
  cdgestao: string;
  nunotaempenho: string;
  nuneoriginal: string;
  cdcredor: string;
  dtlancamento: string;
  tipo: string;
  cdsubacao: string;
  cdunidadeorcamentaria: string;
  cdnaturezadespesa: string;
  cdfuncao: string;
  cdsubfuncao: string;
  cdprograma: number;
  cdacao: number;
  cdfonte: string;
  cdevento: number;
  cdmodalidadelicitacao: string;
  cdmodalidadeempenho: string;
  demodalidadeempenho: string;
  nuprocesso: string;
  vlnotaempenho: number;
  nuquantidade: number;
  dehistorico: string;
}

export interface NotaEmpenhoItem {
  cdunidadegestora: number;
  cdgestao: number;
  nuempenho: string;
  nusequencialitem: number;
  dscategoriainicial: string;
  nusequencialrecurso: number;
  cdunidadesubcredenciadora: number;
  cdunidadesubitem: number;
  dsunidadesubitem: string;
  qtitem: number;
  vlsaldoitem: number;
  vlunitario: number;
  vlglobal: number;
  cdsituacaoitem: number;
  dssituacaoitem: string;
}

@Injectable({
  providedIn: 'root'
})
export class SigefService {
  private apiUrl = environment.sigefApiUrl;
  private _loading = signal(false);
  private _error = signal<string | null>(null);
  private _authenticated = signal(false);

  public loading = this._loading.asReadonly();
  public error = this._error.asReadonly();
  public authenticated = this._authenticated.asReadonly();

  private bearerToken: string | null = null;

  constructor() {
    this.autoAuthenticate();
  }

  private async autoAuthenticate(): Promise<void> {
    try {
      await this.authenticate(environment.sigefUsername, environment.sigefPassword);
    } catch (err) {
      console.error('Falha na autenticação automática com SIGEF:', err);
    }
  }

  setToken(token: string): void {
    this.bearerToken = token;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (this.bearerToken) {
      headers['Authorization'] = `Bearer ${this.bearerToken}`;
    }
    return headers;
  }

  async ensureAuthenticated(): Promise<void> {
    if (!this.bearerToken) {
      await this.autoAuthenticate();
    }
  }

  async getNotaEmpenho(ano: string): Promise<NotaEmpenho[]> {
    this._loading.set(true);
    this._error.set(null);

    try {
      await this.ensureAuthenticated();

      const url = `${this.apiUrl}/sigef/notaempenho/?ano=${ano}`;
      console.log('[SIGEF DEBUG] GET:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      console.log('[SIGEF DEBUG] Status:', response.status);
      console.log('[SIGEF DEBUG] StatusText:', response.statusText);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this._authenticated.set(false);
          await this.autoAuthenticate();
          return this.getNotaEmpenho(ano);
        }
        const errorText = await response.text();
        console.error('[SIGEF DEBUG] Error response:', errorText);
        throw new Error(`Erro na API: ${response.status} - ${response.statusText}`);
      }

      this._authenticated.set(true);
      const data = await response.json();
      console.log('[SIGEF DEBUG] Response data:', data);
      return (data.results || []) as NotaEmpenho[];
    } catch (err: any) {
      this._error.set(err.message || 'Erro desconhecido');
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  async getNotaEmpenhoByNumber(ano: string, numeroNE: string): Promise<NotaEmpenho | null> {
    const notas = await this.getNotaEmpenho(ano);
    return notas.find(ne => ne.nunotaempenho === numeroNE) || null;
  }

  async getNotaEmpenhoItens(ano: string): Promise<NotaEmpenhoItem[]> {
    this._loading.set(true);
    this._error.set(null);

    try {
      await this.ensureAuthenticated();

      const response = await fetch(`${this.apiUrl}/sigef/notaempenhoitem/?ano=${ano}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Erro na API: ${response.status}`);
      }

      const data = await response.json();
      return (data.results || []) as NotaEmpenhoItem[];
    } catch (err: any) {
      this._error.set(err.message || 'Erro desconhecido');
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  async getItensByNotaEmpenho(ano: string, nuEmpenho: string): Promise<NotaEmpenhoItem[]> {
    const itens = await this.getNotaEmpenhoItens(ano);
    return itens.filter(item => item.nuempenho === nuEmpenho);
  }

  async authenticate(username: string, password: string): Promise<string> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const response = await fetch(`${this.apiUrl}/token/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        throw new Error('Credenciais inválidas');
      }

      const data = await response.json();
      this.bearerToken = data.access;
      this._authenticated.set(true);
      return data.access;
    } catch (err: any) {
      this._error.set(err.message || 'Erro na autenticação');
      this._authenticated.set(false);
      throw err;
    } finally {
      this._loading.set(false);
    }
  }
}
