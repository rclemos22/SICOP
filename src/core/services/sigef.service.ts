import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { environment } from '../../environments/environment';

export type ApiStatus = 'connected' | 'disconnected' | 'refreshing' | 'error';

export interface NotaEmpenho {
  ano: number | null;
  cdunidadegestora: string | null;
  cdgestao: string | null;
  nunotaempenho: string | null;
  nuneoriginal: string | null;
  cdcredor: string | null;
  dtlancamento: string | null;
  tipo: string | null;
  cdsubacao: string | null;
  cdunidadeorcamentaria: string | null;
  cdnaturezadespesa: string | null;
  cdfuncao: string | null;
  cdsubfuncao: string | null;
  cdprograma: number | null;
  cdacao: string | null;
  cdfonte: string | null;
  cdevento: number | null;
  cdmodalidadelicitacao: string | null;
  cdmodalidadeempenho: string | null;
  demodalidadeempenho: string | null;
  nuprocesso: string | null;
  vlnotaempenho: number | null;
  nuquantidade: number | null;
  dehistorico: string | null;
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
export class SigefService implements OnDestroy {
  private apiUrl = environment.sigefApiUrl;
  private _loading = signal(false);
  private _error = signal<string | null>(null);
  private _authenticated = signal(false);
  private _apiStatus = signal<ApiStatus>('disconnected');
  private _tokenExpiresAt = signal<string | null>(null);

  public loading = this._loading.asReadonly();
  public error = this._error.asReadonly();
  public authenticated = this._authenticated.asReadonly();
  public apiStatus = this._apiStatus.asReadonly();
  public tokenExpiresAt = this._tokenExpiresAt.asReadonly();

  private bearerToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: number | null = null;
  private refreshInterval: any = null;
  private isRefreshing = false;

  constructor() {
    this.autoAuthenticate();
    this.startTokenMonitor();
  }

  ngOnDestroy() {
    this.stopTokenMonitor();
  }

  private startTokenMonitor(): void {
    this.refreshInterval = setInterval(() => {
      if (this.bearerToken && this.tokenExpiry) {
        const timeLeft = this.tokenExpiry - Date.now();
        if (timeLeft > 0 && timeLeft < 300000) {
          this.refreshTokenIfNeeded();
        }
        this.updateExpiresAt();
      }
    }, 60000);
  }

