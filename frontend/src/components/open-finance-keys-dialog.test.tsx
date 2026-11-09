import { screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { OpenFinanceKeysDialog } from './open-finance-keys-dialog'

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), remove: vi.fn(), toastSuccess: vi.fn() }))
vi.mock('@/lib/api', () => ({ providerCredentials: api }))
vi.mock('sonner', () => ({ toast: { success: api.toastSuccess, error: vi.fn() } }))

const empty = {
  provider: 'pluggy',
  has_personal_credentials: false,
  client_id: null,
  instance_configured: false,
  connections_using: 0,
}
const saved = { ...empty, has_personal_credentials: true, client_id: 'abcdef123456', connections_using: 2 }

function rejection(status: number, detail: string) {
  return Object.assign(new Error(detail), { response: { status, data: { detail } } })
}

beforeEach(() => { vi.resetAllMocks() })

it('walks a person without keys through saving them', async () => {
  api.get.mockResolvedValue(empty)
  api.save.mockResolvedValue(saved)
  const onChanged = vi.fn()
  const { user } = renderWithProviders(<OpenFinanceKeysDialog open onClose={vi.fn()} onChanged={onChanged} />)

  expect(await screen.findByRole('link', { name: /meu\.pluggy\.ai/ })).toHaveAttribute('href', 'https://meu.pluggy.ai')
  await user.type(screen.getByLabelText('Client ID'), '  abcdef123456 ')
  await user.type(screen.getByLabelText('Client Secret'), 's3cret')
  await user.click(screen.getByRole('button', { name: 'Check and save' }))

  await waitFor(() => expect(api.save).toHaveBeenCalledWith('pluggy', { client_id: 'abcdef123456', client_secret: 's3cret' }))
  expect(await screen.findByText('Your keys are saved')).toBeInTheDocument()
  expect(screen.getByText('abcdef12…')).toBeInTheDocument()
  expect(screen.queryByDisplayValue('s3cret')).not.toBeInTheDocument()
  expect(onChanged).toHaveBeenCalled()
})

it('explains when Pluggy rejects the keys', async () => {
  api.get.mockResolvedValue(empty)
  api.save.mockRejectedValue(rejection(400, 'invalid_credentials'))
  const { user } = renderWithProviders(<OpenFinanceKeysDialog open onClose={vi.fn()} />)

  await user.type(await screen.findByLabelText('Client ID'), 'cid')
  await user.type(screen.getByLabelText('Client Secret'), 'wrong')
  await user.click(screen.getByRole('button', { name: 'Check and save' }))

  expect(await screen.findByText(/Pluggy did not accept these keys/)).toBeInTheDocument()
})

it('warns before removing keys that banks still use', async () => {
  api.get.mockResolvedValue(saved)
  api.remove.mockResolvedValue(undefined)
  const { user } = renderWithProviders(<OpenFinanceKeysDialog open onClose={vi.fn()} />)

  expect(await screen.findByText('Used by 2 connected banks.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Remove' }))
  expect(api.remove).not.toHaveBeenCalled()
  expect(screen.getByText(/will stop updating/)).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Remove anyway' }))
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith('pluggy', true))
  expect(await screen.findByLabelText('Client ID')).toBeInTheDocument()
})
