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

  // Semáforo para controle de concorrência global (apenas 1 requisição por vez na API do SIGEF)
  private apiQueue: Promise<any> = Promise.resolve();

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
      // Se a API retornar um novo refresh token (rotação), atualizamos
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
      if (retries > 0 && err.message?.includes('ETIMEDOUT')) {
        console.warn(`[SIGEF] Timeout no refresh. Retentando... (${retries} restantes)`);
        await new Promise(r => setTimeout(r, 2000));
        return this.refreshAccessToken(retries - 1);
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

  private async callApi(url: string, options: RequestInit = {}, retries: number = 5, backoff: number = 3000): Promise<Response> {
    // Enfileiramento global: cada nova chamada espera a anterior terminar
    return this.apiQueue = this.apiQueue.then(async () => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 120000); // 120 segundos de timeout individual

      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        
        // Auto-reautenticação em caso de expiração
        if (response.status === 401 || response.status === 403) {
          await this.handleUnauthorized();
          const newOptions = { ...options, headers: this.getHeaders() };
          return await this.callApi(url, newOptions, retries);
        }

        // Erros transientes de Gateway/Server
        if ([500, 502, 503, 504].includes(response.status) && retries > 0) {
          console.warn(`[SIGEF] Gateway Error (${response.status}). Backoff ${backoff}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          return this.callApi(url, options, retries - 1, backoff * 1.5);
        }
        
        // Pequeno delay "de cortesia" após cada sucesso para não bombardear a API
        await new Promise(resolve => setTimeout(resolve, 300));
        
        return response;
      } catch (err: any) {
        clearTimeout(id);
        const errLower = (err.message || '').toLowerCase();
        const isTimeout = err.name === 'AbortError' || errLower.includes('timeout') || errLower.includes('etimedout');
        const isNetworkError = isTimeout ||
                               errLower.includes('network') || 
                               errLower.includes('socket') || 
                               errLower.includes('disconnected') ||
                               errLower.includes('tls') ||
                               errLower.includes('handshake') ||
                               errLower.includes('connection reset') ||
                               errLower.includes('failed to fetch');
        
        if (isNetworkError && retries > 0) {
          const infraBackoff = backoff * (errLower.includes('tls') || errLower.includes('socket') ? 3 : 2);
          console.warn(`[SIGEF] Infra Error (${err.message}). Retrying in ${infraBackoff}ms...`);
          await new Promise(resolve => setTimeout(resolve, infraBackoff));
          return this.callApi(url, options, retries - 1, infraBackoff * 1.5);
        }
        throw err;
      }
    });
  }

  async getNotaEmpenho(ano: string, search?: string, page: number = 1, cdunidadegestora?: string, bypassMirror: boolean = false): Promise<SigefResponse<NotaEmpenho>> {
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
      });

      if (!response.ok) {
        const errorText = await response.text();
        this._apiStatus.set('error');
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

  async getNotaEmpenhoByNumber(ano: string, numeroNE: string, cdunidadegestora?: string, bypassMirror: boolean = false): Promise<NotaEmpenho | null> {
    console.log('[SIGEF] Buscando NE específica via busca:', numeroNE, 'ano:', ano, 'bypassMirror:', bypassMirror);
    
    // Otimização: Usar search=numeroNE para evitar varredura de páginas
    const result = await this.getNotaEmpenho(ano, numeroNE, 1, cdunidadegestora, bypassMirror);
    
    let found = result.data.find(ne => 
      ne.nunotaempenho === numeroNE && 
      (!cdunidadegestora || ne.cdunidadegestora === cdunidadegestora)
    );

    if (found) return found;

    // Se não achou na busca direta (comportamento inconsistente da API às vezes), tenta scan limitado
    if (result.count > result.data.length) {
      let page = 2;
      const MAX_SCAN = 5; // Máximo 5 páginas de scan para evitar sobrecarga
      while (page <= MAX_SCAN) {
        console.log(`[SIGEF] Scan Fallback - Pagina ${page}...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Delay longo entre páginas de scan
        const pResult = await this.getNotaEmpenho(ano, undefined, page, cdunidadegestora);
        
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

  async getNotaEmpenhoMovements(ano: string, numeroNE: string, cdunidadegestora: string, bypassMirror: boolean = false): Promise<NotaEmpenho[]> {
    console.log('=== [SIGEF SERVICE] getNotaEmpenhoMovements (GENERAL MIRROR) ===');
    console.log('[SIGEF] Buscando movimentações - ano:', ano, 'numeroNE:', numeroNE, 'UG:', cdunidadegestora, 'bypassMirror:', bypassMirror);
    
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
      try {
        // Usamos o numeroNE no search para a API filtrar registros relevantes
        const result = await this.getNotaEmpenho(ano, numeroNE, page, cdunidadegestora, bypassMirror);
        
        const filtered = result.data.filter(ne => 
          (ne.nunotaempenho === numeroNE || ne.nuneoriginal === numeroNE) && 
          ne.cdunidadegestora === cdunidadegestora
        );
        
        movements.push(...filtered);
        
        if (!result.next) break;
        page++;
        // Delay de cortesia entre páginas
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        console.warn(`[SIGEF] Falha ao carregar página ${page} de movimentos para ${numeroNE}. Retornando dados parciais.`, err);
        break;
      }
    }
    
    console.log(`[SIGEF] Total de movimentações encontradas: ${movements.length}`);
    return movements;
  }

  /**
   * Consulta ordens bancárias filtradas por período.
   */
  async getOrdemBancaria(datainicio: string, datafim: string, page: number = 1, nuordembancaria?: string, nunotaempenho?: string, cdunidadegestora?: string, bypassMirror: boolean = false): Promise<SigefResponse<OrdemBancaria>> {
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
        const cachedList = await this.cacheService.getRawMirrorList('OB', 'nunotaempenho', nunotaempenho);
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

      // Remover pagamentos do mês 01 (Janeiro) - não podem ocorrer antes do empenho inicial
      if (data.results) {
        data.results = data.results.filter((ob: any) => {
          const isMesUm = (ob.dtlancamento && ob.dtlancamento.split('-')[1] === '01') || 
                          (ob.dtpagamento && ob.dtpagamento.split('-')[1] === '01');
          return !isMesUm;
        });
      }

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
      // Em caso de erro de rede ou outro, retornar vazio em vez de quebrar
      const networkErrors = ['Failed to fetch', 'NetworkError', 'socket disconnected', 'TLS', 'ECONNRESET'];
      const isNetworkError = networkErrors.some(e => err.message?.includes(e));
      
      if (isNetworkError) {
        console.warn('[SIGEF OB] Erro de rede, retornando vazio:', err.message);
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
  async getOrdemBancariaMovements(ano: string, numeroNEs: string[], cdunidadegestora: string, bypassMirror: boolean = false): Promise<OrdemBancaria[]> {
    console.log('=== [SIGEF SERVICE] getOrdemBancariaMovements (MIRROR OPTIMIZED) ===', { ano, numeroNEs, ug: cdunidadegestora, bypassMirror });
    
    const allOBs: OrdemBancaria[] = [];
    const ugNum = parseInt(cdunidadegestora, 10);

    for (const neNumber of numeroNEs) {
      if (!neNumber) continue;
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
        const datainicio = `${a}-01-01`;
        const datafim = `${a}-12-31`;
        
        try {
          const result = await this.getOrdemBancaria(datainicio, datafim, 1, undefined, targetNE, cdunidadegestora, bypassMirror);
          
          if (result.data.length > 0) {
            const filteredMatches = result.data.filter(ob => {
              const isTargetNe = (ob.nunotaempenho || '').trim().toUpperCase() === targetNE;
              const isMesUm = (ob.dtlancamento && ob.dtlancamento.split('-')[1] === '01') || (ob.dtpagamento && ob.dtpagamento.split('-')[1] === '01');
              return isTargetNe && !isMesUm;
            });
            for (const apiOb of filteredMatches) {
              const alreadyHas = allOBs.some(c => c.nuordembancaria === apiOb.nuordembancaria && c.nudocumento === apiOb.nudocumento);
              if (!alreadyHas) allOBs.push(apiOb);
            }
          }

          let page = 2;
          let nextUrl = result.next;
          while (nextUrl && page <= 10) {
             const nextResult = await this.getOrdemBancaria(datainicio, datafim, page, undefined, targetNE, cdunidadegestora, bypassMirror);
             const nextMatches = nextResult.data.filter(ob => {
               const isTargetNe = (ob.nunotaempenho || '').trim().toUpperCase() === targetNE;
               const isMesUm = (ob.dtlancamento && ob.dtlancamento.split('-')[1] === '01') || (ob.dtpagamento && ob.dtpagamento.split('-')[1] === '01');
               return isTargetNe && !isMesUm;
             });
             for (const apiOb of nextMatches) {
                const alreadyHas = allOBs.some(c => c.nuordembancaria === apiOb.nuordembancaria && c.nudocumento === apiOb.nudocumento);
                if (!alreadyHas) allOBs.push(apiOb);
             }
             nextUrl = nextResult.next;
             page++;
          }
        } catch (err) {
          console.warn(`[SIGEF OB] Erro no ano ${a} para NE ${targetNE}. Pulando...`, err);
        }
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
   */
  async getOrdemBancariaByNumberWithMirror(nuOB: string, ug: string): Promise<OrdemBancaria | null> {
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
      const result = await this.getOrdemBancaria(datainicio, datafim, 1, cleanOB, undefined, ug);
      const found = result.data.find(ob => 
        (ob.nuordembancaria?.toUpperCase() === cleanOB || ob.nudocumento?.toUpperCase() === cleanOB) && 
        Number(ob.cdunidadegestora) === ugNum
      );

      if (found) {
        // Salva no espelho para futuras consultas
        await this.cacheService.saveOrdemBancaria(this.mapApiObToCache(found, ugNum));
        return found;
      }
    } catch (err) {
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
      
      this.persistTokens();
      this._authenticated.set(true);
      this._apiStatus.set('connected');
      this.updateExpiresAt();
      return data.access;
    } catch (err: any) {
      if (retries > 0 && (err.message?.includes('ETIMEDOUT') || err.message?.includes('fetch'))) {
        console.warn(`[SIGEF] Timeout ou erro de rede no login. Retentando em 3s... (${retries} restantes)`);
        await new Promise(r => setTimeout(r, 3000));
        return this.authenticate(username, password, retries - 1);
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
