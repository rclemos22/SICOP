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

export interface OrdemBancaria {
  nuordembancaria: string | null;
  cdunidadegestora: number | null;
  cdgestao: number | null;
  cdevento: number | null;
  nudocumento: string | null;
  nunotaempenho: string | null;
  cdcredor: string | null;
  cdtipocredor: string | null;
  cdugfavorecida: number | null;
  cdorgao: number | null;
  cdsubacao: number | null;
  cdfuncao: number | null;
  cdsubfuncao: number | null;
  cdprograma: number | null;
  cdacao: number | null;
  localizagasto: string | null;
  cdnaturezadespesa: string | null;
  cdfonte: string | null;
  cdmodalidade: number | null;
  vltotal: number | null;
  dtlancamento: string | null;
  dtpagamento: string | null;
  definalidade: string | null;
  nuguiarecebimento: string | null;
  vlguiarecebimento: string | null;
  nunotalancamento: string | null;
  numns: number | null;
  deobservacao: string | null;
  domicilio_origem: string | null;
  domicilio_destino: string | null;
  cdsituacaoordembancaria: string | null;
  situacaopreparacaopagamento: string | null;
  tipoordembancaria: string | null;
  tipopreparacaopagamento: string | null;
  usuario_responsavel: string | null;
}

export interface SigefResponse<T> {
  data: T[];
  count: number;
  next: string | null;
  previous: string | null;
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
  private authPromise: Promise<void> | null = null;

  constructor() {
    this.ensureAuthenticated().catch(err => console.error('[SIGEF] Falha inicial:', err));
    this.startTokenMonitor();
  }

  ngOnDestroy() {
    this.stopTokenMonitor();
  }

