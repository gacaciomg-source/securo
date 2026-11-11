import { describe, expect, it } from 'vitest'
import { merchantKey } from './similar-rule'

describe('merchantKey', () => {
  it('keeps the merchant and drops numbers and places', () => {
    expect(merchantKey('DROGASIL 1234 SAO PAULO')).toBe('DROGASIL')
    expect(merchantKey('Drogasil')).toBe('Drogasil')
  })

  it('drops how the money moved', () => {
    expect(merchantKey('PIX ENVIADO Maria Souza')).toBe('Maria Souza')
    expect(merchantKey('COMPRA CARTAO IFOOD *RESTAURANTE')).toBe('IFOOD')
  })

  it('takes the next word after a generic one, accents and all', () => {
    expect(merchantKey('Mercado Pão de Açúcar')).toBe('Mercado Pão')
  })

  it('only returns text that appears as written, so "contains" matches', () => {
    for (const description of ['DROGASIL 1234 SAO PAULO', 'PIX ENVIADO Maria Souza', 'UBER *TRIP 8812', 'Mercado Pão de Açúcar']) {
      const key = merchantKey(description)
      expect(key && description.includes(key)).toBeTruthy()
    }
  })

  it('has nothing to offer for a bare transfer', () => {
    expect(merchantKey('PIX 12345')).toBeNull()
    expect(merchantKey('TED 001/0001')).toBeNull()
  })
})
