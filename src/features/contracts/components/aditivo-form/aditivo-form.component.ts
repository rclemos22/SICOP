import { CommonModule } from '@angular/common';
import { Component, inject, input, output, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { CurrencyUtils } from '../../../../app/shared/utils/currency-utils';
import { ContractService } from '../../services/contract.service';
import { Aditivo } from '../../../../shared/models/contract.model';
import { SupabaseService } from '../../../../core/services/supabase.service';
import { TipoAditivoService } from '../../services/tipo-aditivo.service';


@Component({
  selector: 'app-aditivo-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './aditivo-form.component.html',
})
export class AditivoFormComponent implements OnInit {
  private fb: FormBuilder = inject(FormBuilder);
  private contractService = inject(ContractService);
  private supabaseService = inject(SupabaseService);
  private tipoAditivoService = inject(TipoAditivoService);

  // Tipos de aditivo carregados do banco via Service
  tiposAditivo = this.tipoAditivoService.tipos;

  // Inputs & Outputs
  contractId = input.required<string>();
  numeroContrato = input<string>('');
  aditivo = input<Aditivo | null>(null);
  save = output<Aditivo>();
  cancel = output<void>();
  delete = output<string>();

  aditivoForm: FormGroup;

  constructor() {
    this.aditivoForm = this.fb.group({
      id: [''],
      numero_aditivo: ['', Validators.required],
      tipo_id: ['', Validators.required],
      data_assinatura: [new Date().toISOString().split('T')[0], Validators.required],
      nova_vigencia: [''],
      valor_aditivo: ['', [CurrencyUtils.currencyValidator(0)]]
    });
  }

  ngOnInit(): void {
    
    const aditivoData = this.aditivo();
    if (aditivoData) {
      this.aditivoForm.patchValue({
        id: aditivoData.id,
        numero_aditivo: aditivoData.numero_aditivo,
        tipo_id: aditivoData.tipo_id || '',
        data_assinatura: aditivoData.data_assinatura ? new Date(aditivoData.data_assinatura).toISOString().split('T')[0] : '',
        nova_vigencia: aditivoData.nova_vigencia ? new Date(aditivoData.nova_vigencia).toISOString().split('T')[0] : '',
        valor_aditivo: CurrencyUtils.formatBRL(aditivoData.valor_aditivo)
      });
    } else {
      // Preencher o campo numero_contrato automaticamente
      const numeroContrato = this.numeroContrato();
      if (numeroContrato) {
        // Deixa o campo vazio para o usuário digitar o número do aditivo
        // O campo numero_contrato será enviado automaticamente
      }
    }

    // Watch for 'tipo_id' changes to toggle 'nova_vigencia' requirement
    this.aditivoForm.get('tipo_id')?.valueChanges.subscribe(tipo_id => {
      const selectedTipo = this.tiposAditivo().find(t => t.id === tipo_id);
      const tipoNome = selectedTipo?.nome || '';
      const novaVigenciaControl = this.aditivoForm.get('nova_vigencia');
      
      if (tipoNome.includes('PRAZO') || tipoNome.includes('PRORROGACAO')) {
        novaVigenciaControl?.setValidators([Validators.required]);
      } else {
        novaVigenciaControl?.clearValidators();
      }
      novaVigenciaControl?.updateValueAndValidity();
    });
  }

  onCurrencyInput(event: any) {
    const input = event.target as HTMLInputElement;
    const masked = CurrencyUtils.applyMask(input.value);
    input.value = masked;
    this.aditivoForm.get('valor_aditivo')?.setValue(masked, { emitEvent: false });
  }

  get f() { return this.aditivoForm.controls; }

  isAditivoDePrazo(): boolean {
    const tipo_id = this.aditivoForm.get('tipo_id')?.value;
    if (!tipo_id) return false;
    const selectedTipo = this.tiposAditivo().find(t => t.id === tipo_id);
    const tipoNome = selectedTipo?.nome || '';
    return tipoNome.includes('PRAZO') || tipoNome.includes('PRORROGACAO');
  }

  get isEditing(): boolean {
    return !!this.aditivo();
  }

  // loadTiposAditivo removido pois TipoAditivoService gerencia isso

  async onSubmit() {
    if (this.aditivoForm.valid) {
      const formData = this.aditivoForm.value;
      
      console.log('Aditivo form submitted:', { formData, isEditing: this.isEditing, contractId: this.contractId() });
      
      try {
        if (this.isEditing && formData.id) {
          const updateData = {
            numero_contrato: this.numeroContrato(),
            numero_aditivo: formData.numero_aditivo,
            tipo_id: formData.tipo_id,
            data_assinatura: new Date(formData.data_assinatura),
            nova_vigencia: formData.nova_vigencia ? new Date(formData.nova_vigencia) : null,
            valor_aditivo: CurrencyUtils.parseBRL(formData.valor_aditivo) || null
          };
          
          console.log('Updating aditivo:', formData.id, updateData);
          const result = await this.contractService.updateAditivo(formData.id, updateData);
          
          console.log('Update result:', result);
          
          if (result.error) {
            alert('Erro ao atualizar aditivo: ' + result.error);
            return;
          }
          
          this.save.emit(result.data);
          this.cancel.emit();
        } else {
          const aditivoToSave = {
            contract_id: this.contractId(),
            numero_contrato: this.numeroContrato(),
            numero_aditivo: formData.numero_aditivo,
            tipo_id: formData.tipo_id,
            data_assinatura: new Date(formData.data_assinatura),
            nova_vigencia: formData.nova_vigencia ? new Date(formData.nova_vigencia) : null,
            valor_aditivo: CurrencyUtils.parseBRL(formData.valor_aditivo) || null
          };
          
          console.log('Creating aditivo with contract_id:', this.contractId());
          console.log('Aditivo data:', aditivoToSave);
          const result = await this.contractService.addAditivo(aditivoToSave);
          
          console.log('Create result:', result);
          
          if (result.error) {
            alert('Erro ao salvar aditivo: ' + result.error);
            return;
          }
          
          this.save.emit(result.data);
          this.cancel.emit();
        }
      } catch (err) {
        console.error('Error saving aditivo:', err);
        alert('Erro ao salvar aditivo');
      }
    } else {
      this.aditivoForm.markAllAsTouched();
    }
  }

  async onDelete() {
    const aditivoData = this.aditivo();
    if (!aditivoData?.id) return;
    
    if (!confirm('Tem certeza que deseja excluir este aditivo?')) {
      return;
    }
    
    try {
      const result = await this.contractService.deleteAditivo(aditivoData.id);
      
      if (result.error) {
        alert('Erro ao excluir aditivo: ' + result.error);
        return;
      }
      
      this.delete.emit(aditivoData.id);
    } catch (err) {
      alert('Erro ao excluir aditivo');
    }
  }

  onCancel() {
    this.cancel.emit();
  }
}