  private stopTokenMonitor(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  private updateExpiresAt(): void {
    if (this.tokenExpiry) {
      const expiryDate = new Date(this.tokenExpiry);
      this._tokenExpiresAt.set(expiryDate.toLocaleTimeString('pt-BR'));
    }
  }

  private isTokenExpired(): boolean {
    if (!this.tokenExpiry) return true;
    return Date.now() >= this.tokenExpiry;
  }

  async checkTokenValidity(): Promise<boolean> {
    if (!this.bearerToken || this.isTokenExpired()) {
      await this.refreshTokenIfNeeded();
    }
    return !!this.bearerToken && !this.isTokenExpired();
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    if (this.isRefreshing) return;
    
    this.isRefreshing = true;
    this._apiStatus.set('refreshing');
    
    try {
      if (this.refreshToken) {
        await this.refreshAccessToken();
      } else {
        await this.autoAuthenticate();
      }
      this._apiStatus.set('connected');
    } catch (err: any) {
      console.error('[SIGEF] Falha ao verificar/renovar token:', err);
      this._apiStatus.set('error');
      this._error.set('Erro ao conectar com a API: ' + err.message);
    } finally {
      this.isRefreshing = false;
    }
  }

  private async autoAuthenticate(): Promise<void> {
    console.log('[SIGEF] Iniciando autenticacao automatica');
    this._apiStatus.set('refreshing');
    try {
      await this.authenticate(environment.sigefUsername, environment.sigefPassword);
      console.log('[SIGEF] Autenticacao OK, token:', this.bearerToken?.substring(0, 20) + '...');
      this._apiStatus.set('connected');
    } catch (err: any) {
      console.error('[SIGEF] Falha na autenticacao automatica:', err.message);
      this._error.set('Falha na autenticação: ' + err.message);
      this._apiStatus.set('disconnected');
    }
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('Refresh token não disponível');
    }
    
    const url = `${this.apiUrl}/token/refresh/`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: this.refreshToken }),
    });

    if (!response.ok) {
      this._authenticated.set(false);
      this._apiStatus.set('disconnected');
      throw new Error('Falha ao renovar token');
    }

    const data = await response.json();
    this.bearerToken = data.access;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
    this._authenticated.set(true);
    this.updateExpiresAt();
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
    if (!this.bearerToken || this.isTokenExpired()) {
      this._apiStatus.set('refreshing');
      if (this.refreshToken) {
        await this.refreshAccessToken();
      } else {
        await this.autoAuthenticate();
      }
      this._apiStatus.set('connected');
    }
  }

  private async handleUnauthorized(): Promise<void> {
    this._authenticated.set(false);
    this._apiStatus.set('refreshing');
    this.bearerToken = null;
    this.tokenExpiry = null;
    if (this.refreshToken) {
      try {
        await this.refreshAccessToken();
        this._apiStatus.set('connected');
        return;
      } catch {
        this.refreshToken = null;
      }
    }
    await this.autoAuthenticate();
  }

  async getNotaEmpenho(ano: string, search?: string, page: number = 1, cdunidadegestora?: string): Promise<{ data: NotaEmpenho[], count: number, next: string | null, previous: string | null }> {
    this._loading.set(true);
    this._error.set(null);

    try {
      await this.ensureAuthenticated();
      console.log('[SIGEF] Token disponivel, fazendo requisicao');

      const url = `${this.apiUrl}/sigef/notaempenho/`;
      let queryParams = `ano=${ano}&page=${page}`;
      if (search) {
        queryParams += `&search=${encodeURIComponent(search)}`;
      }
      if (cdunidadegestora) {
        queryParams += `&cdunidadegestora=${cdunidadegestora}`;
      }
      const fullUrl = `${url}?${queryParams}`;
      console.log('[SIGEF NE] URL:', fullUrl);
      console.log('[SIGEF NE] Headers:', JSON.stringify(this.getHeaders()));

      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      console.log('[SIGEF NE] Status:', response.status);
      console.log('[SIGEF NE] StatusText:', response.statusText);
      console.log('[SIGEF NE] Response headers:', response.headers.get('content-type'));

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          await this.handleUnauthorized();
          return this.getNotaEmpenho(ano, search, page);
        }
        const errorText = await response.text();
        console.error('[SIGEF NE] Error response:', errorText);
        this._apiStatus.set('error');
        throw new Error(`Erro na API: ${response.status} - ${response.statusText}`);
      }

      this._authenticated.set(true);
      this._apiStatus.set('connected');
      const data = await response.json();
      console.log('[SIGEF NE] Response:', data);
      return {
        data: (data.results || []) as NotaEmpenho[],
        count: data.count || 0,
        next: data.next,
        previous: data.previous
      };
    } catch (err: any) {
      this._error.set(err.message || 'Erro desconhecido');
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  async getNotaEmpenhoByNumber(ano: string, numeroNE: string, cdunidadegestora?: string): Promise<NotaEmpenho | null> {
    console.log('=== [SIGEF SERVICE] getNotaEmpenhoByNumber ===');
    console.log('[SIGEF] Recebendo params - ano:', ano, 'numeroNE:', numeroNE, 'UG:', cdunidadegestora);
    let page = 1;
    while (true) {
      console.log('[SIGEF] Verificando pagina:', page, 'com ano:', ano);
      const result = await this.getNotaEmpenho(ano, undefined, page, undefined);
      console.log('[SIGEF] Resultados nesta pagina:', result.data.length, 'Total:', result.count);
      
      const found = result.data.find(ne => 
        ne.nunotaempenho === numeroNE && 
        ne.cdunidadegestora === cdunidadegestora
      );
      
      if (found) {
        console.log('[SIGEF] NE encontrada na pagina', page, ':', found.nunotaempenho, 'UG:', found.cdunidadegestora);
        return found;
      }
      
      if (!result.next) {
        console.log('[SIGEF] Fim da paginacao, NE nao encontrada para UG:', cdunidadegestora);
        return null;
      }
      page++;
    }
  }

  async getNotaEmpenhoItens(ano: string, page: number = 1): Promise<{ data: NotaEmpenhoItem[], count: number, next: string | null, previous: string | null }> {
    this._loading.set(true);
    this._error.set(null);

    try {
      await this.ensureAuthenticated();

      const url = `${this.apiUrl}/sigef/notaempenhoitem/`;
      const queryParams = `ano=${ano}&page=${page}`;
      console.log('[SIGEF NE ITEM] URL:', url, '?', queryParams);

      const response = await fetch(`${url}?${queryParams}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      console.log('[SIGEF NE ITEM] Status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SIGEF NE ITEM] Error:', errorText);
        throw new Error(`Erro na API: ${response.status}`);
      }

      const data = await response.json();
      console.log('[SIGEF NE ITEM] Response:', data);
      return {
        data: (data.results || []) as NotaEmpenhoItem[],
        count: data.count || 0,
        next: data.next,
        previous: data.previous
      };
    } catch (err: any) {
      this._error.set(err.message || 'Erro desconhecido');
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  async getItensByNotaEmpenho(ano: string, nuEmpenho: string): Promise<NotaEmpenhoItem[]> {
    const itens: NotaEmpenhoItem[] = [];
    let page = 1;
    while (true) {
      const result = await this.getNotaEmpenhoItens(ano, page);
      const filtered = result.data.filter(item => item.nuempenho === nuEmpenho);
      itens.push(...filtered);
      if (!result.next) break;
      page++;
    }
    return itens;
  }

  async authenticate(username: string, password: string): Promise<string> {
    this._loading.set(true);
    this._error.set(null);
    this._apiStatus.set('refreshing');

    try {
      const url = `${this.apiUrl}/token/`;
      console.log('[SIGEF AUTH] URL completa:', url);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      console.log('[SIGEF AUTH] Status:', response.status);
      console.log('[SIGEF AUTH] StatusText:', response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SIGEF AUTH] Error response:', errorText);
        this._apiStatus.set('error');
        throw new Error('Credenciais inválidas: ' + response.status);
      }

      const data = await response.json();
      console.log('[SIGEF AUTH] Response received, access token:', data.access ? 'OK' : 'MISSING');
      this.bearerToken = data.access;
      this.refreshToken = data.refresh || null;
      this.tokenExpiry = data.exp ? Date.now() + (data.exp * 1000) - 60000 : Date.now() + (3600 * 1000) - 60000;
      this._authenticated.set(true);
      this._apiStatus.set('connected');
      this.updateExpiresAt();
      return data.access;
    } catch (err: any) {
      console.error('[SIGEF AUTH] Erro capturado:', err);
      this._error.set(err.message || 'Erro na autenticação');
      this._authenticated.set(false);
      this._apiStatus.set('disconnected');
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  async reconnect(): Promise<void> {
    this._apiStatus.set('refreshing');
    await this.autoAuthenticate();
  }
}
