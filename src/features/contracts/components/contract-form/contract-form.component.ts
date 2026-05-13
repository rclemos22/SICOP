import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, input, output, signal, computed, effect } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router } from '@angular/router';
import { CurrencyUtils } from '../../../../app/shared/utils/currency-utils';
import { SupplierService } from '../../../suppliers/services/supplier.service';
import { Supplier } from '../../../../shared/models/supplier.model';
import { SupabaseService } from '../../../../core/services/supabase.service';

interface UnidadeGestora {
  codigo: string;
  nome: string;
}

@Component({
  selector: 'app-contract-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './contract-form.component.html',
})
export class ContractFormComponent implements OnInit {
  private fb: FormBuilder = inject(FormBuilder);
  private supplierService = inject(SupplierService);
  private supabaseService = inject(SupabaseService);
  private router = inject(Router);
  
  // Input para edição
  contract = input<any | null>(null);
  
  // Outputs
  close = output<void>();
  cancel = output<void>();
  save = output<any>();

  // Helper to check if editing
  isEditing = computed(() => !!this.contract());

  // Unidade Gestora - mesma da Nota de Empenho
  unidadesGestoras: UnidadeGestora[] = [
    { codigo: '080101', nome: 'DPEMA' },
    { codigo: '080901', nome: 'FADEP' }
  ];

  // Setores - carregados do banco
  setores = signal<Array<{ id: string, name: string }>>([]);
  
  statusOptions = ['VIGENTE', 'ASSINADO', 'EM ELABORAÇÃO'];

  tipoOptions = [
    { value: 'serviço', label: 'Serviço' },
    { value: 'material', label: 'Material' }
  ];

  // Fornecedor search
  supplierSearch = signal('');
  supplierResults = signal<Supplier[]>([]);
  showSupplierDropdown = signal(false);
  selectedSupplier = signal<Supplier | null>(null);
  showSupplierModal = signal(false);
  
  // Temporary supplier form for modal
  tempSupplier = this.fb.group({
    razao_social: ['', Validators.required],
    nome_fantasia: ['', Validators.required],
    cnpj: ['', Validators.required],
    email: [''],
    telefone: [''],
    categoria: [''],
    endereco: [''],
    status: ['ACTIVE']
  });

  // Listener para o campo Tipo
  private setupTipoListener() {
    this.contractForm.get('tipo')?.valueChanges.subscribe(tipo => {
      const monthlyControl = this.contractForm.get('monthlyValue');
      if (tipo === 'serviço') {
        monthlyControl?.enable();
      } else {
        monthlyControl?.disable();
        monthlyControl?.setValue('');
      }
    });
  }

  ngOnInit() {
    this.supplierService.loadSuppliers();
    this.loadSetores();
    this.setupTipoListener();
  }

  // Effect para preencher o formulário quando em modo edição
  constructor() {
    effect(() => {
      const c = this.contract();
      if (c) {
        console.log('[ContractForm] Mode edit, contract:', c);
        this.populateFormWithContract(c);
      }
    });
  }

  private populateFormWithContract(c: any) {
    console.log('[ContractForm] populateFormWithContract - c:', c);
    
    const supplierName = c.fornecedor_nome || c.contratada || c.supplier || '';
    
    // Vincular fornecedor ao sinalizador para exibir indicador visual
    this.selectedSupplier.set({ 
      id: c.fornecedor_id, 
      razao_social: supplierName
    } as any);

    // IMPORTANTE: Atualizar o campo de busca que é exibido no template [value]="supplierSearch()"
    this.supplierSearch.set(supplierName);

    this.contractForm.patchValue({
      number: c.contrato || '',
      processNumber: c.processo_sei || '',
      linkSei: c.link_sei || '',
      supplier: supplierName,
      fornecedor_id: c.fornecedor_id || '',
      cnpjContratada: c.cnpj_contratada || '',
      object: c.objeto || '',
      startDate: c.data_inicio ? new Date(c.data_inicio).toISOString().split('T')[0] : '',
      endDate: c.data_fim ? new Date(c.data_fim).toISOString().split('T')[0] : '',
      paymentDate: c.data_pagamento || '',
      totalValue: CurrencyUtils.formatBRL(c.valor_anual),
      monthlyValue: c.valor_mensal ? CurrencyUtils.formatBRL(c.valor_mensal) : '',
      unid_gestora: c.unid_gestora || '',
      department: c.setor_id || c.setor || '',
      status: c.status || 'VIGENTE',
      gestor_contrato: c.gestor_contrato || '',
      fiscal_admin: c.fiscal_admin || '',
      fiscal_tecnico: c.fiscal_tecnico || '',
      tipo: c.tipo || ''
    });

    // Se for edição e o tipo for serviço, garante que o campo mensal esteja habilitado
    if (c.tipo === 'serviço') {
      this.contractForm.get('monthlyValue')?.enable();
    } else {
      this.contractForm.get('monthlyValue')?.disable();
    }
  }

  async loadSetores() {
    const { data, error } = await this.supabaseService.client
      .from('setores')
      .select('*')
      .order('nome');
    
    if (!error && data && data.length > 0) {
      // Detectar quais colunas existem
      const firstRow = data[0];
      const nomeCol = firstRow.nome !== undefined ? 'nome' : firstRow.descricao !== undefined ? 'descricao' : 'nome';
      const ativoCol = firstRow.ativo !== undefined ? 'ativo' : (firstRow.status !== undefined ? 'status' : null);
      
      const setoresMap = data
        .filter(s => !ativoCol || s[ativoCol] === true || s[ativoCol] === 'true' || s[ativoCol] === 1)
        .map(s => ({
          id: s.id, // UUID real do banco
          name: String(s[nomeCol]).replace('_', ' ')
        }));
      this.setores.set(setoresMap);
    } else {
      // Fallback para lista hardcoded se a tabela não existir ou estiver vazia
      this.setores.set([
        { id: null as any, name: 'GABINETE' },
        { id: null as any, name: 'JURIDICO' },
        { id: null as any, name: 'ADMINISTRATIVO' },
        { id: null as any, name: 'FINANCEIRO' },
        { id: null as any, name: 'COMPRAS' },
        { id: null as any, name: 'TECNOLOGIA' },
        { id: null as any, name: 'RECURSOS_HUMANOS' },
        { id: null as any, name: 'LICITACOES' }
      ]);
    }
  }

