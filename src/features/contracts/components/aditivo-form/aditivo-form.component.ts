import { CommonModule } from '@angular/common';
import { Component, inject, input, output, OnInit } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { ContractService } from '../../services/contract.service';
import { Aditivo } from '../../../../shared/models/contract.model';


@Component({
  selector: 'app-aditivo-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './aditivo-form.component.html',
})
export class AditivoFormComponent implements OnInit {
  private fb: FormBuilder = inject(FormBuilder);
  private contractService = inject(ContractService);

  // Inputs & Outputs
  contractId = input.required<string>();
  aditivo = input<Aditivo | null>(null);
  save = output<Aditivo>();
  cancel = output<void>();
  delete = output<string>();

  aditivoForm: FormGroup;

  constructor() {
    this.aditivoForm = this.fb.group({
      id: [''],
      numero_aditivo: ['', Validators.required],
      tipo: ['ALTERACAO', Validators.required],
      data_assinatura: [new Date().toISOString().split('T')[0], Validators.required],
      nova_vigencia: [''],
      valor_aditivo: [0]
    });
  }

  ngOnInit(): void {
    const aditivoData = this.aditivo();
    if (aditivoData) {
      this.aditivoForm.patchValue({
        id: aditivoData.id,
        numero_aditivo: aditivoData.numero_aditivo,
        tipo: aditivoData.tipo,
        data_assinatura: aditivoData.data_assinatura ? new Date(aditivoData.data_assinatura).toISOString().split('T')[0] : '',
        nova_vigencia: aditivoData.nova_vigencia ? new Date(aditivoData.nova_vigencia).toISOString().split('T')[0] : '',
        valor_aditivo: aditivoData.valor_aditivo || 0
      });
    }

    // Watch for 'tipo' changes to toggle 'nova_vigencia' requirement
    this.aditivoForm.get('tipo')?.valueChanges.subscribe(tipo => {
      const novaVigenciaControl = this.aditivoForm.get('nova_vigencia');
      if (tipo === 'PRORROGACAO') {
        novaVigenciaControl?.setValidators([Validators.required]);
      } else {
        novaVigenciaControl?.clearValidators();
      }
      novaVigenciaControl?.updateValueAndValidity();
    });
  }

  get f() { return this.aditivoForm.controls; }

  get isEditing(): boolean {
    return !!this.aditivo();
  }

  async onSubmit() {
    if (this.aditivoForm.valid) {
      const formData = this.aditivoForm.value;
      
      console.log('Aditivo form submitted:', { formData, isEditing: this.isEditing, contractId: this.contractId() });
      
      try {
        if (this.isEditing && formData.id) {
          const updateData = {
            numero_aditivo: formData.numero_aditivo,
            tipo: formData.tipo,
            data_assinatura: new Date(formData.data_assinatura),
            nova_vigencia: formData.nova_vigencia ? new Date(formData.nova_vigencia) : null,
            valor_aditivo: formData.valor_aditivo || null
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
            numero_aditivo: formData.numero_aditivo,
            tipo: formData.tipo,
            data_assinatura: new Date(formData.data_assinatura),
            nova_vigencia: formData.nova_vigencia ? new Date(formData.nova_vigencia) : null,
            valor_aditivo: formData.valor_aditivo || null
          };
          
          console.log('Creating aditivo:', aditivoToSave);
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
