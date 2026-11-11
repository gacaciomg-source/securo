import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { providerCredentials, type ProviderCredentialStatus } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const PROVIDER = 'pluggy'
const MEU_PLUGGY_URL = 'https://meu.pluggy.ai'
const PLUGGY_DASHBOARD_URL = 'https://dashboard.pluggy.ai'

interface OpenFinanceKeysDialogProps {
  open: boolean
  onClose: () => void
  /** Called after keys are saved or removed, so callers can refetch providers. */
  onChanged?: () => void
  /** Called right after keys are saved, for callers that want to carry on connecting. */
  onSaved?: () => void
}

/**
 * Where each person saves their own Meu Pluggy keys. The free plan only
 * reaches one holder's banks, so on a shared install everyone brings
 * their own; the secret is write-only and never shown again.
 */
export function OpenFinanceKeysDialog(props: OpenFinanceKeysDialogProps) {
  return props.open ? <OpenFinanceKeysSession {...props} /> : null
}

function errorStatus(error: unknown): { status?: number; detail?: unknown } {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { status?: number; data?: { detail?: unknown } } }).response
    return { status: response?.status, detail: response?.data?.detail }
  }
  return {}
}

function maskClientId(clientId: string): string {
  return clientId.length > 8 ? `${clientId.slice(0, 8)}…` : clientId
}

function OpenFinanceKeysSession({ open, onClose, onChanged, onSaved }: OpenFinanceKeysDialogProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ProviderCredentialStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    let cancelled = false
    providerCredentials.get(PROVIDER).then(
      (data) => {
        if (cancelled) return
        setStatus(data)
        setEditing(!data.has_personal_credentials)
        setLoading(false)
      },
      () => {
        if (cancelled) return
        setEditing(true)
        setLoading(false)
      },
    )
    return () => { cancelled = true }
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const saved = await providerCredentials.save(PROVIDER, {
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
      })
      setStatus(saved)
      setEditing(false)
      setClientId('')
      setClientSecret('')
      toast.success(t('openFinanceKeys.saved'))
      onChanged?.()
      onSaved?.()
    } catch (err) {
      const { detail } = errorStatus(err)
      setError(
        detail === 'invalid_credentials'
          ? t('openFinanceKeys.errorInvalid')
          : t('openFinanceKeys.errorUnavailable'),
      )
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    setError('')
    const inUse = (status?.connections_using ?? 0) > 0
    if (inUse && !confirmRemove) {
      setConfirmRemove(true)
      return
    }
    setSaving(true)
    try {
      await providerCredentials.remove(PROVIDER, inUse)
      setStatus((s) => (s ? { ...s, has_personal_credentials: false, client_id: null, connections_using: 0 } : s))
      setEditing(true)
      setConfirmRemove(false)
      toast.success(t('openFinanceKeys.removed'))
      onChanged?.()
    } catch {
      setError(t('openFinanceKeys.errorUnavailable'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('openFinanceKeys.title')}</DialogTitle>
          <DialogDescription>{t('openFinanceKeys.intro')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4">
            {status?.has_personal_credentials && !editing && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-1">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <CheckCircle2 size={16} className="text-emerald-600" />
                  {t('openFinanceKeys.savedStatus')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('openFinanceKeys.clientIdLabel')}: <span className="font-mono">{maskClientId(status.client_id ?? '')}</span>
                </p>
                {status.connections_using > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('openFinanceKeys.connectionsUsing', { count: status.connections_using })}
                  </p>
                )}
              </div>
            )}

            {editing && (
              <form id="open-finance-keys-form" onSubmit={handleSave} className="space-y-4">
                <ol className="space-y-2 text-sm text-foreground list-decimal pl-5">
                  <li>
                    {t('openFinanceKeys.step1')}{' '}
                    <a href={MEU_PLUGGY_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                      meu.pluggy.ai <ExternalLink size={12} />
                    </a>
                  </li>
                  <li>{t('openFinanceKeys.step2')}</li>
                  <li>
                    {t('openFinanceKeys.step3')}{' '}
                    <a href={PLUGGY_DASHBOARD_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                      dashboard.pluggy.ai <ExternalLink size={12} />
                    </a>
                  </li>
                  <li>{t('openFinanceKeys.step4')}</li>
                  <li>{t('openFinanceKeys.step5')}</li>
                  <li>{t('openFinanceKeys.step6')}</li>
                </ol>
                <p className="text-xs text-muted-foreground">{t('openFinanceKeys.stepsNote')}</p>
                {status?.instance_configured && !status.has_personal_credentials && (
                  <p className="text-xs text-muted-foreground">{t('openFinanceKeys.instanceFallback')}</p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="pluggy-client-id">{t('openFinanceKeys.clientIdLabel')}</Label>
                  <Input
                    id="pluggy-client-id"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pluggy-client-secret">{t('openFinanceKeys.clientSecretLabel')}</Label>
                  <Input
                    id="pluggy-client-secret"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    autoComplete="off"
                    required
                  />
                  <p className="text-xs text-muted-foreground">{t('openFinanceKeys.secretHint')}</p>
                </div>
              </form>
            )}

            {confirmRemove && (
              <p className="text-sm text-amber-600">
                {t('openFinanceKeys.removeWarning', { count: status?.connections_using ?? 0 })}
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {!loading && (
          <DialogFooter className="gap-2 sm:gap-2">
            {editing ? (
              <>
                {status?.has_personal_credentials && (
                  <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                    {t('common.cancel')}
                  </Button>
                )}
                <Button type="submit" form="open-finance-keys-form" disabled={saving || !clientId.trim() || !clientSecret.trim()}>
                  {saving ? t('openFinanceKeys.checking') : t('openFinanceKeys.save')}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={handleRemove} disabled={saving} className="text-destructive">
                  {confirmRemove ? t('openFinanceKeys.removeConfirm') : t('openFinanceKeys.remove')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(true)} disabled={saving}>
                  {t('openFinanceKeys.replace')}
                </Button>
                <Button type="button" onClick={onClose}>
                  {t('openFinanceKeys.done')}
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