  private startTokenMonitor(): void {
    this.refreshInterval = setInterval(() => {
      if (this.bearerToken && this.tokenExpiry) {
        const timeLeft = this.tokenExpiry - Date.now();
        // Se faltar menos de 5 minutos, renova
        if (timeLeft < 300000) {
          this.ensureAuthenticated();
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
      this._tokenExpiresAt.set(expiryDate.toLocaleString('pt-BR'));
    }
  }

  /**
   * Verifica se o token é válido com um buffer de tempo.
   */
  private isTokenExpired(): boolean {
    if (!this.bearerToken || !this.tokenExpiry) return true;
    // Buffer de 5 minutos para garantir que o token não expire durante uma operação longa
    return Date.now() >= (this.tokenExpiry - 300000);
  }

  /**
   * Força a revalidação do token. Útil para botões de "Reconectar".
   */
  async revalidateToken(): Promise<boolean> {
    try {
      await this.ensureAuthenticated(true);
      return true;
    } catch {
      return false;
    }
  }

  async checkTokenValidity(): Promise<boolean> {
    try {
      await this.ensureAuthenticated();
      return !!this.bearerToken && !this.isTokenExpired();
    } catch {
      return false;
    }
  }

  private async autoAuthenticate(): Promise<void> {
    console.log('[SIGEF] Iniciando autenticacao automatica');
    this._apiStatus.set('refreshing');
    try {
      await this.authenticate(environment.sigefUsername, environment.sigefPassword);
      console.log('[SIGEF] Autenticacao OK');
      this._apiStatus.set('connected');
    } catch (err: any) {
      console.error('[SIGEF] Falha na autenticacao automatica após retentativas:', err.message);
      this._error.set('Falha na autenticação (TimeOut): ' + err.message);
      this._apiStatus.set('error');
      throw err;
    }
  }

  private async refreshAccessToken(retries: number = 3): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('Refresh token não disponível');
    }
    
    this._apiStatus.set('refreshing');
    const url = `${this.apiUrl}/token/refresh/`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: this.refreshToken }),
      });

      if (!response.ok) {
        throw new Error('Falha ao renovar token');
      }

      const data = await response.json();
      this.bearerToken = data.access;
      const expiresIn = data.expires_in || 3600;
      this.tokenExpiry = Date.now() + (expiresIn * 1000);
      this._authenticated.set(true);
      this._apiStatus.set('connected');
      this.updateExpiresAt();
    } catch (err: any) {
      if (retries > 0 && err.message?.includes('ETIMEDOUT')) {
        console.warn(`[SIGEF] Timeout no refresh. Retentando... (${retries} restantes)`);
        await new Promise(r => setTimeout(r, 2000));
        return this.refreshAccessToken(retries - 1);
      }
      this._authenticated.set(false);
      this.refreshToken = null;
      throw err;
    }
  }

  setToken(token: string): void {
    this.bearerToken = token;
    this._authenticated.set(!!token);
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

  /**
   * Garante que o serviço está autenticado. 
   * Usa um bloqueio de promessa para evitar múltiplas chamadas simultâneas.
   */
  async ensureAuthenticated(force: boolean = false): Promise<void> {
    if (!force && this.bearerToken && !this.isTokenExpired()) {
      return;
    }

    if (this.authPromise) {
      return this.authPromise;
    }

    this.authPromise = (async () => {
      try {
        if (this.refreshToken && !force) {
          try {
            await this.refreshAccessToken();
            return;
          } catch (e) {
            console.warn('[SIGEF] Falha no refresh, tentando login completo...');
          }
        }
        await this.autoAuthenticate();
      } finally {
        this.authPromise = null;
      }
    })();

    return this.authPromise;
  }

  private async handleUnauthorized(): Promise<void> {
    console.warn('[SIGEF] 401/403 detectado, forçando reautenticação...');
    this.bearerToken = null;
    this._authenticated.set(false);
    await this.ensureAuthenticated(true);
  }

  private async callApi(url: string, options: RequestInit = {}, retries: number = 3, backoff: number = 2000): Promise<Response> {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 401 || response.status === 403) {
        await this.handleUnauthorized();
        const newOptions = { ...options, headers: this.getHeaders() };
        return await fetch(url, newOptions);
      }
      
      return response;
    } catch (err: any) {
      const isNetworkError = err.message?.includes('network') || 
                             err.message?.includes('socket') || 
                             err.message?.includes('disconnected') ||
                             err.message?.includes('ETIMEDOUT');
      
      if (isNetworkError && retries > 0) {
        console.warn(`[SIGEF] Erro de rede detectado (${err.message}). Retentando em ${backoff}ms... (${retries} tentativas restantes)`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        return this.callApi(url, options, retries - 1, backoff * 1.5);
      }
      throw err;
    }
  }

  async getNotaEmpenho(ano: string, search?: string, page: number = 1, cdunidadegestora?: string): Promise<{ data: NotaEmpenho[], count: number, next: string | null, previous: string | null }> {
    this._loading.set(true);
    this._error.set(null);

    try {
      await this.ensureAuthenticated();
      
      const url = `${this.apiUrl}/sigef/notaempenho/`;
      let queryParams = `ano=${ano}&page=${page}`;
      if (search) {
        queryParams += `&search=${encodeURIComponent(search)}`;
      }
      if (cdunidadegestora) {
        queryParams += `&cdunidadegestora=${cdunidadegestora}`;
      }
      const fullUrl = `${url}?${queryParams}`;
      
      const response = await this.callApi(fullUrl, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this._apiStatus.set('error');
        throw new Error(`Erro na API: ${response.status} - ${response.statusText}`);
      }

      this._authenticated.set(true);
      this._apiStatus.set('connected');
      const data = await response.json();
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
      // Delay de cortesia para evitar bloqueio TLS
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  }

  /**
   * Busca todas as movimentações (inicial, reforços e anulações) relacionadas a um empenho.
   */
  async getNotaEmpenhoMovements(ano: string, numeroNE: string, cdunidadegestora: string): Promise<NotaEmpenho[]> {
    console.log('=== [SIGEF SERVICE] getNotaEmpenhoMovements ===');
    console.log('[SIGEF] Buscando movimentações - ano:', ano, 'numeroNE:', numeroNE, 'UG:', cdunidadegestora);
    
    const movements: NotaEmpenho[] = [];
    let page = 1;
    
    while (true) {
      // Usamos o numeroNE no search para a API filtrar registros relevantes
      const result = await this.getNotaEmpenho(ano, numeroNE, page, cdunidadegestora);
      
      const filtered = result.data.filter(ne => 
        (ne.nunotaempenho === numeroNE || ne.nuneoriginal === numeroNE) && 
        ne.cdunidadegestora === cdunidadegestora
      );
      
      movements.push(...filtered);
      
      if (!result.next) break;
      page++;
      // Delay de cortesia entre páginas
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`[SIGEF] Total de movimentações encontradas: ${movements.length}`);
    return movements;
  }

  /**
   * Consulta ordens bancárias filtradas por período.
   */
  async getOrdemBancaria(datainicio: string, datafim: string, page: number = 1, nuordembancaria?: string, nunotaempenho?: string, cdunidadegestora?: string): Promise<SigefResponse<OrdemBancaria>> {
    this._loading.set(true);
    this._error.set(null);

    try {
      await this.ensureAuthenticated();
      const url = `${this.apiUrl}/sigef/ordembancaria/`;
      const params = new URLSearchParams({
        datainicio,
        datafim,
        page: page.toString(),
      });
      
      if (nuordembancaria) {
        params.append('nuordembancaria', nuordembancaria);
      }
      
      // Tentar passar nunotaempenho via parâmetro de busca textual (mais flexível)
      if (nunotaempenho) {
        params.append('search', nunotaempenho);
        params.append('nunotaempenho', nunotaempenho);
      }
      
      if (cdunidadegestora) {
        params.append('cdunidadegestora', cdunidadegestora.toString());
      }

      const fullUrl = `${url}?${params}`;
      console.log('[SIGEF OB] URL:', fullUrl);

      const response = await this.callApi(fullUrl, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      // Retornar array vazio em vez de lançar erro para erros 5xx
      if (!response.ok) {
        const errorText = await response.text();
        if (response.status >= 500) {
          console.warn('[SIGEF OB] Erro 5xx da API, retornando vazio:', response.status);
          return { data: [], count: 0, next: null, previous: null };
        }
        throw new Error(`Erro na API: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('[SIGEF OB] Response data:', JSON.stringify(data).substring(0, 500));
      
      return {
        data: (data.results || []) as OrdemBancaria[],
        count: data.count || 0,
        next: data.next,
        previous: data.previous
      };
    } catch (err: any) {
      // Em caso de erro de rede ou outro, retornar vazio em vez de quebrar
      if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
        console.warn('[SIGEF OB] Erro de rede, retornando vazio');
        return { data: [], count: 0, next: null, previous: null };
      }
      this._error.set(err.message || 'Erro ao buscar ordem bancária');
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Busca todas as ordens bancárias confirmadas vinculadas a uma lista de notas de empenho (original + reforços).
   * Busca a partir do ano da NE até o ano atual, pois pagamentos podem ser efetuados em anos posteriores.
   */
  async getOrdemBancariaMovements(ano: string, numeroNEs: string[], cdunidadegestora: string): Promise<OrdemBancaria[]> {
    console.log('=== [SIGEF SERVICE] getOrdemBancariaMovements ===', { ano, numeroNEs, ug: cdunidadegestora });
    const allOBs: OrdemBancaria[] = [];
    const MAX_PAGES = 500;
    const anoNE = parseInt(ano, 10);
    const anoAtual = new Date().getFullYear();
    
    const anosAPesquisar = [];
    for (let a = anoNE; a <= anoAtual; a++) {
      anosAPesquisar.push(a.toString());
    }
    console.log('[SIGEF OB] Anos a pesquisar para OBs:', anosAPesquisar);

    // Iterar sobre todas as NEs encontradas para este contrato/UG
    for (const neNumber of numeroNEs) {
      console.log(`[SIGEF OB] Buscando OBs para NE: ${neNumber} na UG: ${cdunidadegestora}`);
      
      for (const anoPesquisa of anosAPesquisar) {
        let page = 1;
        // O SIGEF espera formato YYYY-MM-DD para OBs
        const datainicio = `${anoPesquisa}-01-01`;
        const datafim = `${anoPesquisa}-12-31`;

        while (page <= MAX_PAGES) {
          try {
            const result = await this.getOrdemBancaria(datainicio, datafim, page, undefined, neNumber, cdunidadegestora);
            
            if (result.data.length > 0) {
              // Filtrar no frontend para garantir que a OB realmente pertence à NE solicitada (se a API retornar busca aproximada)
              const filteredMatches = result.data.filter(ob => 
                !neNumber || 
                ob.nunotaempenho?.includes(neNumber) || 
                ob.deobservacao?.includes(neNumber) || 
                ob.definalidade?.includes(neNumber) ||
                ob.nudocumento?.includes(neNumber)
              );
              
              if (filteredMatches.length > 0) {
                allOBs.push(...filteredMatches);
                console.log(`[SIGEF OB] NE ${neNumber} (${anoPesquisa}) - Pág ${page}: Encontradas ${filteredMatches.length} OBs válidas`);
              }
            }

            // Se não houver próxima página ou se a página atual estiver vazia, encerra a busca para este ano/NE
            if (!result.next || result.data.length === 0) break;
            page++;
            
            // Delay de cortesia para a API (1200ms entre requisições para evitar bloqueio TLS/Network)
            await new Promise(resolve => setTimeout(resolve, 1200));
          } catch (err) {
            console.error(`[SIGEF OB] Erro na página ${page} para NE ${neNumber}:`, err);
            break;
          }
        }
        // Delay extra entre anos de pesquisa
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Remover duplicatas
    const uniqueOBs = Array.from(new Map(allOBs.map(ob => [ob.nuordembancaria + '-' + ob.cdunidadegestora, ob])).values());
    console.log(`[SIGEF OB] Busca concluída para o contrato. Total único: ${uniqueOBs.length} OBs`);
    return uniqueOBs;
  }


  async getNotaEmpenhoItens(ano: string, page: number = 1): Promise<{ data: NotaEmpenhoItem[], count: number, next: string | null, previous: string | null }> {
    this._loading.set(true);
    this._error.set(null);

    try {
      await this.ensureAuthenticated();

      const url = `${this.apiUrl}/sigef/notaempenhoitem/`;
      const queryParams = `ano=${ano}&page=${page}`;
      console.log('[SIGEF NE ITEM] URL:', url, '?', queryParams);

      const response = await this.callApi(`${url}?${queryParams}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
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

  async authenticate(username: string, password: string, retries: number = 3): Promise<string> {
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

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SIGEF AUTH] Error response:', errorText);
        this._apiStatus.set('error');
        throw new Error('Credenciais inválidas: ' + response.status);
      }

      const data = await response.json();
      this.bearerToken = data.access;
      this.refreshToken = data.refresh || null;
      this.tokenExpiry = data.exp ? Date.now() + (data.exp * 1000) - 60000 : Date.now() + (3600 * 1000) - 60000;
      this._authenticated.set(true);
      this._apiStatus.set('connected');
      this.updateExpiresAt();
      return data.access;
    } catch (err: any) {
      if (retries > 0 && (err.message?.includes('ETIMEDOUT') || err.message?.includes('fetch'))) {
        console.warn(`[SIGEF AUTH] Timeout ou erro de rede no login. Retentando em 3s... (${retries} restantes)`);
        await new Promise(r => setTimeout(r, 3000));
        return this.authenticate(username, password, retries - 1);
      }
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
    await this.ensureAuthenticated(true);
  }
}
