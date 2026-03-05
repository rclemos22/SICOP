import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { SupplierService } from '../../services/supplier.service';
import { ContractService } from '../../services/contract.service';
import { Supplier, getSupplierStatusClass, getSupplierStatusLabel, SupplierStatus } from '../../models/supplier.model';
import { ContractStatus } from '../../models/contract.model';

@Component({
  selector: 'app-suppliers-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, DatePipe],
  templateUrl: './suppliers-page.component.html'
})
export class SuppliersPageComponent {
  private supplierService = inject(SupplierService);
  private contractService = inject(ContractService);
  private fb = inject(FormBuilder);

  // Layout & State
  layoutMode = signal<'grid' | 'list'>('grid');
  searchQuery = signal('');
  filterStatus = signal<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Drawer / Editing State
  selectedSupplier = signal<Supplier | null>(null);
  isEditing = signal(false);

  // Form
  supplierForm: FormGroup = this.fb.group({
    name: ['', Validators.required],
    tradeName: ['', Validators.required],
    cnpj: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', Validators.required],
    category: [''],
    status: ['ACTIVE', Validators.required]
  });

  // Helpers
  getStatusClass = getSupplierStatusClass;
  getStatusLabel = getSupplierStatusLabel;

  // --- Computed Data ---

  filteredSuppliers = computed(() => {
    const all = this.supplierService.suppliers();
    const query = this.searchQuery().toLowerCase();
    const status = this.filterStatus();

    return all.filter(s => {
      // 1. Search
      const matchesSearch = !query ||
        s.name.toLowerCase().includes(query) ||
        s.tradeName.toLowerCase().includes(query) ||
        s.cnpj.includes(query);

      // 2. Status
      const matchesStatus = status === 'ALL' || s.status === status;

      return matchesSearch && matchesStatus;
    });
  });

  // Get contracts linked to the selected supplier
  // Note: Linking by Name string for now as per current Contract Model
  linkedContracts = computed(() => {
    const supplier = this.selectedSupplier();
    if (!supplier) return [];

    return this.contractService.contracts().filter(c =>
      c.contratada.toLowerCase() === supplier.name.toLowerCase() ||
      c.contratada.toLowerCase().includes(supplier.tradeName.toLowerCase())
    );
  });

  // --- Actions ---

  setLayoutMode(mode: 'grid' | 'list') {
    this.layoutMode.set(mode);
  }

  updateSearch(event: Event) {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  setFilterStatus(status: 'ALL' | 'ACTIVE' | 'INACTIVE') {
    this.filterStatus.set(status);
  }

  // --- Drawer / Detail Actions ---

  openDetails(supplier: Supplier) {
    this.selectedSupplier.set(supplier);
    this.isEditing.set(false);
  }

  closeDetails() {
    this.selectedSupplier.set(null);
    this.isEditing.set(false);
  }

  toggleEditMode() {
    const current = this.selectedSupplier();
    if (!current) return;

    if (!this.isEditing()) {
      // Enter Edit Mode: Populate Form
      this.supplierForm.patchValue({
        name: current.name,
        tradeName: current.tradeName,
        cnpj: current.cnpj,
        email: current.email,
        phone: current.phone,
        category: current.category,
        status: current.status
      });
      this.isEditing.set(true);
    } else {
      // Cancel Edit Mode
      this.isEditing.set(false);
    }
  }

  saveChanges() {
    if (this.supplierForm.valid && this.selectedSupplier()) {
      const id = this.selectedSupplier()!.id;
      const updates = this.supplierForm.value;

      this.supplierService.updateSupplier(id, updates);

      // Update local selected state to reflect changes immediately in UI
      this.selectedSupplier.set({ ...this.selectedSupplier()!, ...updates });
      this.isEditing.set(false);
    } else {
      this.supplierForm.markAllAsTouched();
    }
  }

  getContractStatusClass(status: ContractStatus) {
    if (status === ContractStatus.VIGENTE) return 'bg-green-100 text-green-800';
    if (status === ContractStatus.RESCINDIDO) return 'bg-red-100 text-red-800';
    return 'bg-yellow-100 text-yellow-800';
  }
}