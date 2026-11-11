import { screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { BillStatusPanel } from './bill-status'
import type { CreditCardBill } from '@/types'

const api = vi.hoisted(() => ({ setBillPaid: vi.fn(), toastSuccess: vi.fn() }))
vi.mock('@/lib/api', () => ({ accounts: api }))
vi.mock('sonner', () => ({ toast: { success: api.toastSuccess, error: vi.fn() } }))

const bill: CreditCardBill = {
  id: 'b1', account_id: 'a1', external_id: 'x', due_date: '2026-11-10', total_amount: 300,
  currency: 'BRL', minimum_payment: null, status: 'overdue', paid_amount: 0, paid_manually: false,
}

beforeEach(() => { vi.resetAllMocks() })

it('lets someone mark an unpaid bill as paid', async () => {
  api.setBillPaid.mockResolvedValue({ ...bill, status: 'paid', paid_manually: true })
  const { user } = renderWithProviders(<BillStatusPanel accountId="a1" bill={bill} locale="en-US" canWrite />)

  expect(screen.getByText('Overdue')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Mark as paid' }))

  await waitFor(() => expect(api.setBillPaid).toHaveBeenCalledWith('a1', 'b1', true))
})

it('shows how much of a partly paid bill was paid', () => {
  renderWithProviders(
    <BillStatusPanel accountId="a1" bill={{ ...bill, status: 'partial', paid_amount: 120 }} locale="en-US" canWrite />,
  )

  expect(screen.getByText('Partly paid')).toBeInTheDocument()
  expect(screen.getByText(/120\.00 of .*300\.00 paid/)).toBeInTheDocument()
})

it('offers to undo a manual mark', async () => {
  api.setBillPaid.mockResolvedValue({ ...bill, status: 'overdue', paid_manually: false })
  const { user } = renderWithProviders(
    <BillStatusPanel accountId="a1" bill={{ ...bill, status: 'paid', paid_manually: true }} locale="en-US" canWrite />,
  )

  await user.click(screen.getByRole('button', { name: 'Undo' }))

  await waitFor(() => expect(api.setBillPaid).toHaveBeenCalledWith('a1', 'b1', false))
})

it('hides the buttons from someone who can only view', () => {
  renderWithProviders(<BillStatusPanel accountId="a1" bill={bill} locale="en-US" canWrite={false} />)

  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
