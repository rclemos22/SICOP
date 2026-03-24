import { CommonModule } from '@angular/common';
import { Component, inject, input, output, OnInit, signal, effect } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { BudgetService } from '../../services/budget.service';
import { SigefService, NotaEmpenho } from '../../../../core/services/sigef.service';
import { Dotacao } from '../../../../shared/models/budget.model';

@Component({
  selector: 'app-dotacao-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg mx-auto overflow-hidden">
      
      <!-- Header -->
      <div class="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-between">
        <h2 class="text-lg font-bold text-slate-900 dark:text-white">
          {{ isEditing ? 'Editar Dotação' : 'Nova Dotação' }}
        </h2>
        <button type="button" (click)="onCancel()" class="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <!-- Form Content -->
      <form [formGroup]="dotacaoForm" (ngSubmit)="onSubmit()" class="p-6 space-y-5">
        
        <!-- Dotação e UG -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">Código Dotação</label>
            <input formControlName="dotacao" type="text"
              class="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-500 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-slate-700 dark:text-white text-slate-900">
            @if (f['dotacao'].invalid && f['dotacao'].touched) {
              <p class="text-xs text-red-500 mt-1">Obrigatório.</p>
            }
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">Unidade Gestora</label>
            <select formControlName="unid_gestora"
              class="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-500 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-slate-700 dark:text-white">
              <option value="">Selecione a UG</option>
              <option value="080101">080101 - DPEMA</option>
              <option value="080901">080901 - FADEP</option>
            </select>
            @if (f['unid_gestora'].invalid && f['unid_gestora'].touched) {
              <p class="text-xs text-red-500 mt-1">Selecione uma UG.</p>
            }
          </div>
        </div>

        <!-- Crédito e Data -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">Tipo de Crédito</label>
            <input formControlName="credito" type="text"
              class="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-500 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-slate-700 dark:text-white text-slate-900">
            @if (f['credito'].invalid && f['credito'].touched) {
              <p class="text-xs text-red-500 mt-1">Obrigatório.</p>
            }
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">Data Disponibilidade</label>
            <input formControlName="data_disponibilidade" type="date"
              class="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-500 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-slate-700 dark:text-white text-slate-900">
          </div>
        </div>

        <!-- Valor Dotação -->
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">Valor da Dotação (R$)</label>
          <input formControlName="valor_dotacao" type="number" step="0.01"
            class="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-500 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-slate-700 dark:text-white text-slate-900">
          @if (f['valor_dotacao'].invalid && f['valor_dotacao'].touched) {
            <p class="text-xs text-red-500 mt-1">Valor deve ser maior que zero.</p>
          }
        </div>

        <!-- Nota de Empenho -->
        <div class="border-t border-slate-200 dark:border-slate-600 pt-4">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-2">Vincular Nota de Empenho</label>
          
          <div class="flex gap-2">
            <input 
              type="text" 
              [value]="searchNE()"
              (input)="searchNE.set($any($event.target).value)"
              placeholder="Ex: 2026NE000302"
              class="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-500 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none dark:bg-slate-700 dark:text-white uppercase"
            >
            <button 
              type="button"
              (click)="buscarNotaEmpenho()"
              [disabled]="searchingNE() || !searchNE()"
              class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium whitespace-nowrap"
            >
              {{ searchingNE() ? 'Buscando...' : 'Buscar' }}
            </button>
          </div>

          @if (neError()) {
            <p class="text-xs text-red-500 mt-2">{{ neError() }}</p>
          }

          @if (notaEmpenhoResult(); as ne) {
            <div class="mt-3 p-3 bg-green-100 dark:bg-green-900/30 border border-green-300 rounded-lg">
              <p class="text-sm font-bold text-green-800 dark:text-green-300">{{ ne.nunotaempenho }}</p>
              <p class="text-xs text-green-700 dark:text-green-400">Valor: {{ ne.vlnotaempenho | currency:'BRL':'symbol':'1.2-2' }}</p>
            </div>
          }
        </div>

      </form>

      <!-- Footer Actions -->
      <div class="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 flex gap-3 rounded-b-lg">
        @if (isEditing) {
          <button type="button" (click)="deleteDotacao()"
            class="px-4 py-2.5 text-sm font-semibold text-red-600 bg-red-100 border border-red-300 rounded-lg hover:bg-red-200 flex items-center gap-1">
            <span class="material-symbols-outlined text-[18px]">delete</span>
            Excluir
          </button>
        }
        <button type="button" (click)="onCancel()"
          class="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">
          Cancelar
        </button>
        <button type="button" (click)="onSubmit()"
          class="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center justify-center gap-2">
          <span class="material-symbols-outlined text-[18px]">{{ isEditing ? 'save' : 'add' }}</span>
          {{ isEditing ? 'Salvar' : 'Adicionar' }}
        </button>
      </div>
    </div>
  `
})
export class DotacaoFormComponent implements OnInit {
  private fb: FormBuilder = inject(FormBuilder);
  private budgetService = inject(BudgetService);
  private sigefService = inject(SigefService);

  contractId = input.required<string>();
  numeroContrato = input.required<string>();
  editingDotacao = input<Dotacao | null>(null);
  save = output<any>();
  cancel = output<void>();

  dotacaoForm: FormGroup;
  searchNE = signal('');
  notaEmpenhoResult = signal<NotaEmpenho | null>(null);
  searchingNE = signal(false);
  neError = signal<string | null>(null);

  constructor() {
    this.dotacaoForm = this.fb.group({
      dotacao: ['', Validators.required],
      credito: ['', Validators.required],
      data_disponibilidade: ['', Validators.required],
      unid_gestora: ['', Validators.required],
      valor_dotacao: [0, [Validators.required, Validators.min(0.01)]],
      nunotaempenho: ['']
    });

    effect(() => {
      const dot = this.editingDotacao();
      console.log('[DotacaoForm] Effect executado, dotacao:', dot?.dotacao);
      if (dot) {
        this.dotacaoForm.patchValue({
          dotacao: dot.dotacao,
          credito: dot.credito,
          data_disponibilidade: dot.data_disponibilidade ? new Date(dot.data_disponibilidade).toISOString().split('T')[0] : '',
          unid_gestora: dot.unid_gestora,
          valor_dotacao: dot.valor_dotacao,
          nunotaempenho: dot.nunotaempenho || ''
        });
        if (dot.nunotaempenho) {
          this.searchNE.set(dot.nunotaempenho);
        }
      } else {
        this.dotacaoForm.reset({ valor_dotacao: 0 });
        this.searchNE.set('');
        this.notaEmpenhoResult.set(null);
        this.neError.set(null);
      }
    });
  }

  ngOnInit() {
    console.log('[DotacaoForm] ngOnInit, editingDotacao:', this.editingDotacao());
  }

  get f() { return this.dotacaoForm.controls; }

  get isEditing(): boolean { return !!this.editingDotacao(); }

  async buscarNotaEmpenho() {
    const ne = this.searchNE().trim().toUpperCase();
    if (!ne) return;

    const ug = this.dotacaoForm.get('unid_gestora')?.value;
    if (!ug) {
      this.neError.set('Selecione a Unidade Gestora primeiro');
      return;
    }

    this.searchingNE.set(true);
    this.neError.set(null);
    this.notaEmpenhoResult.set(null);

    try {
      const ano = new Date().getFullYear().toString();
      const nota = await this.sigefService.getNotaEmpenhoByNumber(ano, ne, ug);
      
      if (nota) {
        this.notaEmpenhoResult.set(nota);
        this.dotacaoForm.patchValue({ nunotaempenho: nota.nunotaempenho });
      } else {
        this.neError.set('NE não encontrada para esta UG');
      }
    } catch (err: any) {
      this.neError.set(err.message || 'Erro ao buscar NE');
    } finally {
      this.searchingNE.set(false);
    }
  }

  async onSubmit() {
    console.log('[DotacaoForm] onSubmit, form valid:', this.dotacaoForm.valid);
    
    if (this.dotacaoForm.valid) {
      const formData = this.dotacaoForm.value;
      const dotacaoToSave = {
        contract_id: this.contractId(),
        numero_contrato: this.numeroContrato(),
        ...formData
      };
      
      try {
        let result;
        if (this.isEditing) {
          result = await this.budgetService.updateDotacao(this.editingDotacao()!.id, dotacaoToSave);
        } else {
          result = await this.budgetService.addDotacao(dotacaoToSave);
        }
        
        if (result.error) {
          console.error('[DotacaoForm] Erro ao salvar:', result.error);
          alert('Erro ao salvar dotação: ' + result.error);
          return;
        }
        
        console.log('[DotacaoForm] Salvo com sucesso');
        this.save.emit(null);
      } catch (err) {
        console.error('Erro ao salvar dotação:', err);
        alert('Erro ao salvar dotação');
      }
    } else {
      this.dotacaoForm.markAllAsTouched();
    }
  }

  onCancel() {
    this.cancel.emit();
  }

  async deleteDotacao() {
    if (this.isEditing && this.editingDotacao() && confirm('Confirmar exclusão desta dotação?')) {
      try {
        const result = await this.budgetService.deleteDotacao(this.editingDotacao()!.id);
        if (result.error) {
          console.error('[DotacaoForm] Erro ao excluir:', result.error);
          alert('Erro ao excluir dotação: ' + result.error);
          return;
        }
        this.save.emit(null);
      } catch (err) {
        console.error('Erro ao excluir dotação:', err);
        alert('Erro ao excluir dotação');
      }
    }
  }
}
