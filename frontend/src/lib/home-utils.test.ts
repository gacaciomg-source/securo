import { describe, expect, it } from 'vitest'
import {
  accountsInScope, cardDebts, periodMonths, personOptions, shiftMonth, sumTrend, thisMonth, variation,
} from './home-utils'

const acc = (over: Record<string, unknown>) => ({
  id: String(over.id ?? 'a'),
  user_id: 'u1',
  is_joint: false,
  type: 'checking',
  current_balance: 0,
  balance_primary: null,
  next_due_date: null,
  shared_balance_group: null,
  ...over,
})

describe('months', () => {
  it('formats the current month and steps across years', () => {
    expect(thisMonth(new Date(2026, 10, 11))).toBe('2026-11')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })

  it('lists a period newest first, ending at the chosen month', () => {
    expect(periodMonths('month', '2026-11')).toEqual(['2026-11'])
    expect(periodMonths('3m', '2026-02')).toEqual(['2026-02', '2026-01', '2025-12'])
  })
})

describe('sumTrend', () => {
  const trend = [
    { month: '2026-09-01', income: 100, expenses: 50 },
    { month: '2026-11-01', income: 300, expenses: 200 },
    { month: '2026-10-01', income: 200, expenses: 100 },
  ]

  it('adds the newest months whatever order the API sent', () => {
    expect(sumTrend(trend, 0, 2)).toEqual({ income: 500, expenses: 300 })
  })

  it('skips the newest months to get the span before', () => {
    expect(sumTrend(trend, 2, 1)).toEqual({ income: 100, expenses: 50 })
  })
})

describe('variation', () => {
  it('has nothing to say without a previous value', () => {
    expect(variation(100, 0)).toBeNull()
    expect(variation(150, 100)).toBe(50)
  })
})

describe('personOptions', () => {
  const members = [
    { user_id: 'u1', email: 'gustavo@example.com', display_name: 'Gustavo' },
    { user_id: 'u2', email: 'ana@example.com', display_name: null },
  ]

  it('offers everyone, each member, and together once an account is joint', () => {
    const options = personOptions(members, [acc({ is_joint: true })], { all: 'Todos', joint: 'Conjunto' })
    expect(options.map((o) => o.label)).toEqual(['Todos', 'Gustavo', 'ana', 'Conjunto'])
    expect(options[1].initial).toBe('G')
  })

  it('leaves together out when nothing is shared', () => {
    expect(personOptions(members, [acc({})]).map((o) => o.key)).toEqual(['all', 'u1', 'u2'])
  })
})

describe('accountsInScope', () => {
  const accounts = [
    acc({ id: 'mine', user_id: 'u1' }),
    acc({ id: 'hers', user_id: 'u2' }),
    acc({ id: 'house', user_id: 'u1', is_joint: true }),
  ]

  it('gives a person only their own accounts, not the joint one they connected', () => {
    expect(accountsInScope(accounts, 'u1').map((a) => a.id)).toEqual(['mine'])
  })

  it('gives together only the joint accounts, and everyone all of them', () => {
    expect(accountsInScope(accounts, 'joint').map((a) => a.id)).toEqual(['house'])
    expect(accountsInScope(accounts, 'all')).toHaveLength(3)
  })
})

describe('cardDebts', () => {
  it('lists what is owed on each card, biggest first, and ignores other accounts', () => {
    const debts = cardDebts([
      acc({ id: 'check', type: 'checking', current_balance: 5000 }),
      acc({ id: 'small', type: 'credit_card', current_balance: -120 }),
      acc({ id: 'big', type: 'credit_card', current_balance: -900 }),
      acc({ id: 'paid', type: 'credit_card', current_balance: 0 }),
    ])
    expect(debts.map((d) => [d.account.id, d.owed])).toEqual([['big', 900], ['small', 120]])
  })
})
