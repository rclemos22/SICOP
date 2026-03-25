import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup, AbstractControl, ValidationErrors } from '@angular/forms';
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
  
  // Outputs
  close = output<void>();
  cancel = output<void>();
  save = output<any>();

  // Unidade Gestora - mesma da Nota de Empenho
  unidadesGestoras: UnidadeGestora[] = [
    { codigo: '080101', nome: 'DPEMA' },
    { codigo: '080901', nome: 'FADEP' }
  ];

  // Setores - carregados do banco
  setores = signal<Array<{ id: string, name: string }>>([]);
  
  statusOptions = ['VIGENTE', 'ASSINADO', 'EM ELABORAÇÃO'];

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

  ngOnInit() {
    this.supplierService.loadSuppliers();
    this.loadSetores();
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
          id: s[nomeCol],
          name: String(s[nomeCol]).replace('_', ' ')
        }));
      this.setores.set(setoresMap);
    } else {
      // Fallback para lista hardcoded se a tabela não existir ou estiver vazia
      this.setores.set([
        { id: 'GABINETE', name: 'GABINETE' },
        { id: 'JURIDICO', name: 'JURIDICO' },
        { id: 'ADMINISTRATIVO', name: 'ADMINISTRATIVO' },
        { id: 'FINANCEIRO', name: 'FINANCEIRO' },
        { id: 'COMPRAS', name: 'COMPRAS' },
        { id: 'TECNOLOGIA', name: 'TECNOLOGIA' },
        { id: 'RECURSOS_HUMANOS', name: 'RECURSOS HUMANOS' },
        { id: 'LICITACOES', name: 'LICITAÇÕES' }
      ]);
    }
  }

  contractForm: FormGroup = this.fb.group({
    // Identification
    number: ['', Validators.required],
    processNumber: ['', Validators.required],
    fornecedor_id: [''],
    supplier: ['', Validators.required],
    object: ['', Validators.required],
    
    // Validity
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
    
    // Financial & Classification
    totalValue: ['', [Validators.required, Validators.min(0)]],
    unid_gestora: ['', Validators.required],
    department: ['', Validators.required],
    status: ['VIGENTE', Validators.required],
    
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
      supplier: supplier.razao_social,
      fornecedor_id: supplier.id
    });
    this.supplierSearch.set(supplier.razao_social);
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
      const formData = this.contractForm.value;
      
      console.log('Dados do Contrato para Envio:', JSON.stringify(formData, null, 2));
      alert('Contrato salvo com sucesso! (Veja o console para detalhes)');
      
      this.save.emit(formData);
      this.close.emit();
    } else {
      this.contractForm.markAllAsTouched();
      alert('Por favor, corrija os erros no formulário antes de salvar.');
    }
  }

  onCancel() {
    this.close.emit();
    this.cancel.emit();
  }
}