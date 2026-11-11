import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rules } from '@/lib/api'
import { extractApiError } from '@/lib/api-errors'
import { invalidateFinancialQueries } from '@/lib/invalidate-queries'
import { merchantKey } from '@/lib/similar-rule'

/**
 * After someone recategorizes one entry, offer to do the same for every
 * entry from that merchant, past and future: one tap creates the rule
 * ("description contains DROGASIL -> Health") and applies it to history.
 * The rules page stays for anything finer.
 */
export function useApplyToSimilar() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  return useCallback(
    (description: string, category: { id: string; name: string }) => {
      const key = merchantKey(description)
      if (!key) return
      toast(t('similar.question', { category: category.name, key }), {
        duration: 15000,
        action: {
          label: t('similar.apply'),
          onClick: async () => {
            try {
              const rule = await rules.create({
                name: t('similar.ruleName', { key, category: category.name }),
                conditions_op: 'and',
                conditions: [{ field: 'description', op: 'contains', value: key }],
                actions: [{ op: 'set_category', value: category.id }],
                priority: 0,
                is_active: true,
                apply_to_existing: true,
                overwrite_existing_categories: true,
              } as Parameters<typeof rules.create>[0])
              invalidateFinancialQueries(queryClient)
              queryClient.invalidateQueries({ queryKey: ['rules'] })
              toast.success(t('similar.applied', { count: rule.applied_count ?? 0 }))
            } catch (error) {
              const status = (error as { response?: { status?: number } })?.response?.status
              toast.error(status === 409 ? t('similar.exists') : extractApiError(error))
            }
          },
        },
      })
    },
    [t, queryClient],
  )
}
