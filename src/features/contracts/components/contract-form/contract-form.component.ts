import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup, AbstractControl, ValidationErrors } from '@angular/forms';


@Component({
  selector: 'app-contract-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './contract-form.component.html',
})
export class ContractFormComponent {
  private fb: FormBuilder = inject(FormBuilder);
  
  // Outputs
  close = output<void>();
  cancel = output<void>(); // Kept for backward compatibility
  save = output<any>();

  // FUTURE: Fetch Data for Selects
  departments = signal<Array<{ id: string, name: string }>>([{ id: 'GABINETE', name: 'GABINETE' }, { id: 'JURIDICO', name: 'JURIDICO' }]);
  statusOptions = ['VIGENTE', 'ASSINADO', 'EM ELABORAÇÃO'];

  contractForm: FormGroup = this.fb.group({
    // Identification
    number: ['', Validators.required],
    processNumber: ['', Validators.required],
    supplier: ['', Validators.required],
    object: ['', Validators.required],
    
    // Validity
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
    
    // Financial & Classification
    totalValue: ['', [Validators.required, Validators.min(0)]],
    department: ['', Validators.required],
    status: ['VIGENTE', Validators.required]
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