  contractForm: FormGroup = this.fb.group({
    // Identification
    number: ['', Validators.required],
    processNumber: ['', Validators.required],
    linkSei: [''],
    fornecedor_id: [''],
    supplier: ['', Validators.required],
    cnpjContratada: [''],
    object: ['', Validators.required],
    
    // Validity
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
    paymentDate: [''], // Dia do mês para pagamento
    
    // Financial & Classification
    totalValue: ['', [Validators.required, CurrencyUtils.currencyValidator(0.01)]],
    monthlyValue: [{ value: '', disabled: true }],
    unid_gestora: ['', Validators.required],
    department: ['', Validators.required],
    status: ['VIGENTE', Validators.required],
    tipo: ['', Validators.required],
    
    // Gestores
    gestor_contrato: [''],
    fiscal_admin: [''],
    fiscal_tecnico: ['']
  }, { validators: this.dateRangeValidator });

  // Custom Validator: End Date must be after Start Date
  private dateRangeValidator(group: AbstractControl): ValidationErrors | null {
    const start = group.get('startDate')?.value;
    const end = group.get('endDate')?.value;

    if (start && end && new Date(end) < new Date(start)) {
      return { dateRangeInvalid: true };
    }
    return null;
  }

  onCurrencyInput(event: any, controlName: string) {
    const input = event.target as HTMLInputElement;
    const masked = CurrencyUtils.applyMask(input.value);
    input.value = masked;
    this.contractForm.get(controlName)?.setValue(masked, { emitEvent: false });
  }

  // Helper for template access
  get f() { return this.contractForm.controls; }

  // ── Supplier Search ─────────────────────────────────────────────────────────
  onSupplierInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.supplierSearch.set(value);
    
    if (value.length >= 2) {
      const results = this.supplierService.suppliers().filter(s => 
        s.razao_social.toLowerCase().includes(value.toLowerCase()) ||
        s.nome_fantasia.toLowerCase().includes(value.toLowerCase()) ||
        s.cnpj.includes(value)
      );
      this.supplierResults.set(results);
      this.showSupplierDropdown.set(results.length > 0);
    } else {
      this.supplierResults.set([]);
      this.showSupplierDropdown.set(false);
    }
  }

  selectSupplier(supplier: Supplier) {
    this.selectedSupplier.set(supplier);
    this.contractForm.patchValue({
      supplier: supplier.nome_fantasia || supplier.razao_social,
      fornecedor_id: supplier.id,
      cnpjContratada: supplier.cnpj || ''
    });
    this.supplierSearch.set(supplier.nome_fantasia || supplier.razao_social);
    this.showSupplierDropdown.set(false);
  }

  openNewSupplierModal() {
    const searchValue = this.supplierSearch();
    this.tempSupplier.patchValue({
      razao_social: searchValue,
      nome_fantasia: searchValue
    });
    this.showSupplierModal.set(true);
    this.showSupplierDropdown.set(false);
  }

  closeSupplierModal() {
    this.showSupplierModal.set(false);
    this.tempSupplier.reset();
  }

  async saveNewSupplier() {
    if (this.tempSupplier.valid) {
      const supplierData = this.tempSupplier.value;
      const result = await this.supplierService.addSupplier({
        razao_social: supplierData.razao_social || '',
        nome_fantasia: supplierData.nome_fantasia || '',
        cnpj: supplierData.cnpj || '',
        email: supplierData.email || '',
        telefone: supplierData.telefone || '',
        categoria: supplierData.categoria || '',
        endereco: supplierData.endereco || '',
        status: (supplierData.status as any) || 'ACTIVE',
        desde: new Date()
      });
      
      if (!result.error) {
        await this.supplierService.loadSuppliers();
        const newSupplier = this.supplierService.suppliers().find(
          s => s.cnpj === supplierData.cnpj || s.razao_social === supplierData.razao_social
        );
        
        if (newSupplier) {
          this.selectSupplier(newSupplier);
        }
      }
      this.closeSupplierModal();
    }
  }

  onSubmit() {
    if (this.contractForm.valid) {
      const formData = { ...this.contractForm.value };
      
      // Converte valores formatados em números puros antes de emitir
      formData.totalValue = CurrencyUtils.parseBRL(formData.totalValue) || 0;
      formData.monthlyValue = formData.monthlyValue ? CurrencyUtils.parseBRL(formData.monthlyValue) : null;
      
      // Tratamento do Dia de Pagamento (garantir que seja número ou null)
      if (formData.paymentDate && formData.paymentDate !== '') {
        formData.data_pagamento = Number(formData.paymentDate);
      } else {
        formData.data_pagamento = null;
      }
      
      // Limpeza de campos temporários ou disparidade de nomes
      delete formData.paymentDate;

      console.log('Emitindo dados do contrato para salvamento:', formData);
      this.save.emit(formData);
      this.router.navigate(['/contracts']);
    } else {
      this.contractForm.markAllAsTouched();
      alert('Por favor, corrija os erros no formulário antes de salvar.');
    }
  }

  onCancel() {
    this.close.emit();
    this.cancel.emit();
    this.router.navigate(['/contracts']);
  }
}