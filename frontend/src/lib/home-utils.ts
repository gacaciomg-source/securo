// Relative, not aliased: this file is pulled into the test project, which
// compiles without the `@/*` path mapping (see tsconfig.node.json).
import { sumCashTotal } from './account-utils'
import type { Account, MonthlyTrend, WorkspaceMember } from '../types'

export const PERIODS = ['month', '3m', '6m', '12m'] as const
export type Period = (typeof PERIODS)[number]

/** 'all', 'joint', or a member's user id. */
export type PersonKey = string

export interface PersonOption {
  key: PersonKey
  label: string
  /** One letter for the avatar; absent for "everyone" and "together". */
  initial?: string
  /** Tailwind background class for the avatar. */
  color?: string
}

const AVATAR_COLORS = ['bg-emerald-600', 'bg-violet-600', 'bg-sky-600', 'bg-amber-600', 'bg-rose-600', 'bg-teal-600']

/** The current month as "YYYY-MM", in local time. */
export function thisMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return thisMonth(d)
}

/** "nov/26" (short) or "novembro de 2026" (long), in the display locale. */
export function monthLabel(yearMonth: string, locale: string, style: 'short' | 'long'): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  if (style === 'long') return d.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const month = d.toLocaleDateString(locale, { month: 'short' }).replace('.', '')
  return `${month}/${String(y).slice(2)}`
}

/** The months a period covers, newest first, ending at `month`. */
export function periodMonths(period: Period, month: string): string[] {
  const count = { month: 1, '3m': 3, '6m': 6, '12m': 12 }[period]
  return Array.from({ length: count }, (_, i) => shiftMonth(month, -i))
}

/** Income and expenses over `count` months, skipping the `skip` newest. */
export function sumTrend(trend: readonly MonthlyTrend[], skip: number, count: number): { income: number; expenses: number } {
  const newestFirst = [...trend].sort((a, b) => b.month.localeCompare(a.month))
  return newestFirst.slice(skip, skip + count).reduce(
    (acc, row) => ({ income: acc.income + Number(row.income), expenses: acc.expenses + Number(row.expenses) }),
    { income: 0, expenses: 0 },
  )
}

/** Percent change, or null when there is nothing to compare against. */
export function variation(now: number, before: number): number | null {
  if (!before) return null
  return ((now - before) / Math.abs(before)) * 100
}

/**
 * Who the money can be narrowed to: everyone, each member, and "together"
 * when the household marked some account as joint. A single-person
 * workspace gets just "everyone" and that person, which the screen hides.
 */
export function personOptions(
  members: readonly Pick<WorkspaceMember, 'user_id' | 'email' | 'display_name'>[],
  accounts: readonly Pick<Account, 'is_joint'>[],
  labels: { all: string; joint: string } = { all: 'Todos', joint: 'Juntos' },
): PersonOption[] {
  const options: PersonOption[] = [{ key: 'all', label: labels.all }]
  members.forEach((member, index) => {
    const label = member.display_name?.trim() || member.email.split('@')[0]
    options.push({
      key: member.user_id,
      label,
      initial: label.charAt(0).toUpperCase(),
      color: AVATAR_COLORS[index % AVATAR_COLORS.length],
    })
  })
  if (accounts.some((a) => a.is_joint)) options.push({ key: 'joint', label: labels.joint })
  return options
}

/** The accounts a person filter covers. A joint account is nobody's alone. */
export function accountsInScope<T extends Pick<Account, 'user_id' | 'is_joint'>>(accounts: readonly T[], person: PersonKey): T[] {
  if (person === 'all') return [...accounts]
  if (person === 'joint') return accounts.filter((a) => a.is_joint)
  return accounts.filter((a) => a.user_id === person && !a.is_joint)
}

/** Money in the accounts: never minus the card bill. */
export function cashTotal(accounts: readonly Account[]): number {
  return sumCashTotal(accounts)
}

/** Each card with what is still owed on it, biggest first. */
export function cardDebts<T extends Pick<Account, 'type' | 'current_balance' | 'balance_primary' | 'next_due_date'>>(
  accounts: readonly T[],
): { account: T; owed: number }[] {
  return accounts
    .filter((a) => a.type === 'credit_card')
    .map((account) => {
      const balance = Number(account.balance_primary ?? account.current_balance) || 0
      return { account, owed: Math.max(0, -balance) }
    })
    .filter(({ account, owed }) => owed > 0.005 || account.next_due_date)
    .sort((a, b) => b.owed - a.owed)
}
