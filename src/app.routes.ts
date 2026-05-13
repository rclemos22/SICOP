import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/dashboard/pages/dashboard/dashboard-page.component').then(m => m.DashboardPageComponent) },
  { path: 'contracts', loadComponent: () => import('./features/contracts/pages/contracts/contracts-page.component').then(m => m.ContractsPageComponent) },
  { path: 'contracts/new', loadComponent: () => import('./features/contracts/components/contract-form/contract-form.component').then(m => m.ContractFormComponent) },
  { path: 'contracts/:contractId', loadComponent: () => import('./features/contracts/pages/contract-details/contract-details-page.component').then(m => m.ContractDetailsPageComponent) },
  { path: 'contracts/:contractId/edit', loadComponent: () => import('./features/contracts/components/contract-form/contract-form.component').then(m => m.ContractFormComponent) },
  { path: 'financial', loadComponent: () => import('./features/financial/pages/financial/financial-page.component').then(m => m.FinancialPageComponent) },
  { path: 'budget', loadComponent: () => import('./features/budget/pages/budget/budget-page.component').then(m => m.BudgetPageComponent) },
  { path: 'suppliers', loadComponent: () => import('./features/suppliers/pages/suppliers/suppliers-page.component').then(m => m.SuppliersPageComponent) },
  { path: 'nota-empenho', loadComponent: () => import('./features/nota-empenho/pages/nota-empenho/nota-empenho-page.component').then(m => m.NotaEmpenhoPageComponent) },
  { path: 'ordem-bancaria', loadComponent: () => import('./features/ordem-bancaria/pages/ordem-bancaria/ordem-bancaria-page.component').then(m => m.OrdemBancariaPageComponent) },
  { path: '**', redirectTo: '' },
];
