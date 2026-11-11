import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { UserRound } from 'lucide-react'
import { auth as authApi } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Saving the name a person is shown by. It is what the household sees on
 * the person filter and next to each entry, instead of an email prefix.
 */
function useSaveName() {
  const { user, updateUser } = useAuth()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  return async (name: string) => {
    const updated = await authApi.updateMe({
      preferences: { ...user!.preferences, display_name: name.trim() },
    })
    updateUser(updated)
    queryClient.invalidateQueries({ queryKey: ['workspace-members'] })
    toast.success(t('profileName.saved'))
  }
}

export function ProfileNameDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <ProfileNameSession onClose={onClose} /> : null
}

function ProfileNameSession({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const save = useSaveName()
  const [name, setName] = useState(user?.preferences?.display_name ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await save(name)
      onClose()
    } catch {
      toast.error(t('profileName.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('profileName.title')}</DialogTitle>
          <DialogDescription>{t('profileName.description')}</DialogDescription>
        </DialogHeader>
        <form id="profile-name-form" onSubmit={submit} className="space-y-2">
          <Label htmlFor="profile-name">{t('profileName.label')}</Label>
          <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus required />
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="profile-name-form" disabled={saving || !name.trim()}>{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A friendly nudge on the home screen for someone who never set a name. */
export function ProfileNamePrompt() {
  const { t } = useTranslation()
  const save = useSaveName()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center"
      onSubmit={async (e) => {
        e.preventDefault()
        setSaving(true)
        try { await save(name) } catch { toast.error(t('profileName.error')) } finally { setSaving(false) }
      }}
    >
      <div className="flex items-center gap-3 sm:flex-1">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"><UserRound className="h-5 w-5" /></span>
        <p className="text-sm font-semibold text-foreground">{t('profileName.prompt')}</p>
      </div>
      <div className="flex gap-2">
        <Input aria-label={t('profileName.label')} placeholder={t('profileName.placeholder')} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="sm:w-48" />
        <Button type="submit" disabled={saving || !name.trim()}>{t('common.save')}</Button>
      </div>
    </form>
  )
}
