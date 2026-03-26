import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export class CurrencyUtils {
  /**
   * Formata um número ou string numérica para o padrão BRL (R$ 1.234,56)
   */
  static formatBRL(value: number | string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '';
    
    let numValue: number;
    if (typeof value === 'string') {
      // Remove tudo que não é dígito
      const cleanValue = value.replace(/\D/g, '');
      if (cleanValue === '') return '';
      numValue = Number(cleanValue) / 100;
    } else {
      numValue = value;
    }
    
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numValue);
  }

  /**
   * Converte uma string formatada em BRL (1.234,56) de volta para um número (1234.56)
   */
  static parseBRL(value: string | null | undefined): number {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    
    // Remove pontos de milhar e substitui a vírgula decimal por ponto
    const cleanValue = value
      .replace(/\./g, '')
      .replace(',', '.');
      
    const num = parseFloat(cleanValue);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Aplica a máscara de moeda durante a digitação
   */
  static applyMask(value: string): string {
    if (!value) return '';
    
    // Remove tudo que não é dígito
    let cleanValue = value.replace(/\D/g, '');
    if (cleanValue === '') return '';
    
    // Converte para número e formata
    const numValue = Number(cleanValue) / 100;
    
    return this.formatBRL(numValue);
  }

  /**
   * Validador para campos de moeda
   */
  static currencyValidator(min: number = 0): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      if (!value) return null;
      
      const num = this.parseBRL(value);
      
      if (isNaN(num) || num < min) {
        return { minCurrency: { requiredValue: min, actualValue: num } };
      }
      return null;
    };
  }
}
