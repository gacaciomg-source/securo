import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CheckCircle2, Undo2 } from 'lucide-react'
import { accounts } from '@/lib/api'
import { extractApiError } from '@/lib/api-errors'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { BillStatus, CreditCardBill } from '@/types'

const TONE: Record<BillStatus, string> = {
  open: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  closed: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  overdue: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
}

/** Colored pill naming where a bill stands. */
export function BillStatusBadge({ status, className }: { status: BillStatus; className?: string }) {
  const { t } = useTranslation()
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', TONE[status], className)}>
      {t(`bills.status.${status}`)}
    </span>
  )
}

interface BillStatusPanelProps {
  accountId: string
  bill: CreditCardBill
  locale: string
  canWrite: boolean
}

/**
 * The bill's status, what was paid, and the manual "mark as paid" for a
 * payment the card cannot see (made from an account that is not connected).
 */
export function BillStatusPanel({ accountId, bill, locale, canWrite }: BillStatusPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const status = bill.status ?? 'open'
  const paid = bill.paid_amount ?? 0
  const mutation = useMutation({
    mutationFn: (markPaid: boolean) => accounts.setBillPaid(accountId, bill.id, markPaid),
    onSuccess: (_, markPaid) => {
      queryClient.invalidateQueries({ queryKey: ['accounts', accountId, 'bills'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      toast.success(markPaid ? t('bills.markedPaid') : t('bills.unmarkedPaid'))
    },
    onError: (err) => toast.error(extractApiError(err)),
  })

  const detail = (() => {
    if (bill.paid_manually) return t('bills.detailManual')
    if (status === 'partial' || (status === 'overdue' && paid > 0)) {
      return t('bills.detailPartial', {
        paid: formatCurrency(paid, bill.currency, locale),
        total: formatCurrency(bill.total_amount, bill.currency, locale),
      })
    }
    return t(`bills.detail.${status}`)
  })()

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="flex min-w-0 items-center gap-3">
        <BillStatusBadge status={status} />
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      {canWrite && status !== 'open' && (
        bill.paid_manually ? (
          <Button variant="outline" size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate(false)}>
            <Undo2 className="h-4 w-4" />
            {t('bills.unmarkPaid')}
          </Button>
        ) : status !== 'paid' ? (
          <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate(true)}>
            <CheckCircle2 className="h-4 w-4" />
            {t('bills.markPaid')}
          </Button>
        ) : null
      )}
    </div>
  )
}
