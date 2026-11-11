import { act } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { useApplyToSimilar } from './use-apply-to-similar'

const mocks = vi.hoisted(() => ({ create: vi.fn(), toast: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/api', () => ({ rules: { create: mocks.create } }))
vi.mock('sonner', () => ({
  toast: Object.assign(mocks.toast, { success: mocks.success, error: mocks.error }),
}))

let offer: ReturnType<typeof useApplyToSimilar>
function Probe() {
  offer = useApplyToSimilar()
  return null
}

beforeEach(() => { vi.resetAllMocks() })

it('offers a rule for the merchant and applies it to history in one tap', async () => {
  mocks.create.mockResolvedValue({ id: 'r1', applied_count: 7 })
  renderWithProviders(<Probe />)

  act(() => offer('DROGASIL 1234 SAO PAULO', { id: 'cat-health', name: 'Health' }))

  expect(mocks.toast).toHaveBeenCalledWith('Use "Health" for everything from "DROGASIL"?', expect.anything())
  const { action } = mocks.toast.mock.calls[0][1]
  expect(action.label).toBe('Apply to all')
  await act(() => action.onClick())

  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
    conditions: [{ field: 'description', op: 'contains', value: 'DROGASIL' }],
    actions: [{ op: 'set_category', value: 'cat-health' }],
    apply_to_existing: true,
    overwrite_existing_categories: true,
  }))
  expect(mocks.success).toHaveBeenCalledWith('Done. 7 entries updated, and new ones will follow.')
})

it('says so when the merchant already has a rule', async () => {
  mocks.create.mockRejectedValue(Object.assign(new Error('dup'), { response: { status: 409 } }))
  renderWithProviders(<Probe />)

  act(() => offer('Drogasil', { id: 'c', name: 'Health' }))
  await act(() => mocks.toast.mock.calls[0][1].action.onClick())

  expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/already a rule/))
})

it('stays quiet when the description has nothing to match on', () => {
  renderWithProviders(<Probe />)

  act(() => offer('PIX 12345', { id: 'c', name: 'Transfers' }))

  expect(mocks.toast).not.toHaveBeenCalled()
})
