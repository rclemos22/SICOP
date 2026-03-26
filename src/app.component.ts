import { CommonModule, registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import { Component, signal, LOCALE_ID, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppContextService } from './core/services/app-context.service';
import { SigefService } from './core/services/sigef.service';

import { BudgetPageComponent } from './features/budget/pages/budget/budget-page.component';
import { ContractFormComponent } from './features/contracts/components/contract-form/contract-form.component';
import { ContractDetailsPageComponent } from './features/contracts/pages/contract-details/contract-details-page.component';
import { ContractsPageComponent } from './features/contracts/pages/contracts/contracts-page.component';
import { DashboardPageComponent } from './features/dashboard/pages/dashboard/dashboard-page.component';
import { FinancialPageComponent } from './features/financial/pages/financial/financial-page.component';
import { SuppliersPageComponent } from './features/suppliers/pages/suppliers/suppliers-page.component';
import { NotaEmpenhoPageComponent } from './features/nota-empenho/pages/nota-empenho/nota-empenho-page.component';
import { ContractService } from './features/contracts/services/contract.service';
import { ContractStatus } from './shared/models/contract.model';

registerLocaleData(localePt);

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule,
    ContractsPageComponent, 
    ContractFormComponent, 
    FinancialPageComponent,
    BudgetPageComponent,
    ContractDetailsPageComponent,
    DashboardPageComponent,
    SuppliersPageComponent,
    NotaEmpenhoPageComponent
  ],
  providers: [{ provide: LOCALE_ID, useValue: 'pt-BR' }],
  templateUrl: './app.component.html',
})
export class AppComponent {
  // Global App Context (Year Selection)
  public contextService = inject(AppContextService);
  public sigefService = inject(SigefService);
  private contractService = inject(ContractService);

  // Navigation State
  view = signal<'dashboard' | 'list' | 'form' | 'financial' | 'budget' | 'contract-details' | 'suppliers' | 'nota-empenho'>('dashboard');
  selectedContractId = signal<string | null>(null);
  contractToEdit = signal<any | null>(null);
  
  sidebarOpen = false;

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
  }

  showDashboard() {
    this.view.set('dashboard');
    this.selectedContractId.set(null);
  }

  showForm(contract?: any) {
    this.view.set('form');
    if (contract) {
      this.contractToEdit.set(contract);
    } else {
      this.contractToEdit.set(null);
    }
  }

  showList() {
    this.view.set('list');
    this.selectedContractId.set(null);
    this.contractToEdit.set(null); // Limpar contrato para edição
  }

  showFinancial() {
    this.view.set('financial');
  }

  showBudget() {
    this.view.set('budget');
  }
  
  showSuppliers() {
    this.view.set('suppliers');
  }

  showNotaEmpenho() {
    this.view.set('nota-empenho');
  }

  openContractDetails(id: string) {
    this.selectedContractId.set(id);
    this.view.set('contract-details');
  }

  handleDashboardNavigation(target: 'contracts' | 'financial' | 'budget') {
    if (target === 'contracts') this.showList();
    if (target === 'financial') this.showFinancial();
    if (target === 'budget') this.showBudget();
  }

  async handleSave(data: any) {
    console.log('=== [AppComponent.handleSave] dados recebidos:', data);
    
    const contractData = {
      contrato: data.number,
      processo_sei: data.processNumber || null,
      link_sei: data.linkSei || null,
      contratada: data.supplier,
      cnpj_contratada: data.cnpjContratada || null,
      fornecedor_id: data.fornecedor_id || null,
      data_inicio: data.startDate ? new Date(data.startDate).toISOString().split('T')[0] : null,
      data_fim: data.endDate ? new Date(data.endDate).toISOString().split('T')[0] : null,
      valor_anual: Number(data.totalValue),
      status: data.status as ContractStatus,
      setor_id: data.department,
      unid_gestora: data.unid_gestora,
      objeto: data.object,
      gestor_contrato: data.gestor_contrato || null,
      fiscal_admin: data.fiscal_admin || null,
      fiscal_tecnico: data.fiscal_tecnico || null
    };

    try {
      const isEditing = this.contractToEdit();
      
      if (isEditing && isEditing.id) {
        // Update existing contract
        const result = await this.contractService.updateContract(isEditing.id, contractData as any);
        if (result.error) {
          alert('Erro ao atualizar contrato: ' + result.error);
          return;
        }
      } else {
        // Create new contract
        const result = await this.contractService.addContract(contractData as any);
        if (result.error) {
          alert('Erro ao salvar contrato: ' + result.error);
          return;
        }
      }
      
      this.showList();
    } catch (err) {
      console.error('Erro ao salvar contrato:', err);
      alert('Erro ao salvar contrato');
    }
  }
}