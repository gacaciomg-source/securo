import { createElement, useState } from 'react'
import { getAccountName, sortAccountsByDisplayName } from '@/lib/account-utils'
import { useTranslation } from 'react-i18next'
import { useDisplayLocale } from '@/hooks/use-display-locale'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { goals as goalsApi, accounts as accountsApi, assets as assetsApi, assetGroups as assetGroupsApi, currencies as currenciesApi, workspaces as workspacesApi } from '@/lib/api'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DatePickerInput } from '@/components/ui/date-picker-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import type { Account, Asset, AssetGroup, Goal } from '@/types'
import {
  Pencil, Trash2, Plus, Pause, Play, CheckCircle2, Archive, ArchiveRestore, Target,
  ChevronDown, PiggyBank, Users,
} from 'lucide-react'
import { ICON_MAP } from '@/lib/category-icons'
import { IconPicker } from '@/components/icon-picker'
import { GoalCover } from '@/components/goal-cover'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '@/components/page-header'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { useAuth } from '@/contexts/auth-context'
import { useWorkspace } from '@/contexts/workspace-context'
import { formatCurrency } from '@/lib/format'

function getGoalIcon(iconKey: string | null) {
  return (iconKey && ICON_MAP[iconKey]) || Target
}

const PRESET_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
]

const SELECT_CLASS = 'w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary'

function LinkedResourceSelect<T extends { id: string }>({
  name,
  label,
  placeholder,
  defaultValue,
  items,
  renderOption,
  hint,
}: {
  name: string
  label: string
  placeholder: string
  defaultValue: string | null | undefined
  items: T[] | undefined
  renderOption: (item: T) => React.ReactNode
  hint?: string
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <select name={name} defaultValue={defaultValue ?? ''} className={SELECT_CLASS} required>
        <option value="">{placeholder}</option>
        {items?.map((item) => (
          <option key={item.id} value={item.id}>
            {renderOption(item)}
          </option>
        ))}
      </select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {children}
    </div>
  )
}

function OnTrackBadge({ status, t }: { status: string | null; t: (key: string) => string }) {
  if (!status) return null
  const config: Record<string, { bg: string; text: string; key: string }> = {
    ahead: { bg: 'bg-emerald-100 dark:bg-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-400', key: 'goals.onTrackAhead' },
    on_track: { bg: 'bg-blue-100 dark:bg-blue-500/20', text: 'text-blue-700 dark:text-blue-400', key: 'goals.onTrackOnTrack' },
    behind: { bg: 'bg-amber-100 dark:bg-amber-500/20', text: 'text-amber-700 dark:text-amber-400', key: 'goals.onTrackBehind' },
    overdue: { bg: 'bg-rose-100 dark:bg-rose-500/20', text: 'text-rose-700 dark:text-rose-400', key: 'goals.onTrackOverdue' },
    achieved: { bg: 'bg-emerald-100 dark:bg-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-400', key: 'goals.onTrackAchieved' },
  }
  const c = config[status]
  if (!c) return null
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${c.bg} ${c.text}`}>
      {t(c.key)}
    </span>
  )
}

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const config: Record<string, { bg: string; text: string; key: string }> = {
    active: { bg: 'bg-emerald-100 dark:bg-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-400', key: 'goals.statusActive' },
    completed: { bg: 'bg-blue-100 dark:bg-blue-500/20', text: 'text-blue-700 dark:text-blue-400', key: 'goals.statusCompleted' },
    paused: { bg: 'bg-amber-100 dark:bg-amber-500/20', text: 'text-amber-700 dark:text-amber-400', key: 'goals.statusPaused' },
    archived: { bg: 'bg-muted', text: 'text-muted-foreground', key: 'goals.statusArchived' },
  }
  const c = config[status] ?? config.active
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${c.bg} ${c.text}`}>
      {t(c.key)}
    </span>
  )
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

