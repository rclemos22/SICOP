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

  // Navigation State
  view = signal<'dashboard' | 'list' | 'form' | 'financial' | 'budget' | 'contract-details' | 'suppliers' | 'nota-empenho'>('dashboard');
  selectedContractId = signal<string | null>(null);
  
  sidebarOpen = false;

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
  }

  showDashboard() {
    this.view.set('dashboard');
    this.selectedContractId.set(null);
  }

  showForm() {
    this.view.set('form');
  }

  showList() {
    this.view.set('list');
    this.selectedContractId.set(null);
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
}