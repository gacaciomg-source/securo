import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { ConnectorSelectDialog } from './connector-select-dialog'
import { OAuthConnectDialog } from './oauth-connect-dialog'
import { BankConnectDialog } from './bank-connect-dialog'

const api = vi.hoisted(() => ({ getProviders: vi.fn(), listInstitutions: vi.fn(), getReconnectToken: vi.fn(), getConnectToken: vi.fn(), get: vi.fn(), save: vi.fn(), toastError: vi.fn() }))
vi.mock('@/lib/api', () => ({ connections: api, auth: api, providerCredentials: api }))
vi.mock('sonner', () => ({ toast: { error: api.toastError, success: vi.fn() } }))
vi.mock('react-pluggy-connect', () => ({ PluggyConnect: ({ connectToken }: { connectToken: string }) => <div>{connectToken}</div> }))

beforeEach(() => { vi.resetAllMocks() })

it('ignores provider responses from a closed session when reopened', async () => {
  let finish!: (data: unknown) => void
  api.getProviders.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce([{ name: 'new', display_name: 'New provider', description: 'Synthetic', configured: true }])
  const props = { onClose: vi.fn(), onSelect: vi.fn() }
  const { rerender } = renderWithProviders(<ConnectorSelectDialog open {...props} />)
  rerender(<ConnectorSelectDialog open={false} {...props} />)
  rerender(<ConnectorSelectDialog open {...props} />)
  await screen.findByText('New provider')
  await act(async () => { finish([{ name: 'old', display_name: 'Old provider', configured: true }]) })
  expect(screen.queryByText('Old provider')).not.toBeInTheDocument()
  expect(screen.getByText('New provider')).toBeInTheDocument()
})

it('warns a person without own Pluggy keys before using the shared account', async () => {
  api.getProviders.mockResolvedValueOnce([
    { name: 'pluggy', display_name: 'Pluggy', description: 'Synthetic', flow_type: 'widget', configured: true, has_personal_credentials: false },
  ])
  renderWithProviders(<ConnectorSelectDialog open onClose={vi.fn()} onSelect={vi.fn()} />)

  expect(await screen.findByText(/shared Pluggy account/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Set up my keys' })).toBeInTheDocument()
})

it('asks for the keys when Pluggy is clicked without any, then carries on connecting', async () => {
  const noKeys = { provider: 'pluggy', has_personal_credentials: false, client_id: null, instance_configured: false, connections_using: 0 }
  api.getProviders.mockResolvedValue([
    { name: 'pluggy', display_name: 'Pluggy', description: 'Synthetic', flow_type: 'widget', configured: false, has_personal_credentials: false },
  ])
  api.get.mockResolvedValue(noKeys)
  api.save.mockResolvedValue({ ...noKeys, has_personal_credentials: true, client_id: 'abcdef123456' })
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const { user } = renderWithProviders(<ConnectorSelectDialog open onClose={onClose} onSelect={onSelect} />)

  await user.click(await screen.findByText('Pluggy'))
  expect(onSelect).not.toHaveBeenCalled()
  expect(await screen.findByRole('link', { name: /dashboard\.pluggy\.ai/ })).toBeInTheDocument()
  expect(screen.getByText(/MeuPluggy/)).toBeInTheDocument()

  await user.type(screen.getByLabelText('Client ID'), 'abcdef123456')
  await user.type(screen.getByLabelText('Client Secret'), 's3cret')
  await user.click(screen.getByRole('button', { name: 'Check and save' }))

  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'pluggy', configured: true, has_personal_credentials: true })))
  expect(onClose).toHaveBeenCalled()
})

it('does not warn once the person saved their own Pluggy keys', async () => {
  api.getProviders.mockResolvedValueOnce([
    { name: 'pluggy', display_name: 'Pluggy', description: 'Synthetic', flow_type: 'widget', configured: true, has_personal_credentials: true },
  ])
  renderWithProviders(<ConnectorSelectDialog open onClose={vi.fn()} onSelect={vi.fn()} />)

  expect(await screen.findByRole('button', { name: 'My Open Finance keys' })).toBeInTheDocument()
  expect(screen.queryByText(/shared Pluggy account/)).not.toBeInTheDocument()
})

it('ignores an earlier country request after back navigation and another selection', async () => {
  let finish!: (data: unknown) => void
  api.listInstitutions.mockResolvedValueOnce({ countries: ['DE', 'GB'] })
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce({ institutions: [{ country: 'GB', name: 'new', display_name: 'New bank' }] })
  const { user } = renderWithProviders(<OAuthConnectDialog open provider="synthetic" onClose={vi.fn()} />)
  await user.click(await screen.findByText('DE'))
  await user.click(screen.getByRole('button', { name: 'Back' }))
  await user.click(screen.getByText('GB'))
  await screen.findByText('New bank')
  await act(async () => { finish({ institutions: [{ country: 'DE', name: 'old', display_name: 'Old bank' }] }) })
  expect(screen.queryByText('Old bank')).not.toBeInTheDocument()
  expect(screen.getByText('New bank')).toBeInTheDocument()
})

it('waits for banks in the remembered country instead of showing an empty result', async () => {
  localStorage.setItem('securo:lastOAuthCountry', 'DE')
  let finish!: (data: unknown) => void
  api.listInstitutions.mockResolvedValueOnce({ countries: ['DE'] })
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  renderWithProviders(<OAuthConnectDialog open provider="synthetic" onClose={vi.fn()} />)
  await screen.findByRole('button', { name: 'Back' })
  expect(screen.queryByText('No institutions found.')).not.toBeInTheDocument()
  await act(async () => { finish({ institutions: [{ country: 'DE', name: 'bank', display_name: 'Remembered bank' }] }) })
  expect(screen.getByText('Remembered bank')).toBeInTheDocument()
})

it('uses the latest close callback without restarting a bank token request', async () => {
  let reject!: (error: Error) => void
  api.getReconnectToken.mockImplementation(() => new Promise((_, fail) => { reject = fail }))
  const firstClose = vi.fn()
  const latestClose = vi.fn()
  const { rerender } = renderWithProviders(<BankConnectDialog open reconnectConnectionId="synthetic" onClose={firstClose} />)
  rerender(<BankConnectDialog open reconnectConnectionId="synthetic" onClose={latestClose} />)
  expect(api.getReconnectToken).toHaveBeenCalledTimes(1)
  await act(async () => { reject(new Error('synthetic failure')) })
  expect(firstClose).not.toHaveBeenCalled()
  expect(latestClose).toHaveBeenCalledOnce()
  expect(api.toastError).toHaveBeenCalledOnce()
})

it('ignores token failures after the bank dialog closes', async () => {
  let reject!: (error: Error) => void
  api.getReconnectToken.mockImplementation(() => new Promise((_, fail) => { reject = fail }))
  const onClose = vi.fn()
  const { rerender } = renderWithProviders(<BankConnectDialog open reconnectConnectionId="synthetic" onClose={onClose} />)
  rerender(<BankConnectDialog open={false} reconnectConnectionId="synthetic" onClose={onClose} />)
  await act(async () => { reject(new Error('late failure')) })
  expect(onClose).not.toHaveBeenCalled()
  expect(api.toastError).not.toHaveBeenCalled()
})
