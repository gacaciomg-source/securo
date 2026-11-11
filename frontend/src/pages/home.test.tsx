import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import HomePage from './home'

const api = vi.hoisted(() => ({
  accountsList: vi.fn(),
  listMembers: vi.fn(),
  monthlyTrend: vi.fn(),
  summary: vi.fn(),
  spendingByCategory: vi.fn(),
  transactionsList: vi.fn(),
  updateMe: vi.fn(),
}))
const auth = vi.hoisted(() => ({ user: { email: 'gustavo@example.com', preferences: { display_name: 'Gustavo', currency_display: 'BRL' } } }))

vi.mock('@/lib/api', () => ({
  accounts: { list: api.accountsList },
  workspaces: { listMembers: api.listMembers },
  dashboard: { monthlyTrend: api.monthlyTrend, summary: api.summary, spendingByCategory: api.spendingByCategory },
  transactions: { list: api.transactionsList },
  auth: { updateMe: api.updateMe },
}))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: auth.user, updateUser: vi.fn() }) }))
vi.mock('@/contexts/workspace-context', () => ({ useWorkspace: () => ({ current: { id: 'w1' }, canWrite: true }) }))
vi.mock('@/hooks/use-privacy-mode', () => ({ usePrivacyMode: () => ({ mask: (v: string) => v }) }))
vi.mock('@/hooks/use-display-locale', () => ({ useDisplayLocale: () => 'en-US' }))
// Recharts measures a real layout; the chart itself is not under test.
vi.mock('recharts', async (orig) => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const account = (over: Record<string, unknown>) => ({
  id: 'a', user_id: 'u1', is_joint: false, type: 'checking', name: 'Nubank', display_name: null,
  current_balance: 0, balance_primary: null, next_due_date: null, shared_balance_group: null, ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  auth.user = { email: 'gustavo@example.com', preferences: { display_name: 'Gustavo', currency_display: 'BRL' } }
  api.accountsList.mockResolvedValue([
    account({ id: 'mine', user_id: 'u1', current_balance: 2000 }),
    account({ id: 'hers', user_id: 'u2', name: 'Inter', current_balance: 1500 }),
    account({ id: 'house', user_id: 'u1', name: 'Casa', is_joint: true, current_balance: 300 }),
    account({ id: 'card', user_id: 'u1', name: 'Cartão', type: 'credit_card', current_balance: -800, next_due_date: '2026-12-10' }),
  ])
  api.listMembers.mockResolvedValue([
    { user_id: 'u1', email: 'gustavo@example.com', display_name: 'Gustavo' },
    { user_id: 'u2', email: 'ana@example.com', display_name: 'Ana' },
  ])
  api.monthlyTrend.mockResolvedValue([])
  api.summary.mockResolvedValue({ monthly_income: 5000, monthly_expenses: 3000 })
  api.spendingByCategory.mockResolvedValue([])
  api.transactionsList.mockResolvedValue({ items: [], total: 0, page: 1, limit: 8 })
})

it('shows in, out, what was left and the cash without the card bill', async () => {
  renderWithProviders(<HomePage />)

  expect(await screen.findByText('Left over')).toBeInTheDocument()
  await waitFor(() => expect(screen.getAllByText(/5,000\.00/).length).toBeGreaterThan(0))
  expect(screen.getByText(/2,000\.00$/, { selector: 'p' })).toBeInTheDocument()
  // Cash: 2000 + 1500 + 300; the card's 800 is owed, not subtracted.
  expect(screen.getByText(/3,800\.00/)).toBeInTheDocument()
  expect(screen.getByText(/800\.00/, { selector: '.text-rose-600' })).toBeInTheDocument()
})

it('narrows everything to one person, leaving the joint account out', async () => {
  const { user } = renderWithProviders(<HomePage />)

  const tabs = await screen.findByRole('tablist')
  await user.click(within(tabs).getByRole('tab', { name: /Ana/ }))

  await waitFor(() => expect(api.monthlyTrend).toHaveBeenLastCalledWith(12, ['hers']))
  expect(screen.getByText(/1,500\.00/)).toBeInTheDocument()
})

it('offers the shared accounts as "together"', async () => {
  const { user } = renderWithProviders(<HomePage />)

  await user.click(await screen.findByRole('tab', { name: 'Together' }))

  await waitFor(() => expect(api.monthlyTrend).toHaveBeenLastCalledWith(12, ['house']))
})

it('asks for a name when the person never set one', async () => {
  auth.user = { email: 'ana@example.com', preferences: { currency_display: 'BRL' } as never }
  renderWithProviders(<HomePage />)

  expect(await screen.findByText(/What should we call you/)).toBeInTheDocument()
})