export default function GoalsPage() {
  const { t } = useTranslation()
  const { mask } = usePrivacyMode()
  const { user } = useAuth()
  const { canWrite } = useWorkspace()
  const userCurrency = user?.preferences?.currency_display ?? 'USD'
  const locale = useDisplayLocale()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)
  const [trackingType, setTrackingType] = useState('manual')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null)
  const [selectedIcon, setSelectedIcon] = useState('target')
  const [selectedColor, setSelectedColor] = useState('#3B82F6')
  const [targetDate, setTargetDate] = useState('')
  const [isJoint, setIsJoint] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [contributing, setContributing] = useState<Goal | null>(null)
  const { current: workspace } = useWorkspace()
  const { data: members } = useQuery({
    queryKey: ['workspace-members', workspace?.id],
    queryFn: () => workspacesApi.listMembers(workspace!.id),
    enabled: !!workspace?.id,
  })
  // Who set each goal, by the name the household knows them by.
  const memberById = new Map(
    (members ?? []).map((m) => [m.user_id, m.display_name?.trim() || m.email.split('@')[0]]),
  )

  const { data: goalsList } = useQuery({
    queryKey: ['goals', statusFilter],
    queryFn: () => goalsApi.list(statusFilter || undefined),
  })

  const { data: accountsList } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })

  const { data: assetsList } = useQuery({
    queryKey: ['assets'],
    queryFn: () => assetsApi.list(),
  })

  const { data: walletsList } = useQuery({
    queryKey: ['asset-groups'],
    queryFn: assetGroupsApi.list,
  })

  const { data: supportedCurrencies } = useQuery({
    queryKey: ['currencies'],
    queryFn: currenciesApi.list,
    staleTime: Infinity,
  })

  // The photo goes up right after the goal is saved: a new goal has no id
  // to attach it to before that.
  const savePhoto = async (goal: Goal, photo: { file: File | null; remove: boolean }) => {
    if (photo.file) return goalsApi.uploadImage(goal.id, photo.file)
    if (photo.remove && goal.has_image) return goalsApi.deleteImage(goal.id)
    return goal
  }

  const createMutation = useMutation({
    mutationFn: async ({ photo, ...data }: Partial<Goal> & { photo: { file: File | null; remove: boolean } }) =>
      savePhoto(await goalsApi.create(data), photo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      setDialogOpen(false)
      toast.success(t('goals.created'))
    },
    onError: () => toast.error(t('common.error')),
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, photo, ...data }: Partial<Goal> & { id: string; photo: { file: File | null; remove: boolean } }) =>
      savePhoto(await goalsApi.update(id, data), photo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      setDialogOpen(false)
      setEditing(null)
      toast.success(t('goals.updated'))
    },
    onError: () => toast.error(t('common.error')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => goalsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      setDeletingGoal(null)
      toast.success(t('goals.deleted'))
    },
    onError: () => toast.error(t('common.error')),
  })

  const contributeMutation = useMutation({
    mutationFn: ({ goal, amount }: { goal: Goal; amount: number }) =>
      goalsApi.update(goal.id, { current_amount: Number(goal.current_amount) + amount } as Partial<Goal>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      setContributing(null)
      toast.success(t('goals.contributed'))
    },
    onError: () => toast.error(t('common.error')),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => goalsApi.update(id, { status } as Partial<Goal>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      toast.success(t('goals.updated'))
    },
  })

  const openCreateDialog = () => {
    setEditing(null)
    setTrackingType('manual')
    setSelectedIcon('target')
    setSelectedColor('#3B82F6')
    setTargetDate('')
    setIsJoint(false)
    setPhotoFile(null)
    setRemovePhoto(false)
    setDialogOpen(true)
  }

  const openEditDialog = (goal: Goal) => {
    setEditing(goal)
    setTrackingType(goal.tracking_type)
    setSelectedIcon(goal.icon ?? 'target')
    setSelectedColor(goal.color ?? '#3B82F6')
    setTargetDate(goal.target_date ?? '')
    setIsJoint(goal.is_joint ?? false)
    setPhotoFile(null)
    setRemovePhoto(false)
    setDialogOpen(true)
  }

  return (
    <div>
      <PageHeader
        section={t('goals.title')}
        title={t('goals.title')}
      />

      {/* Status filter */}
      <div className="flex items-center gap-2 mb-4">
        {['active', 'completed', 'paused', 'archived', ''].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {s ? t(`goals.status${s.charAt(0).toUpperCase() + s.slice(1)}`) : t('transactions.all')}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('goals.intro')}</p>
        {canWrite && (
          <Button className="h-10 shrink-0 gap-1.5 rounded-xl" onClick={openCreateDialog}>
            <Plus size={16} /> {t('goals.add')}
          </Button>
        )}
      </div>
      {goalsList && goalsList.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {goalsList.map((goal) => {
            const days = goal.target_date ? daysUntil(goal.target_date) : null
            const progressColor = goal.percentage >= 100
              ? 'bg-emerald-500'
              : goal.percentage >= 60
                ? 'bg-primary'
                : goal.percentage >= 30
                  ? 'bg-amber-400'
                  : 'bg-muted-foreground/40'
            const GoalIcon = getGoalIcon(goal.icon)
            const owner = memberById.get(goal.user_id)
            return (
              <article key={goal.id} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <GoalCover goal={goal} icon={GoalIcon} className="h-36">
                  <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                    {goal.is_joint ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
                        <Users size={12} /> {t('goals.jointBadge')}
                      </span>
                    ) : owner ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
                        {t('goals.ownerBadge', { name: owner })}
                      </span>
                    ) : null}
                  </div>
                </GoalCover>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="space-y-1.5">
                    <h3 className="text-base font-bold leading-tight text-foreground">{goal.name}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      <StatusBadge status={goal.status} t={t} />
                      <OnTrackBadge status={goal.on_track} t={t} />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-lg font-extrabold tabular-nums text-foreground">
                        {mask(formatCurrency(goal.current_amount, goal.currency, locale))}
                      </span>
                      <span className="text-sm font-bold tabular-nums text-primary">{goal.percentage.toFixed(0)}%</span>
                    </div>
                    <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full transition-all ${progressColor}`} style={{ width: `${Math.min(goal.percentage, 100)}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('goals.ofTarget', { target: mask(formatCurrency(goal.target_amount, goal.currency, locale)) })}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {goal.monthly_contribution != null && goal.monthly_contribution > 0 && (
                      <span className="tabular-nums">
                        {t('goals.savePerMonth', { amount: mask(formatCurrency(goal.monthly_contribution, goal.currency, locale)) })}
                      </span>
                    )}
                    {days !== null ? (
                      <span className={days < 0 ? 'text-rose-500' : ''}>
                        {days >= 0 ? t('goals.daysRemaining', { count: days }) : t('goals.daysOverdue', { count: Math.abs(days) })}
                      </span>
                    ) : (
                      <span>{t('goals.noTargetDate')}</span>
                    )}
                    {goal.account_name && <span>{goal.account_name}</span>}
                    {goal.asset_name && <span>{goal.asset_name}</span>}
                    {goal.asset_group_name && <span>{goal.asset_group_name}</span>}
                  </div>

                  {canWrite && (
                    <div className="mt-auto flex items-center gap-1 pt-1">
                      {goal.tracking_type === 'manual' && goal.status === 'active' && (
                        <Button size="sm" className="mr-auto h-9 gap-1.5 rounded-xl" onClick={() => setContributing(goal)}>
                          <PiggyBank size={15} /> {t('goals.contribute')}
                        </Button>
                      )}
                      <div className="ml-auto flex items-center gap-1">
                        {goal.status === 'active' && (
                          <button className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-500/10" onClick={() => statusMutation.mutate({ id: goal.id, status: 'paused' })} title={t('goals.pause')}>
                            <Pause size={15} />
                          </button>
                        )}
                        {goal.status === 'paused' && (
                          <button className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-emerald-50 hover:text-emerald-500 dark:hover:bg-emerald-500/10" onClick={() => statusMutation.mutate({ id: goal.id, status: 'active' })} title={t('goals.resume')}>
                            <Play size={15} />
                          </button>
                        )}
                        {(goal.status === 'active' || goal.status === 'paused') && (
                          <button className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10" onClick={() => statusMutation.mutate({ id: goal.id, status: 'completed' })} title={t('goals.complete')}>
                            <CheckCircle2 size={15} />
                          </button>
                        )}
                        {goal.status !== 'archived' && (
                          <button className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-muted-foreground/80" onClick={() => statusMutation.mutate({ id: goal.id, status: 'archived' })} title={t('goals.archive')}>
                            <Archive size={15} />
                          </button>
                        )}
                        {(goal.status === 'completed' || goal.status === 'archived') && (
                          <button className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-emerald-50 hover:text-emerald-500 dark:hover:bg-emerald-500/10" onClick={() => statusMutation.mutate({ id: goal.id, status: 'active' })} title={t('goals.reactivate')}>
                            <ArchiveRestore size={15} />
                          </button>
                        )}
                        <button className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary" onClick={() => openEditDialog(goal)} title={t('common.edit')}>
                          <Pencil size={15} />
                        </button>
                        <button className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" onClick={() => setDeletingGoal(goal)} title={t('common.delete')}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <SectionCard>
          <p className="py-10 text-center text-sm text-muted-foreground">{t('goals.empty')}</p>
        </SectionCard>
      )}

      <ContributeDialog
        goal={contributing}
        onClose={() => setContributing(null)}
        onSave={(goal, amount) => contributeMutation.mutate({ goal, amount })}
        saving={contributeMutation.isPending}
      />

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={() => { setDialogOpen(false); setEditing(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('goals.edit') : t('goals.add')}</DialogTitle>
          </DialogHeader>
          <form
            key={editing?.id ?? 'new'}
            onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              const payload: Record<string, unknown> = {
                name: formData.get('name') as string,
                target_amount: parseFloat(formData.get('target_amount') as string),
                currency: (formData.get('currency') as string) || userCurrency,
                tracking_type: formData.get('tracking_type') as string,
                target_date: targetDate || null,
                icon: selectedIcon || null,
                color: selectedColor || null,
                is_joint: isJoint,
              }

              const tt = formData.get('tracking_type') as string
              if (tt === 'manual') {
                payload.current_amount = parseFloat((formData.get('current_amount') as string) || '0')
              }
              if (tt === 'account') {
                payload.account_id = (formData.get('account_id') as string) || null
              }
              if (tt === 'asset') {
                payload.asset_id = (formData.get('asset_id') as string) || null
              }
              if (tt === 'asset_group') {
                payload.asset_group_id = (formData.get('asset_group_id') as string) || null
              }

              const photo = { file: photoFile, remove: removePhoto }
              if (editing) {
                updateMutation.mutate({ id: editing.id, ...payload, photo } as Partial<Goal> & { id: string; photo: typeof photo })
              } else {
                createMutation.mutate({ ...payload, photo } as Partial<Goal> & { photo: typeof photo })
              }
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>{t('goals.name')}</Label>
              <Input name="name" defaultValue={editing?.name ?? ''} required />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-3">
              <div>
                <Label id="goal-joint-label">{t('goals.jointLabel')}</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('goals.jointHint')}</p>
              </div>
              <Switch checked={isJoint} onCheckedChange={setIsJoint} aria-labelledby="goal-joint-label" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="goal-photo">{t('goals.photo')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="goal-photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => { setPhotoFile(e.target.files?.[0] ?? null); setRemovePhoto(false) }}
                />
                {editing?.has_image && !photoFile && !removePhoto && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setRemovePhoto(true)}>
                    {t('goals.removePhoto')}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {removePhoto ? t('goals.photoWillBeRemoved') : t('goals.photoHint')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('goals.targetAmount')}</Label>
                <Input
                  name="target_amount"
                  type="number"
                  step="0.01"
                  defaultValue={editing?.target_amount?.toString() ?? ''}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>{t('goals.currency')}</Label>
                <select
                  name="currency"
                  defaultValue={editing?.currency ?? userCurrency}
                  className={SELECT_CLASS}
                >
                  {supportedCurrencies?.map((c: { code: string; name: string; flag: string }) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('goals.targetDate')}</Label>
              <DatePickerInput
                value={targetDate}
                onChange={setTargetDate}
                className="w-full justify-start"
              />
            </div>

            <div className="space-y-2">
              <Label>{t('goals.trackingType')}</Label>
              <select
                name="tracking_type"
                value={trackingType}
                onChange={(e) => setTrackingType(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="manual">{t('goals.trackingManual')}</option>
                <option value="account">{t('goals.trackingAccount')}</option>
                <option value="asset">{t('goals.trackingAsset')}</option>
                <option value="asset_group">{t('goals.trackingWallet')}</option>
                <option value="net_worth">{t('goals.trackingNetWorth')}</option>
              </select>
            </div>

            {trackingType === 'manual' && (
              <div className="space-y-2">
                <Label>{t('goals.currentAmount')}</Label>
                <Input
                  name="current_amount"
                  type="number"
                  step="0.01"
                  defaultValue={editing?.tracking_type === 'manual' ? editing?.current_amount?.toString() : '0'}
                />
              </div>
            )}

            {trackingType === 'account' && (
              <LinkedResourceSelect<Account>
                name="account_id"
                label={t('goals.account')}
                placeholder={t('goals.selectAccount')}
                defaultValue={editing?.account_id}
                items={sortAccountsByDisplayName(accountsList ?? [])}
                renderOption={(acc) => `${getAccountName(acc)} (${acc.currency})`}
              />
            )}

            {trackingType === 'asset' && (
              <LinkedResourceSelect<Asset>
                name="asset_id"
                label={t('goals.asset')}
                placeholder={t('goals.selectAsset')}
                defaultValue={editing?.asset_id}
                items={assetsList}
                renderOption={(asset) => `${asset.name} (${asset.currency})`}
              />
            )}

            {trackingType === 'asset_group' && (
              <LinkedResourceSelect<AssetGroup>
                name="asset_group_id"
                label={t('goals.wallet')}
                placeholder={t('goals.selectWallet')}
                defaultValue={editing?.asset_group_id}
                items={walletsList}
                renderOption={(wallet) => wallet.name}
                hint={t('goals.walletHint')}
              />
            )}

            {/* Icon & Color */}
            <div className="space-y-2">
              <Label>{t('goals.icon')}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 border border-border rounded-lg px-3 py-2 text-sm bg-card hover:bg-muted/50 transition-colors text-left"
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-white"
                      style={{ backgroundColor: selectedColor }}
                    >
                      {createElement(getGoalIcon(selectedIcon), { size: 18 })}
                    </div>
                    <span className="flex-1 text-muted-foreground">{t('goals.chooseIconColor')}</span>
                    <ChevronDown size={14} className="text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-3 space-y-3">
                  {/* Color presets */}
                  <div className="flex items-center gap-1.5">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        title={c}
                        onClick={() => setSelectedColor(c)}
                        className={`w-7 h-7 rounded-full transition-all ${
                          selectedColor === c ? 'ring-2 ring-offset-1 ring-primary scale-110' : 'hover:scale-110'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <input
                      type="color"
                      value={selectedColor}
                      onChange={(e) => setSelectedColor(e.target.value)}
                      className="w-7 h-7 rounded-full cursor-pointer border-0 p-0"
                    />
                  </div>
                  {/* Icon picker */}
                  <IconPicker value={selectedIcon} color={selectedColor} onChange={setSelectedIcon} />
                </PopoverContent>
              </Popover>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); setEditing(null) }}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirm delete dialog */}
      <Dialog open={!!deletingGoal} onOpenChange={() => setDeletingGoal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('goals.confirmDeleteTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('goals.confirmDeleteDesc', { name: deletingGoal?.name })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingGoal(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingGoal && deleteMutation.mutate(deletingGoal.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? t('common.loading') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


/** "Put money aside": adds an amount to a manual goal, no form to fill. */
function ContributeDialog({ goal, onClose, onSave, saving }: {
  goal: Goal | null
  onClose: () => void
  onSave: (goal: Goal, amount: number) => void
  saving: boolean
}) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState('')
  if (!goal) return null
  const value = parseFloat(amount.replace(',', '.'))
  return (
    <Dialog open onOpenChange={(v) => { if (!v) { setAmount(''); onClose() } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('goals.contributeTitle', { name: goal.name })}</DialogTitle>
        </DialogHeader>
        <form
          id="goal-contribute-form"
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (value > 0) { onSave(goal, value); setAmount('') }
          }}
        >
          <Label htmlFor="goal-contribute-amount">{t('goals.contributeAmount')}</Label>
          <Input id="goal-contribute-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" autoFocus />
          <p className="text-xs text-muted-foreground">{t('goals.contributeHint')}</p>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { setAmount(''); onClose() }}>{t('common.cancel')}</Button>
          <Button type="submit" form="goal-contribute-form" disabled={saving || !(value > 0)}>{t('goals.contribute')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
