import { Injectable, inject, signal, OnDestroy, forwardRef } from '@angular/core';
import { environment } from '../../environments/environment';
import { SigefCacheService, SIGEF_PAID_STATUSES } from './sigef-cache.service';

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
  private refreshInterval: any;
  private cacheService = inject(forwardRef(() => SigefCacheService));
  private authPromise: Promise<void> | null = null;

  // ─── Fila Global de Consultas ────────────────────────────────
  // Controla concorrência: apenas 1 requisição por vez na API do SIGEF
  private queryQueue: Promise<any> = Promise.resolve();
  private pendingQueries: Map<string, { cancel: () => void }> = new Map();
  private currentQueryId: string | null = null;

  private readonly ACCESS_TOKEN_KEY = 'sigef_access_token';
  private readonly REFRESH_TOKEN_KEY = 'sigef_refresh_token';
  private readonly EXIRY_KEY = 'sigef_token_expiry';

  constructor() {
    this.loadPersistedTokens();
    this.ensureAuthenticated().catch(err => console.error('[SIGEF] Falha inicial:', err));
    this.startTokenMonitor();
  }

  private loadPersistedTokens(): void {
    try {
      this.bearerToken = localStorage.getItem(this.ACCESS_TOKEN_KEY);
      this.refreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY);
      const expiry = localStorage.getItem(this.EXIRY_KEY);
      if (expiry) {
        this.tokenExpiry = parseInt(expiry, 10);
        this.updateExpiresAt();
      }
      if (this.bearerToken && !this.isTokenExpired()) {
        this._authenticated.set(true);
        this._apiStatus.set('connected');
      }
    } catch (e) {
      console.warn('[SIGEF] Erro ao carregar tokens do localStorage', e);
    }
  }

  private persistTokens(): void {
    try {
      if (this.bearerToken) localStorage.setItem(this.ACCESS_TOKEN_KEY, this.bearerToken);
      if (this.refreshToken) localStorage.setItem(this.REFRESH_TOKEN_KEY, this.refreshToken);
      if (this.tokenExpiry) localStorage.setItem(this.EXIRY_KEY, this.tokenExpiry.toString());
    } catch (e) {
      console.warn('[SIGEF] Erro ao salvar tokens no localStorage', e);
    }
  }

  ngOnDestroy() {
    this.stopTokenMonitor();
  }

  private startTokenMonitor(): void {
    this.refreshInterval = setInterval(() => {
      const expiry = this.tokenExpiry;
      if (this.bearerToken && expiry) {
        const timeLeft = expiry - Date.now();
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
    const expiry = this.tokenExpiry;
    // Buffer de 5 minutos para garantir que o token não expire durante uma operação longa
    return Date.now() >= (expiry - 300000);
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

  private async refreshAccessToken(retries: number = 5, backoff: number = 3000): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('Refresh token não disponível');
    }
    
    this._apiStatus.set('refreshing');
    const url = `${this.apiUrl}/token/refresh/`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: this.refreshToken }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('Falha ao renovar token');
      }

      const data = await response.json();
      this.bearerToken = data.access;
      if (data.refresh) {
        this.refreshToken = data.refresh;
      }
      
      const expiresIn = data.expires_in || 3600;
      this.tokenExpiry = Date.now() + (expiresIn * 1000);
      
      this.persistTokens();
      this._authenticated.set(true);
      this._apiStatus.set('connected');
      this.updateExpiresAt();
    } catch (err: any) {
      clearTimeout(timeoutId);
      const errLower = (err.message || err.name || '').toLowerCase();
      const isTimeout = err.name === 'AbortError' || errLower.includes('timeout') || errLower.includes('etimedout') || errLower.includes('aborted');
      
      if (retries > 0 && isTimeout) {
        console.warn(`[SIGEF] Timeout no refresh. Backoff ${backoff}ms, retries: ${retries}`);
        await new Promise(r => setTimeout(r, backoff));
        return this.refreshAccessToken(retries - 1, Math.min(backoff * 2, 60000));
      }
      
      this._authenticated.set(false);
      this.refreshToken = null;
      localStorage.removeItem(this.REFRESH_TOKEN_KEY);
      localStorage.removeItem(this.ACCESS_TOKEN_KEY);
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
    console.warn('[SIGEF] 401/403 detectado, tentando renovar o token antes de novo login...');
    this.bearerToken = null;
    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
    this._authenticated.set(false);
    // Tentamos o ensureAuthenticated SEM o force=true primeiro, para que ele tente o refresh
    await this.ensureAuthenticated(false);
  }

  /**
   * Executa uma chamada à API com enfileiramento global e suporte a cancelamento.
   * Usa loop interno para retry em vez de recursão, evitando perda do queryId
   * entre tentativas e crescimento da fila.
   */
  async callApi(url: string, options: RequestInit = {}, retries: number = 5, backoff: number = 5000, queryId?: string): Promise<Response> {
    if (queryId && !this.pendingQueries.has(queryId)) {
      return new Response(null, { status: 499, statusText: 'Query cancelled' });
    }

    return this.queryQueue = this.queryQueue.then(async () => {
      if (queryId && !this.pendingQueries.has(queryId)) {
        return new Response(null, { status: 499, statusText: 'Query cancelled' });
      }

      this.currentQueryId = queryId || null;
      let currentRetries = retries;
      let currentBackoff = backoff;

      while (true) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 120000);

        if (queryId) {
          const pending = this.pendingQueries.get(queryId);
          if (pending) {
            pending.cancel = () => {
              controller.abort();
              this.pendingQueries.delete(queryId);
            };
          }
        }

        try {
          const response = await fetch(url, { ...options, signal: controller.signal });
          clearTimeout(id);

          if (response.status === 401 || response.status === 403) {
            await this.handleUnauthorized();
            options = { ...options, headers: this.getHeaders() };
            continue;
          }

          if ([500, 502, 503, 504].includes(response.status) && currentRetries > 0) {
            console.warn(`[SIGEF] Gateway Error (${response.status}). Backoff ${currentBackoff}ms...`);
            await new Promise(resolve => setTimeout(resolve, currentBackoff));
            currentBackoff = Math.min(currentBackoff * 2, 60000);
            currentRetries--;
            continue;
          }

          await new Promise(resolve => setTimeout(resolve, 300));
          return response;
        } catch (err: any) {
          clearTimeout(id);

          if (queryId && !this.pendingQueries.has(queryId)) {
            return new Response(null, { status: 499, statusText: 'Query cancelled' });
          }

          if (this._isRetryableError(err) && currentRetries > 0) {
            const isSlow = /tls|socket|timeout|etimedout/i.test(err?.message || err?.cause?.message || String(err));
            // Para erros lentos (timeout, etc.), retry apenas 1x com backoff curto
            // para não travar a fila global por minutos
            const retryLimit = isSlow ? 1 : currentRetries;
            if (currentRetries <= retries - retryLimit) {
              this._cleanupQuery(queryId);
              throw err;
            }
            currentBackoff = this._calcBackoff(err, currentBackoff);
            console.warn(`[SIGEF] Infra Error (${this._extractErrorMessage(err)}). Backoff ${Math.round(currentBackoff)}ms, retries: ${currentRetries}`);
            await new Promise(resolve => setTimeout(resolve, currentBackoff));
            currentRetries--;
            continue;
          }

          this._cleanupQuery(queryId);
          throw err;
        }
      }
    });
  }

  private _extractErrorMessage(err: any): string {
    if (typeof err === 'string') return err;
    if (err instanceof AggregateError && err.errors?.length > 0) {
      return err.errors.map((e: any) => e?.message || String(e)).join('; ');
    }
    return err?.message || err?.cause?.message || String(err) || 'Erro desconhecido';
  }

  private _isRetryableError(err: any): boolean {
    const patterns = /ETIMEDOUT|ECONNREFUSED|ECONNRESET|Failed to fetch|NetworkError|TLS|disconnected|timeout|socket|handshake|connection reset|abort|enotfound|eai_again/i;
    if (patterns.test(err?.message || '')) return true;
    if (patterns.test(err?.cause?.message || '')) return true;
    if (patterns.test(String(err) || '')) return true;
    if (err?.name === 'AbortError' || err?.name === 'AggregateError') return true;
    if (err instanceof AggregateError && err.errors?.length > 0) {
      return err.errors.some((e: any) => patterns.test(e?.message || String(e)));
    }
    return false;
  }

  private _calcBackoff(err: any, currentBackoff: number): number {
    const errStr = (err?.message || err?.cause?.message || String(err) || '').toLowerCase();
    const isSlow = /tls|socket|timeout|etimedout/.test(errStr);
    const multiplier = isSlow ? 2 : 1.5;
    const jitter = 0.8 + Math.random() * 0.4;
    return Math.min(currentBackoff * multiplier * jitter, 120000);
  }

  private _cleanupQuery(queryId?: string): void {
    if (queryId) {
      this.pendingQueries.delete(queryId);
      if (this.currentQueryId === queryId) {
        this.currentQueryId = null;
      }
    }
  }

  /**
   * Adiciona uma consulta à fila com um ID único.
   * Retorna o ID da consulta para permitir cancelamento posterior.
   */
  enqueueQuery(queryId: string): void {
    if (!this.pendingQueries.has(queryId)) {
      this.pendingQueries.set(queryId, { cancel: () => {} });
    }
  }

  /**
   * Cancela uma consulta específica na fila.
   */
  cancelQuery(queryId: string): void {
    const pending = this.pendingQueries.get(queryId);
    if (pending) {
      pending.cancel();
      this.pendingQueries.delete(queryId);
      console.log(`[SIGEF] Consulta ${queryId} cancelada.`);
    }
  }

  /**
   * Cancela todas as consultas pendentes (útil ao navegar entre contratos).
   */
  cancelAllQueries(): void {
    const queryIds = Array.from(this.pendingQueries.keys());
    queryIds.forEach(id => this.cancelQuery(id));
    console.log(`[SIGEF] ${queryIds.length} consulta(s) cancelada(s).`);
  }

  /**
   * Verifica se uma consulta está pendente.
   */
  hasPendingQuery(queryId: string): boolean {
    return this.pendingQueries.has(queryId);
  }

  /**
   * Busca notas de empenho com suporte a fila de consultas e cancelamento.
   * @param ano - Ano da consulta
   * @param search - Termo de busca (número da NE)
   * @param page - Página
   * @param cdunidadegestora - Unidade gestora
   * @param bypassMirror - Se deve ignorar o espelho
   * @param queryId - ID opcional para cancelamento
   */
  async getNotaEmpenho(
    ano: string, 
    search?: string, 
    page: number = 1, 
    cdunidadegestora?: string, 
    bypassMirror: boolean = false,
    queryId?: string
  ): Promise<SigefResponse<NotaEmpenho>> {
    this._loading.set(true);
    this._error.set(null);

    try {
      await this.ensureAuthenticated();
      
      if (!bypassMirror && search && search.length >= 10 && page === 1) {
        const cached = await this.cacheService.getRawMirror(search, 'NE');
        if (cached) {
          console.log(`[SIGEF RAW MIRROR] NE ${search} encontrada no espelho.`);
          return {
            data: [cached],
            count: 1,
            next: null,
            previous: null
          };
        }
      }

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
      }, 5, 5000, queryId);

      if (!response.ok) {
        const errorText = await response.text();
        this._apiStatus.set('error');
        if (response.status === 499) {
          throw new Error('Query cancelled');
        }
        throw new Error(`Erro na API: ${response.status} - ${response.statusText}`);
      }

      this._authenticated.set(true);
      this._apiStatus.set('connected');
      const data = await response.json();
      
      // Salvar cada item individualmente no espelho bruto (General Mirror)
      if (data.results && data.results.length > 0) {
        await this.cacheService.saveRawMirrorBulk(data.results, 'NE', 'nunotaempenho', 'ano');
      }

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

  /**
   * Busca todas as NEs de um período de datas (sem filtro por número de NE).
   * Usado pelo SigefBulkSyncService para download total de um mês/período.
   * Não usa cache — sempre vai à API para garantir dados completos.
   */
  async getNotaEmpenhoByPeriod(
    datainicio: string,
    datafim: string,
    page: number = 1,
    cdunidadegestora?: string
  ): Promise<SigefResponse<NotaEmpenho>> {
    this._loading.set(true);
    this._error.set(null);

    try {
      await this.ensureAuthenticated();

      // Extrair o ano do período para o parâmetro obrigatório da API
      const ano = datainicio.substring(0, 4);

      const url = `${this.apiUrl}/sigef/notaempenho/`;
      const params = new URLSearchParams({
        ano,
        page: page.toString(),
        dtlancamento_after: datainicio,
        dtlancamento_before: datafim
      });

      if (cdunidadegestora) {
        params.append('cdunidadegestora', cdunidadegestora);
      }

      const fullUrl = `${url}?${params}`;
      console.log(`[SIGEF NE PERIOD] ${datainicio}→${datafim} pág.${page}: ${fullUrl}`);

      const response = await this.callApi(fullUrl, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        if (response.status >= 500) {
          console.warn(`[SIGEF NE PERIOD] Erro ${response.status}, retornando vazio.`);
          return { data: [], count: 0, next: null, previous: null };
        }
        throw new Error(`Erro na API: ${response.status} - ${response.statusText}`);
      }

      this._apiStatus.set('connected');
      const data = await response.json();

      return {
        data: (data.results || []) as NotaEmpenho[],
        count: data.count || 0,
        next: data.next,
        previous: data.previous
      };
    } catch (err: any) {
      if (this._isRetryableError(err)) {
        console.warn('[SIGEF NE PERIOD] Erro de rede:', this._extractErrorMessage(err));
        return { data: [], count: 0, next: null, previous: null };
      }
      this._error.set(err.message || 'Erro ao buscar NEs por período');
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Busca uma NE específica pelo número com suporte a cancelamento.
   */
  async getNotaEmpenhoByNumber(
    ano: string, 
    numeroNE: string, 
    cdunidadegestora?: string, 
    bypassMirror: boolean = false,
    queryId?: string
  ): Promise<NotaEmpenho | null> {
    console.log('[SIGEF] Buscando NE específica via busca:', numeroNE, 'ano:', ano, 'bypassMirror:', bypassMirror, 'queryId:', queryId);
    
    // Otimização: Usar search=numeroNE para evitar varredura de páginas
    const result = await this.getNotaEmpenho(ano, numeroNE, 1, cdunidadegestora, bypassMirror, queryId);
    
    let found = result.data.find(ne => 
      ne.nunotaempenho === numeroNE && 
      (!cdunidadegestora || ne.cdunidadegestora === cdunidadegestora)
    );

    if (found) return found;

    // Se não achou na página 1, tenta páginas seguintes MANTENDO O FILTRO
    if (result.count > result.data.length) {
      let page = 2;
      const MAX_SCAN = 3;
      while (page <= MAX_SCAN) {
        if (queryId && !this.pendingQueries.has(queryId)) {
          console.log(`[SIGEF] Busca da NE ${numeroNE} cancelada durante scan.`);
          return null;
        }
        
        console.log(`[SIGEF] Scan pag.${page} para NE ${numeroNE}...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        const pResult = await this.getNotaEmpenho(ano, numeroNE, page, cdunidadegestora, bypassMirror, queryId);
        
        found = pResult.data.find(ne => 
          ne.nunotaempenho === numeroNE && 
          (!cdunidadegestora || ne.cdunidadegestora === cdunidadegestora)
        );
        if (found) return found;
        if (!pResult.next) break;
        page++;
      }
    }

    return null;
  }

  /**
   * Busca movimentações de uma NE com suporte a cancelamento.
   */
  async getNotaEmpenhoMovements(
    ano: string, 
    numeroNE: string, 
    cdunidadegestora: string, 
    bypassMirror: boolean = false,
    queryId?: string
  ): Promise<NotaEmpenho[]> {
    console.log('=== [SIGEF SERVICE] getNotaEmpenhoMovements (GENERAL MIRROR) ===');
    console.log('[SIGEF] Buscando movimentações - ano:', ano, 'numeroNE:', numeroNE, 'UG:', cdunidadegestora, 'bypassMirror:', bypassMirror, 'queryId:', queryId);
    
    // 1. Tentar carregar do Espelho Geral (General Mirror)
    if (!bypassMirror) {
      const cached = await this.cacheService.getNotaEmpenhoMovementsFromMirror(numeroNE);
      if (cached && cached.length > 0) {
        console.log(`[SIGEF RAW MIRROR] Encontrados ${cached.length} movimentos no espelho para NE ${numeroNE}`);
        // Filtragem por UG apenas por segurança
        return cached.filter(ne => ne.cdunidadegestora === cdunidadegestora) as NotaEmpenho[];
      }
    }

    const movements: NotaEmpenho[] = [];
    let page = 1;
    
    while (true) {
      // Verifica se a consulta foi cancelada
      if (queryId && !this.pendingQueries.has(queryId)) {
        console.log(`[SIGEF] Busca de movimentações para NE ${numeroNE} cancelada.`);
        return movements; // Retorna o que já temos
      }

      try {
        // Usamos o numeroNE no search para a API filtrar registros relevantes
        const result = await this.getNotaEmpenho(ano, numeroNE, page, cdunidadegestora, bypassMirror, queryId);
        
        const filtered = result.data.filter(ne => 
          (ne.nunotaempenho === numeroNE || ne.nuneoriginal === numeroNE) && 
          ne.cdunidadegestora === cdunidadegestora
        );
        
        movements.push(...filtered);
        
        if (!result.next) break;
        page++;
        // Delay de cortesia entre páginas
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err: any) {
        if (err.message === 'Query cancelled') {
          console.log(`[SIGEF] Busca de movimentações cancelada para NE ${numeroNE}.`);
          return movements;
        }
        console.warn(`[SIGEF] Falha ao carregar página ${page} de movimentos para ${numeroNE}. Retornando dados parciais.`, err);
        break;
      }
    }
    
    console.log(`[SIGEF] Total de movimentações encontradas: ${movements.length}`);
    return movements;
  }

  /**
   * Consulta ordens bancárias filtradas por período com suporte a cancelamento.
   */
  async getOrdemBancaria(
    datainicio: string, 
    datafim: string, 
    page: number = 1, 
    nuordembancaria?: string, 
    nunotaempenho?: string, 
    cdunidadegestora?: string, 
    bypassMirror: boolean = false,
    queryId?: string
  ): Promise<SigefResponse<OrdemBancaria>> {
    this._loading.set(true);
    this._error.set(null);

    if (!bypassMirror && page === 1) {
      if (nuordembancaria) {
        const cachedItems = await this.cacheService.getRawMirrorList('OB', 'nuordembancaria', nuordembancaria);
        if (cachedItems && cachedItems.length > 0) {
          console.log(`[SIGEF RAW MIRROR] OB ${nuordembancaria} encontrada no espelho (${cachedItems.length} itens).`);
          return { data: cachedItems, count: cachedItems.length, next: null, previous: null };
        }
      }
      
      if (nunotaempenho) {
        const cachedList = await this.cacheService.getRawMirrorList('OB', 'nunotaempenho', nunotaempenho, cdunidadegestora);
        if (cachedList && cachedList.length > 0) {
          console.log(`[SIGEF RAW MIRROR] OB_LIST para ${nunotaempenho} encontrada no espelho (${cachedList.length} itens).`);
          return { data: cachedList, count: cachedList.length, next: null, previous: null };
        }
      }
    }

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
      }, 5, 5000, queryId);

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 499) {
          throw new Error('Query cancelled');
        }
        if (response.status >= 500) {
          console.warn('[SIGEF OB] Erro 5xx da API, retornando vazio:', response.status);
          return { data: [], count: 0, next: null, previous: null };
        }
        throw new Error(`Erro na API: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('[SIGEF OB] Response data:', JSON.stringify(data).substring(0, 500));

      // Salvar cada item individualmente no espelho bruto (General Mirror)
      // Usamos identificador composto para não sobrescrever itens diferentes da mesma OB
      if (data.results && data.results.length > 0) {
        const itemsWithId = data.results.map((item: any) => ({
          ...item,
          _composite_id: `${item.nuordembancaria}-${item.cdunidadegestora}-${item.nudocumento || ''}`
        }));
        await this.cacheService.saveRawMirrorBulk(itemsWithId, 'OB', '_composite_id', undefined);
      }

      return {
        data: (data.results || []) as OrdemBancaria[],
        count: data.count || 0,
        next: data.next,
        previous: data.previous
      };
    } catch (err: any) {
      if (this._isRetryableError(err)) {
        console.warn('[SIGEF OB] Erro de rede, retornando vazio:', this._extractErrorMessage(err));
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
    * IMPLEMENTAÇÃO OTIMIZADA COM ESPELHO:
    * 1. Busca no cache local primeiro.
    * 2. Busca na API apenas o período que pode ter novos dados (incremental).
    */
   async getOrdemBancariaMovements(
     ano: string, 
     numeroNEs: string[], 
     cdunidadegestora: string, 
     bypassMirror: boolean = false,
     queryId?: string
   ): Promise<OrdemBancaria[]> {
     console.log('=== [SIGEF SERVICE] getOrdemBancariaMovements (MIRROR OPTIMIZED) ===', { ano, numeroNEs, ug: cdunidadegestora, bypassMirror, queryId });
     
     const allOBs: OrdemBancaria[] = [];
     const ugNum = parseInt(cdunidadegestora, 10);

     for (const neNumber of numeroNEs) {
       if (!neNumber) continue;
       
       // Verifica se a consulta foi cancelada
       if (queryId && !this.pendingQueries.has(queryId)) {
         console.log(`[SIGEF OB] Consulta cancelada durante processamento da NE ${neNumber}`);
         break;
       }

       const targetNE = neNumber.trim().toUpperCase();
       
       // 1. Tentar carregar do espelho bruto (Raw Mirror)
       if (!bypassMirror) {
         const rawMirrorList = await this.cacheService.getRawMirrorList('OB', 'nunotaempenho', targetNE);
         if (rawMirrorList && rawMirrorList.length > 0) {
            console.log(`[SIGEF RAW MIRROR] Usando dados brutos do espelho para OB_LIST da NE ${targetNE} (${rawMirrorList.length} itens)`);
            allOBs.push(...rawMirrorList);
            continue; 
         }
       }

       // 2. Tentar carregar o "espelho" processado (cache local legado)
       const cachedOBs = await this.cacheService.getOrdensBancariasPorNe(ugNum, targetNE);
       
       // Mapear para o tipo OrdemBancaria da API
       const mappedCached = cachedOBs.map(ob => ({
         nuordembancaria: ob.nuordembancaria,
         cdunidadegestora: ob.cdunidadegestora,
         cdgestao: ob.cdgestao || null,
         cdevento: ob.cdevento || null,
         nudocumento: ob.nudocumento || null,
         nunotaempenho: ob.nunotaempenho || null,
         cdcredor: ob.cdcredor || null,
         cdtipocredor: ob.cdtipocredor || null,
         cdugfavorecida: ob.cdugfavorecida || null,
         cdorgao: ob.cdorgao || null,
         cdsubacao: ob.cdsubacao || null,
         cdfuncao: ob.cdfuncao || null,
         cdsubfuncao: ob.cdsubfuncao || null,
         cdprograma: ob.cdprograma || null,
         cdacao: ob.cdacao || null,
         localizagasto: ob.localizagasto || null,
         cdnaturezadespesa: ob.cdnaturezadespesa || null,
         cdfonte: ob.cdfonte || null,
         cdmodalidade: ob.cdmodalidade || null,
         vltotal: ob.vltotal || null,
         dtlancamento: ob.dtlancamento || null,
         dtpagamento: ob.dtpagamento || null,
         definalidade: ob.definalidade || null,
         nuguiarecebimento: ob.nuguiarecebimento || null,
         vlguiarecebimento: ob.vlguiarecebimento ? ob.vlguiarecebimento.toString() : null,
         nunotalancamento: ob.nunotalancamento || null,
         numns: ob.numns || null,
         deobservacao: ob.deobservacao || null,
         domicilio_origem: ob.domicilio_origem || null,
         domicilio_destino: ob.domicilio_destino || null,
         cdsituacaoordembancaria: ob.cdsituacaoordembancaria || null,
         situacaopreparacaopagamento: ob.situacaopreparacaopagamento || null,
         tipoordembancaria: ob.tipoordembancaria || null,
         tipopreparacaopagamento: ob.tipopreparacaopagamento || null,
         usuario_responsavel: ob.usuario_responsavel || null
       } as OrdemBancaria));

       allOBs.push(...mappedCached);

       // 3. Determinar se precisamos buscar na API (Sincronização Incremental)
       const anoNE = parseInt(ano, 10);
       const anoAtual = new Date().getFullYear();

       for (let a = anoNE; a <= anoAtual; a++) {
         // Verifica se a consulta foi cancelada
         if (queryId && !this.pendingQueries.has(queryId)) {
           console.log(`[SIGEF OB] Consulta cancelada durante busca incremental da NE ${targetNE}`);
           break;
         }

         const datainicio = `${a}-01-01`;
         const datafim = `${a}-12-31`;
         
         try {
           const result = await this.getOrdemBancaria(datainicio, datafim, 1, undefined, targetNE, cdunidadegestora, bypassMirror, queryId);
           
           if (result.data.length > 0) {
             const filteredMatches = result.data.filter(ob => {
               const isTargetNe = (ob.nunotaempenho || '').trim().toUpperCase() === targetNE;
               return isTargetNe;
             });
             for (const apiOb of filteredMatches) {
               const alreadyHas = allOBs.some(c => c.nuordembancaria === apiOb.nuordembancaria && c.nudocumento === apiOb.nudocumento);
               if (!alreadyHas) allOBs.push(apiOb);
             }
           }

           let page = 2;
           let nextUrl = result.next;
           while (nextUrl && page <= 10) {
             if (queryId && !this.pendingQueries.has(queryId)) {
               console.log(`[SIGEF OB] Consulta cancelada durante paginação da NE ${targetNE}`);
               break;
             }

             const nextResult = await this.getOrdemBancaria(datainicio, datafim, page, undefined, targetNE, cdunidadegestora, bypassMirror, queryId);
               const nextMatches = nextResult.data.filter(ob => {
                 const isTargetNe = (ob.nunotaempenho || '').trim().toUpperCase() === targetNE;
                 return isTargetNe;
               });
              for (const apiOb of nextMatches) {
                 const alreadyHas = allOBs.some(c => c.nuordembancaria === apiOb.nuordembancaria && c.nudocumento === apiOb.nudocumento);
                 if (!alreadyHas) allOBs.push(apiOb);
              }
              nextUrl = nextResult.next;
              page++;
           }
         } catch (err: any) {
           if (err.message === 'Query cancelled') {
             console.log(`[SIGEF OB] Consulta cancelada para NE ${targetNE}`);
             break;
           }
           console.warn(`[SIGEF OB] Erro no ano ${a} para NE ${targetNE}. Pulando...`, err);
         }
       }

       if (queryId && !this.pendingQueries.has(queryId)) {
         break; // Sai do loop de NEs se cancelado
       }
     }
     
     // Deduplicação final
     const uniqueMap = new Map<string, OrdemBancaria>();
     allOBs.forEach(ob => {
       const key = `${ob.nuordembancaria}-${ob.cdunidadegestora}-${ob.nudocumento || ''}-${ob.vltotal}`;
       uniqueMap.set(key, ob);
     });
     
     return Array.from(uniqueMap.values());
   }

  /**
   * Busca uma Ordem Bancária específica pelo número, usando lógica de espelho (Cache-First).
   * Suporta cancelamento via queryId.
   */
  async getOrdemBancariaByNumberWithMirror(
    nuOB: string, 
    ug: string, 
    queryId?: string
  ): Promise<OrdemBancaria | null> {
    const ugNum = parseInt(ug, 10);
    const cleanOB = nuOB.trim().toUpperCase();

    // 1. Tentar o espelho (Cache)
    const cached = await this.cacheService.getOrdemBancaria(cleanOB, ugNum);
    if (cached) {
      console.log(`[SIGEF MIRROR] OB ${cleanOB} encontrada no espelho.`);
      return this.mapCacheToApiOb(cached);
    }

    // 2. Se não encontrar, busca na API (Pesquisa Direta)
    console.log(`[SIGEF MIRROR] OB ${cleanOB} não encontrada no espelho. Buscando na API...`);
    const ano = cleanOB.substring(0, 4); // Assume que os 4 primeiros dígitos são o ano (padrão 2026OB...)
    const datainicio = `${ano}-01-01`;
    const datafim = `${ano}-12-31`;

    try {
      const result = await this.getOrdemBancaria(datainicio, datafim, 1, cleanOB, undefined, ug, false, queryId);
      
      // Verifica se a consulta foi cancelada
      if (queryId && !this.pendingQueries.has(queryId)) {
        console.log(`[SIGEF MIRROR] Consulta da OB ${cleanOB} cancelada.`);
        return null;
      }

      const found = result.data.find(ob => 
        (ob.nuordembancaria?.toUpperCase() === cleanOB || ob.nudocumento?.toUpperCase() === cleanOB) && 
        Number(ob.cdunidadegestora) === ugNum
      );

      if (found) {
        // Salva no espelho para futuras consultas
        await this.cacheService.saveOrdemBancaria(this.mapApiObToCache(found, ugNum));
        return found;
      }
    } catch (err: any) {
      if (err.message === 'Query cancelled') {
        console.log(`[SIGEF MIRROR] Consulta da OB ${cleanOB} cancelada.`);
        return null;
      }
      console.error(`[SIGEF MIRROR] Erro ao buscar OB ${cleanOB} na API:`, err);
    }

    return null;
  }

  private mapCacheToApiOb(ob: any): OrdemBancaria {
    return {
      nuordembancaria: ob.nuordembancaria,
      cdunidadegestora: ob.cdunidadegestora,
      cdgestao: ob.cdgestao || null,
      cdevento: ob.cdevento || null,
      nudocumento: ob.nudocumento || null,
      nunotaempenho: ob.nunotaempenho || null,
      cdcredor: ob.cdcredor || null,
      cdtipocredor: ob.cdtipocredor || null,
      cdugfavorecida: ob.cdugfavorecida || null,
      cdorgao: ob.cdorgao || null,
      cdsubacao: ob.cdsubacao || null,
      cdfuncao: ob.cdfuncao || null,
      cdsubfuncao: ob.cdsubfuncao || null,
      cdprograma: ob.cdprograma || null,
      cdacao: ob.cdacao || null,
      localizagasto: ob.localizagasto || null,
      cdnaturezadespesa: ob.cdnaturezadespesa || null,
      cdfonte: ob.cdfonte || null,
      cdmodalidade: ob.cdmodalidade || null,
      vltotal: ob.vltotal || null,
      dtlancamento: ob.dtlancamento || null,
      dtpagamento: ob.dtpagamento || null,
      definalidade: ob.definalidade || null,
      nuguiarecebimento: ob.nuguiarecebimento || null,
      vlguiarecebimento: ob.vlguiarecebimento ? ob.vlguiarecebimento.toString() : null,
      nunotalancamento: ob.nunotalancamento || null,
      numns: ob.numns || null,
      deobservacao: ob.deobservacao || null,
      domicilio_origem: ob.domicilio_origem || null,
      domicilio_destino: ob.domicilio_destino || null,
      cdsituacaoordembancaria: ob.cdsituacaoordembancaria || null,
      situacaopreparacaopagamento: ob.situacaopreparacaopagamento || null,
      tipoordembancaria: ob.tipoordembancaria || null,
      tipopreparacaopagamento: ob.tipopreparacaopagamento || null,
      usuario_responsavel: ob.usuario_responsavel || null
    };
  }

  private mapApiObToCache(ob: OrdemBancaria, ug: number): any {
    return {
      nuordembancaria: ob.nuordembancaria || '',
      cdunidadegestora: ug,
      nunotaempenho: ob.nunotaempenho || undefined,
      cdgestao: ob.cdgestao || undefined,
      cdevento: ob.cdevento || undefined,
      nudocumento: ob.nudocumento || undefined,
      cdcredor: ob.cdcredor || undefined,
      cdtipocredor: ob.cdtipocredor || undefined,
      cdugfavorecida: ob.cdugfavorecida || undefined,
      cdorgao: ob.cdorgao || undefined,
      cdsubacao: ob.cdsubacao || undefined,
      cdfuncao: ob.cdfuncao || undefined,
      cdsubfuncao: ob.cdsubfuncao || undefined,
      cdprograma: ob.cdprograma || undefined,
      cdacao: ob.cdacao || undefined,
      localizagasto: ob.localizagasto || undefined,
      cdnaturezadespesa: ob.cdnaturezadespesa || undefined,
      cdfonte: ob.cdfonte || undefined,
      cdmodalidade: ob.cdmodalidade || undefined,
      vltotal: ob.vltotal || 0,
      dtlancamento: ob.dtlancamento || undefined,
      dtpagamento: ob.dtpagamento || undefined,
      cdsituacaoordembancaria: ob.cdsituacaoordembancaria || undefined,
      situacaopreparacaopagamento: ob.situacaopreparacaopagamento || undefined,
      tipoordembancaria: ob.tipoordembancaria || undefined,
      tipopreparacaopagamento: ob.tipopreparacaopagamento || undefined,
      deobservacao: ob.deobservacao || undefined,
      definalidade: ob.definalidade || undefined,
      usuario_responsavel: ob.usuario_responsavel || undefined
    };
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

  async authenticate(username: string, password: string, retries: number = 5, backoff: number = 3000): Promise<string> {
    this._loading.set(true);
    this._error.set(null);
    this._apiStatus.set('refreshing');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
      const url = `${this.apiUrl}/token/`;
      console.log('[SIGEF AUTH] URL completa:', url);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
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
      
      this.persistTokens();
      this._authenticated.set(true);
      this._apiStatus.set('connected');
      this.updateExpiresAt();
      return data.access;
    } catch (err: any) {
      clearTimeout(timeoutId);
      const errLower = (err.message || err.name || '').toLowerCase();
      const isTimeout = err.name === 'AbortError' || errLower.includes('timeout') || errLower.includes('etimedout') || errLower.includes('aborted');
      
      if (retries > 0 && isTimeout) {
        console.warn(`[SIGEF] Timeout no login (${err.message}). Backoff ${backoff}ms, retries: ${retries}`);
        await new Promise(r => setTimeout(r, backoff));
        return this.authenticate(username, password, retries - 1, Math.min(backoff * 2, 60000));
      }
      
      console.error('[SIGEF AUTH] Erro capturado:', err);
      this._error.set(err.message || 'Erro na autenticação');
      this._authenticated.set(false);
      this._apiStatus.set('disconnected');
      localStorage.removeItem(this.ACCESS_TOKEN_KEY);
      localStorage.removeItem(this.REFRESH_TOKEN_KEY);
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  async reconnect(): Promise<void> {
    await this.ensureAuthenticated(true);
  }
}
