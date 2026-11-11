import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import GoalsPage from './goals'
import type { Goal } from '@/types'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  uploadImage: vi.fn(),
  deleteImage: vi.fn(),
  imageBlob: vi.fn(),
  listMembers: vi.fn(),
  empty: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  goals: { list: api.list, update: api.update, create: api.create, uploadImage: api.uploadImage, deleteImage: api.deleteImage, imageBlob: api.imageBlob, delete: vi.fn() },
  workspaces: { listMembers: api.listMembers },
  accounts: { list: api.empty },
  assets: { list: api.empty },
  assetGroups: { list: api.empty },
  currencies: { list: api.empty },
}))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { preferences: { currency_display: 'BRL' } } }) }))
vi.mock('@/contexts/workspace-context', () => ({ useWorkspace: () => ({ current: { id: 'w1' }, canWrite: true }) }))
vi.mock('@/hooks/use-privacy-mode', () => ({ usePrivacyMode: () => ({ mask: (v: string) => v }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const goal = (over: Partial<Goal>): Goal => ({
  id: 'g1', user_id: 'u1', name: 'Trip', target_amount: 8000, current_amount: 2000, currency: 'BRL',
  target_amount_primary: null, current_amount_primary: null, target_date: null, tracking_type: 'manual',
  account_id: null, asset_id: null, asset_group_id: null, status: 'active', icon: null, color: null,
  position: 0, metadata_json: null, created_at: '', updated_at: '', percentage: 25,
  monthly_contribution: null, on_track: null, account_name: null, asset_name: null, asset_group_name: null,
  is_joint: false, has_image: false, image_version: null,
  ...over,
} as Goal)

beforeEach(() => {
  vi.resetAllMocks()
  api.empty.mockResolvedValue([])
  api.listMembers.mockResolvedValue([
    { user_id: 'u1', email: 'gustavo@example.com', display_name: 'Gustavo' },
    { user_id: 'u2', email: 'ana@example.com', display_name: 'Ana' },
  ])
})

it('marks shared goals and names whose the others are', async () => {
  api.list.mockResolvedValue([
    goal({ id: 'g1', name: 'Trip', is_joint: true }),
    goal({ id: 'g2', name: 'Emergency fund', user_id: 'u2' }),
  ])
  renderWithProviders(<GoalsPage />)

  const trip = (await screen.findByText('Trip')).closest('article')!
  expect(within(trip).getByText('Together')).toBeInTheDocument()
  const fund = screen.getByText('Emergency fund').closest('article')!
  expect(await within(fund).findByText("Ana's goal")).toBeInTheDocument()
})

it('puts money aside by adding to what the goal has', async () => {
  api.list.mockResolvedValue([goal({ current_amount: 2000 })])
  api.update.mockResolvedValue(goal({ current_amount: 2150 }))
  const { user } = renderWithProviders(<GoalsPage />)

  await user.click(await screen.findByRole('button', { name: 'Put money aside' }))
  await user.type(screen.getByLabelText('How much'), '150,00')
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Put money aside' }))

  await waitFor(() => expect(api.update).toHaveBeenCalledWith('g1', { current_amount: 2150 }))
})

it('shows the photo of a goal that has one', async () => {
  api.list.mockResolvedValue([goal({ has_image: true, image_version: 'v1' })])
  api.imageBlob.mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
  const createObjectURL = vi.fn(() => 'blob:goal-photo')
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
  const { container } = renderWithProviders(<GoalsPage />)

  await waitFor(() => expect(container.querySelector('img[src="blob:goal-photo"]')).not.toBeNull())
  expect(api.imageBlob).toHaveBeenCalledWith('g1')
})
