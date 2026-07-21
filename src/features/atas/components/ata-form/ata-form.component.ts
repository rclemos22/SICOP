import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, OnInit, signal, ViewChild, ElementRef } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup, FormArray } from '@angular/forms';
import { Ata, AtaItem } from '../../../../shared/models/ata.model';
import { SupplierService } from '../../../suppliers/services/supplier.service';
import { Supplier } from '../../../../shared/models/supplier.model';

@Component({
  selector: 'app-ata-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './ata-form.component.html',
})
export class AtaFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private supplierService = inject(SupplierService);

  ata = input<Ata | null>(null);
  saving = input(false);
  save = output<{ header: Partial<Ata>; itens: AtaItem[] }>();
  cancel = output<void>();

  @ViewChild('formEl') formEl!: ElementRef<HTMLFormElement>;

  readonly suppliers = this.supplierService.suppliers;

  supplierSearch = signal('');
  showSupplierDropdown = signal(false);

  filteredSuppliers = computed(() => {
    const query = this.supplierSearch().toLowerCase();
    if (query.length < 2) return [];
    return this.suppliers().filter(s =>
      s.razao_social.toLowerCase().includes(query) ||
      s.nome_fantasia.toLowerCase().includes(query) ||
      s.cnpj.includes(query)
    );
  });

  form: FormGroup;

  constructor() {
    this.form = this.fb.group({
      numero_processo: ['', Validators.required],
      numero_ata: ['', Validators.required],
      fornecedor_id: ['', Validators.required],
      fornecedor_nome: [''],
      objeto: [''],
      data_assinatura: [''],
      vigencia_inicio: [''],
      vigencia_fim: [''],
      status: ['ATIVA', Validators.required],
      observacao: [''],
      itens: this.fb.array([]),
    });
  }

  ngOnInit(): void {
    this.supplierService.loadSuppliers();
    this.populateForm();
  }

  get f() { return this.form.controls; }

  get itensArray(): FormArray {
    return this.form.get('itens') as FormArray;
  }

  get totalCalculado(): number {
    return this.itensArray.controls.reduce((acc, ctrl) => {
      const qtd = Number(ctrl.get('quantidade')?.value) || 0;
      const vu = Number(ctrl.get('valor_unitario')?.value) || 0;
      return acc + qtd * vu;
    }, 0);
  }

  private populateForm() {
    const current = this.ata();
    if (current) {
      this.form.patchValue({
        numero_processo: current.numero_processo,
        numero_ata: current.numero_ata,
        fornecedor_id: current.fornecedor_id || '',
        fornecedor_nome: current.fornecedor_nome || '',
        objeto: current.objeto,
        data_assinatura: current.data_assinatura ? new Date(current.data_assinatura).toISOString().split('T')[0] : '',
        vigencia_inicio: current.vigencia_inicio ? new Date(current.vigencia_inicio).toISOString().split('T')[0] : '',
        vigencia_fim: current.vigencia_fim ? new Date(current.vigencia_fim).toISOString().split('T')[0] : '',
        status: current.status,
        observacao: current.observacao,
      });
      this.supplierSearch.set(current.fornecedor_nome || '');
      if (current.itens) {
        current.itens.forEach(item => this.addItem(item));
      }
    } else {
      this.form.reset({ status: 'ATIVA' });
    }
  }

  addItem(item?: AtaItem) {
    const group = this.fb.group({
      id: [item?.id ?? null],
      numero_item: [item?.numero_item ?? this.itensArray.length + 1, Validators.required],
      descricao: [item?.descricao ?? '', Validators.required],
      unidade: [item?.unidade ?? ''],
      quantidade: [item?.quantidade ?? 0, [Validators.required, Validators.min(0.01)]],
      valor_unitario: [item?.valor_unitario ?? 0, [Validators.required, Validators.min(0.01)]],
    });
    this.itensArray.push(group);
  }

  removeItem(index: number) {
    this.itensArray.removeAt(index);
    this.renumberItens();
  }

  private renumberItens() {
    this.itensArray.controls.forEach((ctrl, i) => {
      ctrl.get('numero_item')?.setValue(i + 1);
    });
  }

  selectSupplier(supplier: Supplier) {
    this.form.patchValue({ fornecedor_id: supplier.id, fornecedor_nome: supplier.razao_social });
    this.supplierSearch.set(supplier.razao_social);
    this.showSupplierDropdown.set(false);
  }

  onSupplierInput(value: string) {
    this.supplierSearch.set(value);
    this.form.patchValue({ fornecedor_id: '' });
    this.showSupplierDropdown.set(value.length >= 2);
  }

  onSupplierBlur() {
    setTimeout(() => this.showSupplierDropdown.set(false), 200);
  }

  onSubmit() {
    if (this.saving()) return;

    if (this.itensArray.length === 0) {
      this.form.markAllAsTouched();
      this.scrollToFirstError();
      return;
    }

    if (this.form.valid) {
      const raw = this.form.value;
      const header: Partial<Ata> = {
        numero_processo: raw.numero_processo,
        numero_ata: raw.numero_ata,
        fornecedor_id: raw.fornecedor_id,
        fornecedor_nome: raw.fornecedor_nome || null,
        objeto: raw.objeto || null,
        data_assinatura: raw.data_assinatura || null,
        vigencia_inicio: raw.vigencia_inicio || null,
        vigencia_fim: raw.vigencia_fim || null,
        valor_global: this.totalCalculado,
        status: raw.status,
        observacao: raw.observacao || null,
      };
      const itens: AtaItem[] = raw.itens.map((i: any, idx: number) => ({
        id: i.id || undefined,
        numero_item: idx + 1,
        descricao: i.descricao,
        unidade: i.unidade || null,
        quantidade: Number(i.quantidade) || 0,
        valor_unitario: Number(i.valor_unitario) || 0,
      }));
      this.save.emit({ header, itens });
    } else {
      this.form.markAllAsTouched();
      this.scrollToFirstError();
    }
  }

  private scrollToFirstError() {
    setTimeout(() => {
      const firstError = this.formEl?.nativeElement.querySelector('.ng-invalid');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        (firstError as HTMLElement).focus();
      }
    }, 100);
  }

  onCancel() {
    this.cancel.emit();
  }
}
