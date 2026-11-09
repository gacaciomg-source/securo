import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { connections } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OpenFinanceKeysDialog } from '@/components/open-finance-keys-dialog'

export interface Provider {
  name: string
  display_name: string
  description: string
  flow_type: string
  configured: boolean
  requires_institution_select?: boolean
  supports_asset_sync?: boolean
  /** The signed-in person saved keys of their own for this provider. */
  has_personal_credentials?: boolean
}

interface ConnectorSelectDialogProps {
  open: boolean
  onClose: () => void
  onSelect: (provider: Provider) => void
}

export function ConnectorSelectDialog(props: ConnectorSelectDialogProps) {
  return props.open ? <ConnectorSelectSession {...props} /> : null
}

function ConnectorSelectSession({ open, onClose, onSelect }: ConnectorSelectDialogProps) {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  // Bumped after the person saves their own Pluggy keys, so Pluggy turns
  // available without closing this dialog.
  const [reloadKey, setReloadKey] = useState(0)
  const [keysOpen, setKeysOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    connections.getProviders().then((data) => {
      if (cancelled) return
      setProviders(data)
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setProviders([])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [reloadKey])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('accounts.selectConnector')}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t('accounts.selectConnectorDesc')}</p>
        </DialogHeader>
        <div className="space-y-2 pt-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : providers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t('accounts.noConnectorsAvailable')}
            </p>
          ) : (
            providers.map((p) => (
              <button
                key={p.name}
                disabled={!p.configured}
                onClick={() => {
                  onSelect(p)
                  onClose()
                }}
                className={`w-full flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                  p.configured
                    ? 'border-border hover:border-primary hover:bg-muted/50 cursor-pointer'
                    : 'border-border/50 opacity-60 cursor-not-allowed'
                }`}
              >
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  <Building2 size={16} className="text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{p.display_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t(`accounts.providers.${p.name}.description`, p.description)}</p>
                  {!p.configured && p.name !== 'pluggy' && (
                    <p className="text-xs text-amber-600 mt-1.5">
                      {t('accounts.connectorNotConfigured')}
                    </p>
                  )}
                  {!p.configured && p.name === 'pluggy' && (
                    <p className="text-xs text-amber-600 mt-1.5">
                      {t('openFinanceKeys.needKeys')}
                    </p>
                  )}
                  {/* Only the server's keys: the free Meu Pluggy plan only
                      reaches the banks of whoever owns that account. */}
                  {p.configured && p.name === 'pluggy' && !p.has_personal_credentials && (
                    <p className="text-xs text-amber-600 mt-1.5">
                      {t('openFinanceKeys.sharedAccountWarning')}
                    </p>
                  )}
                </div>
              </button>
            ))
          )}
          {!loading && providers.some((p) => p.name === 'pluggy') && (
            <div className="flex justify-end pt-1">
              <Button type="button" variant="link" size="xs" className="px-0" onClick={() => setKeysOpen(true)}>
                {providers.find((p) => p.name === 'pluggy')?.has_personal_credentials
                  ? t('openFinanceKeys.menu')
                  : t('openFinanceKeys.setUp')}
              </Button>
            </div>
          )}
        </div>
        <OpenFinanceKeysDialog
          open={keysOpen}
          onClose={() => setKeysOpen(false)}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      </DialogContent>
    </Dialog>
  )
}
