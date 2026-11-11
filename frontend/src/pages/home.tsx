import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertCircle, ArrowLeftRight, ChevronLeft, ChevronRight, CreditCard, LayoutGrid, Plus, Sparkles,
  TrendingDown, TrendingUp, Wallet,
} from 'lucide-react'
import { accounts as accountsApi, dashboard, transactions as transactionsApi, workspaces as workspacesApi } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { useWorkspace } from '@/contexts/workspace-context'
import { useDisplayLocale } from '@/hooks/use-display-locale'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { formatCurrency } from '@/lib/format'
import { getAccountName } from '@/lib/account-utils'
import { cn } from '@/lib/utils'
import { CategoryIcon } from '@/components/category-icon'
import { Skeleton } from '@/components/ui/skeleton'
import { ProfileNamePrompt } from '@/components/profile-name'
import {
  PERIODS, type Period, accountsInScope, cashTotal, cardDebts, monthLabel, periodMonths, personOptions,
  shiftMonth, sumTrend, thisMonth, variation, type PersonKey,
} from '@/lib/home-utils'
import type { Account, MonthlyTrend, SpendingByCategory, Transaction } from '@/types'

const QuickAddTransaction = lazy(() => import('@/components/quick-add-transaction'))

const GREEN = '#16A34A'
const RED = '#E11D48'
const PERSON_KEY = 'securo.home.person'

function readPerson(): PersonKey {
  try {
    return (localStorage.getItem(PERSON_KEY) as PersonKey | null) ?? 'all'
  } catch {
    return 'all'
  }
}

const firstUpper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** "R$ 1,2 mil" style ticks for the chart axis. */
function compact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

/**
 * The home screen, after the church app's Financeiro: the period on top,
 * four plain numbers (in, out, left over, in the accounts), the months side
 * by side, where the money went and the latest entries with their notes.
 * Everything can be narrowed to one person of the household, or to what
 * the couple shares.
 */
export default function HomePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { current: workspace, canWrite } = useWorkspace()
  const locale = useDisplayLocale()
  const { mask } = usePrivacyMode()
  const currency = user?.preferences?.currency_display ?? 'BRL'
  const money = (value: number) => mask(formatCurrency(value, currency, locale))

  const [person, setPersonState] = useState<PersonKey>(readPerson)
  const setPerson = (key: PersonKey) => {
    setPersonState(key)
    try { localStorage.setItem(PERSON_KEY, key) } catch { /* private mode */ }
  }
  const [period, setPeriod] = useState<Period>('month')
  const [month, setMonth] = useState(thisMonth())
  const [quickAddOpen, setQuickAddOpen] = useState(false)

  const { data: accountList, isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })
  const { data: members } = useQuery({
    queryKey: ['workspace-members', workspace?.id],
    queryFn: () => workspacesApi.listMembers(workspace!.id),
    enabled: !!workspace?.id,
  })

  const people = personOptions(members ?? [], accountList ?? [], { all: t('home.everyone'), joint: t('home.together') })
  const activePerson = people.some((p) => p.key === person) ? person : 'all'
  const scoped = useMemo(() => accountsInScope(accountList ?? [], activePerson), [accountList, activePerson])
  // `undefined` = no filter. An empty scope must not fall back to "everything".
  const accountIds = activePerson === 'all' ? undefined : scoped.map((a) => a.id)
  const scopeEmpty = accountIds !== undefined && accountIds.length === 0
  const scopeKey = accountIds?.join(',') ?? 'all'

  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ['home', 'trend', scopeKey],
    queryFn: () => dashboard.monthlyTrend(12, accountIds),
    enabled: !scopeEmpty,
  })
  const { data: summary } = useQuery({
    queryKey: ['home', 'summary', month, scopeKey],
    queryFn: () => dashboard.summary(`${month}-01`, undefined, accountIds),
    enabled: period === 'month' && !scopeEmpty,
  })
  const { data: prevSummary } = useQuery({
    queryKey: ['home', 'summary', shiftMonth(month, -1), scopeKey],
    queryFn: () => dashboard.summary(`${shiftMonth(month, -1)}-01`, undefined, accountIds),
    enabled: period === 'month' && !scopeEmpty,
  })
  const months = periodMonths(period, month)
  const { data: spending } = useQuery({
    queryKey: ['home', 'spending', months.join(','), scopeKey],
    queryFn: async () => mergeSpending(await Promise.all(months.map((m) => dashboard.spendingByCategory(`${m}-01`, accountIds)))),
    enabled: !scopeEmpty,
  })
  const { data: recent, isLoading: recentLoading } = useQuery({
    queryKey: ['home', 'recent', scopeKey],
    queryFn: () => transactionsApi.list({ account_ids: accountIds, limit: 8, page: 1, sort_by: 'date', sort_dir: 'desc', exclude_ignored: true }),
    enabled: !scopeEmpty,
  })

  // In and out for the chosen period, and the same span right before it.
  const totals = (() => {
    if (scopeEmpty) return { income: 0, expenses: 0, prev: null as null | { income: number; expenses: number } }
    if (period === 'month') {
      const pick = (s: typeof summary) => s ? {
        income: Number(s.monthly_income_primary ?? s.monthly_income ?? 0),
        expenses: Number(s.monthly_expenses_primary ?? s.monthly_expenses ?? 0),
      } : null
      const now = pick(summary) ?? { income: 0, expenses: 0 }
      return { ...now, prev: pick(prevSummary) }
    }
    const n = months.length
    return { ...sumTrend(trend ?? [], 0, n), prev: n * 2 <= 12 ? sumTrend(trend ?? [], n, n) : null }
  })()
  const leftOver = totals.income - totals.expenses
  const cash = cashTotal(scoped)
  const cards = cardDebts(scoped)
  const loading = accountsLoading || (!scopeEmpty && trendLoading)

  const chartMonths = (trend ?? []).slice(-6).map((row: MonthlyTrend) => ({
    key: row.month.slice(0, 7),
    name: monthLabel(row.month.slice(0, 7), locale, 'short'),
    entradas: Number(row.income),
    saidas: Number(row.expenses),
    highlight: months.includes(row.month.slice(0, 7)),
  }))

  const memberName = (userId: string) => people.find((p) => p.key === userId)?.label

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {t('home.hello', { name: user?.preferences?.display_name || user?.email?.split('@')[0] || '' })}
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">{t('home.title')}</h1>
        </div>
        <div className="flex gap-2">
          <Link
            to="/dashboard"
            className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/40"
          >
            <LayoutGrid className="h-4 w-4 text-primary" />
            <span className="hidden sm:inline">{t('home.fullDashboard')}</span>
          </Link>
          {canWrite && (
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              className="flex h-10 items-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-transform active:scale-95"
            >
              <Plus className="h-5 w-5" />
              {t('home.addEntry')}
            </button>
          )}
        </div>
      </header>

      {!user?.preferences?.display_name && <ProfileNamePrompt />}

      {people.length > 2 && (
        <div className="flex gap-1 overflow-x-auto rounded-2xl bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label={t('home.whoseMoney')}>
          {people.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={activePerson === p.key}
              onClick={() => setPerson(p.key)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2 text-[13px] font-semibold transition-all sm:min-w-[88px] sm:gap-2 sm:px-3 sm:text-sm',
                activePerson === p.key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.initial && <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white', p.color)}>{p.initial}</span>}
              {p.label}
            </button>
          ))}
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4">
        <div className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { setPeriod(p); if (p !== 'month') setMonth(thisMonth()) }}
              className={cn(
                'whitespace-nowrap rounded-xl px-2 py-1.5 text-[13px] font-semibold transition-colors sm:px-3.5 sm:text-sm',
                period === p ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`home.period.${p}`)}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          {period === 'month' ? (
            <>
              <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t('home.previous')} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="min-w-[10rem] text-center text-lg font-bold text-foreground">{firstUpper(monthLabel(month, locale, 'long'))}</span>
              <button
                type="button"
                onClick={() => setMonth(shiftMonth(month, 1))}
                disabled={month >= thisMonth()}
                aria-label={t('home.next')}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          ) : (
            <span className="text-lg font-bold text-foreground">
              {monthLabel(months[months.length - 1], locale, 'short')} – {monthLabel(months[0], locale, 'short')}
            </span>
          )}
        </div>
      </section>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicator title={t('home.income')} value={money(totals.income)} tone="green" icon={TrendingUp}
            change={totals.prev ? variation(totals.income, totals.prev.income) : null} t={t} />
          <Indicator title={t('home.expenses')} value={money(totals.expenses)} tone="red" icon={TrendingDown} inverse
            change={totals.prev ? variation(totals.expenses, totals.prev.expenses) : null} t={t} />
          <Indicator
            title={leftOver >= 0 ? t('home.leftOver') : t('home.shortBy')}
            value={money(Math.abs(leftOver))}
            tone={leftOver >= 0 ? 'green' : 'red'}
            icon={leftOver >= 0 ? Sparkles : AlertCircle}
            detail={totals.income > 0 ? t('home.spentShare', { pct: Math.round((totals.expenses / totals.income) * 100) }) : t('home.incomeMinusExpenses')}
            t={t}
          />
          <Indicator title={t('home.inAccounts')} value={money(cash)} tone="primary" icon={Wallet} detail={t('home.inAccountsHint')} t={t} />
        </div>
      )}

      {cards.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground">{t('home.cards')}</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {cards.map(({ account, owed }) => (
              <Link
                key={account.id}
                to={`/accounts/${account.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 transition-colors hover:border-primary/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{getAccountName(account)}</p>
                  <p className="text-xs text-muted-foreground">
                    {account.next_due_date
                      ? t('home.cardDue', { date: new Date(account.next_due_date + 'T00:00:00').toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }) })
                      : t('home.cardNoDue')}
                    {memberName(account.user_id) && !account.is_joint && ` · ${memberName(account.user_id)}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">{money(owed)}</p>
                  <p className="text-[11px] text-muted-foreground">{t('home.toPay')}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-foreground">{t('home.byMonth')}</h2>
          <div className="flex items-center gap-3 text-[11px] font-semibold text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: GREEN }} />{t('home.income')}</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: RED }} />{t('home.expenses')}</span>
          </div>
        </div>
        <div className="h-[240px] w-full">
          {scopeEmpty ? (
            <p className="pt-16 text-center text-sm text-muted-foreground">{t('home.noAccountsHere')}</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartMonths} margin={{ top: 5, right: 5, left: -10, bottom: 0 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b833" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 700, fill: '#94a3b8' }} />
                <YAxis axisLine={false} tickLine={false} width={48} tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: number) => compact(v, locale)} />
                <Tooltip
                  cursor={{ fill: '#94a3b81a' }}
                  formatter={(value, name) => [money(Number(value ?? 0)), name === 'entradas' ? t('home.income') : t('home.expenses')]}
                  contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--foreground)' }}
                />
                <Bar dataKey="entradas" radius={[4, 4, 0, 0]} maxBarSize={34}>
                  {chartMonths.map((m) => <Cell key={m.key} fill={GREEN} fillOpacity={m.highlight ? 1 : 0.3} />)}
                </Bar>
                <Bar dataKey="saidas" radius={[4, 4, 0, 0]} maxBarSize={34}>
                  {chartMonths.map((m) => <Cell key={m.key} fill={RED} fillOpacity={m.highlight ? 1 : 0.3} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        {chartMonths.some((m) => !m.highlight) && <p className="mt-2 text-[11px] text-muted-foreground">{t('home.fadedMonths')}</p>}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6">
          <h2 className="mb-1 text-sm font-bold text-foreground">{t('home.whereItWent')}</h2>
          <p className="mb-4 text-xs text-muted-foreground">{t('home.whereItWentHint')}</p>
          <SpendingList items={spending ?? []} total={totals.expenses} money={money} t={t} />
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground">{t('home.latest')}</h2>
            <Link to="/transactions" className="text-sm font-semibold text-primary hover:underline">{t('home.seeAll')}</Link>
          </div>
          {recentLoading ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : (recent?.items ?? []).length === 0 || scopeEmpty ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('home.nothingYet')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent!.items.map((tx) => (
                <EntryRow key={tx.id} tx={tx} accounts={accountList ?? []} people={people} money={money} locale={locale} t={t} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {quickAddOpen && (
        <Suspense fallback={null}>
          <QuickAddTransaction open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

type T = ReturnType<typeof useTranslation>['t']

function Indicator({ title, value, tone, icon: Icon, change, inverse, detail, t }: {
  title: string
  value: string
  tone: 'green' | 'red' | 'primary'
  icon: React.ElementType
  change?: number | null
  inverse?: boolean
  detail?: string
  t: T
}) {
  const color = { green: 'text-emerald-600 dark:text-emerald-400', red: 'text-rose-600 dark:text-rose-400', primary: 'text-foreground' }[tone]
  const chip = { green: 'bg-emerald-500/10 text-emerald-600', red: 'bg-rose-500/10 text-rose-600', primary: 'bg-primary/10 text-primary' }[tone]
  // A rise is good news for income and bad news for spending.
  const good = change != null && (inverse ? change <= 0 : change >= 0)
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{title}</p>
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', chip)}><Icon className="h-4 w-4" /></span>
      </div>
      <p className={cn('mt-1 text-[clamp(1.05rem,4.6vw,1.6rem)] font-extrabold tabular-nums leading-tight', color)}>{value}</p>
      {change != null ? (
        <p className={cn('mt-1 text-[11px] font-semibold', good ? 'text-emerald-600' : 'text-rose-600')}>
          {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(0)}% <span className="font-normal text-muted-foreground">{t('home.vsBefore')}</span>
        </p>
      ) : detail ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  )
}

function SpendingList({ items, total, money, t }: { items: SpendingByCategory[]; total: number; money: (v: number) => string; t: T }) {
  const shown = items.filter((i) => i.total > 0).slice(0, 7)
  if (shown.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{t('home.noSpending')}</p>
  const base = total > 0 ? total : shown.reduce((s, i) => s + i.total, 0)
  return (
    <ul className="space-y-3">
      {shown.map((item) => {
        const pct = base > 0 ? (item.total / base) * 100 : 0
        return (
          <li key={item.category_id ?? item.category_name}>
            <Link
              to={item.category_id ? `/transactions?category_id=${item.category_id}` : '/transactions?uncategorized=true'}
              className="group block"
            >
              <div className="flex items-center gap-3">
                <CategoryIcon icon={item.category_icon} color={item.category_color} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground group-hover:text-primary">
                  {item.category_id ? item.category_name : t('home.uncategorized')}
                </span>
                <span className="text-sm font-bold tabular-nums text-foreground">{money(item.total)}</span>
                <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{pct.toFixed(0)}%</span>
              </div>
              <div className="ml-11 mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: item.category_color || '#94a3b8' }} />
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function EntryRow({ tx, accounts, people, money, locale, t }: {
  tx: Transaction
  accounts: Account[]
  people: ReturnType<typeof personOptions>
  money: (v: number) => string
  locale: string
  t: T
}) {
  const account = accounts.find((a) => a.id === tx.account_id)
  const owner = account && !account.is_joint ? people.find((p) => p.key === account.user_id) : undefined
  const transfer = tx.transfer_pair_id != null || tx.category?.treat_as_transfer
  const counterpart = tx.transfer_counterpart?.account_name
  const from = tx.type === 'debit' ? account && getAccountName(account) : counterpart
  const to = tx.type === 'debit' ? counterpart : account && getAccountName(account)
  // The caption carries what the person wrote about it first, like the
  // church app's legend; the category and account come after.
  const caption = [
    tx.notes,
    transfer ? null : tx.category?.name,
    account && getAccountName(account),
  ].filter(Boolean).join(' · ')
  const date = new Date(tx.date + 'T00:00:00').toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })
  return (
    <li className="flex items-center gap-3 py-2.5">
      {transfer ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600"><ArrowLeftRight className="h-4 w-4" /></span>
      ) : (
        <CategoryIcon icon={tx.category?.icon ?? 'circle-help'} color={tx.category?.color ?? '#94a3b8'} />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {transfer && from && to ? t('home.transferFromTo', { from, to }) : tx.description}
        </p>
        <p className="truncate text-xs text-muted-foreground">{transfer ? [tx.description, tx.notes].filter(Boolean).join(' · ') : caption}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={cn('text-sm font-bold tabular-nums', transfer ? 'text-foreground' : tx.type === 'credit' ? 'text-emerald-600' : 'text-foreground')}>
          {tx.type === 'credit' ? '+' : '−'}{money(Math.abs(Number(tx.amount)))}
        </p>
        <p className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          {owner?.initial && <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white', owner.color)}>{owner.initial}</span>}
          {date}
        </p>
      </div>
    </li>
  )
}

/** Category totals summed over several months, biggest first. */
function mergeSpending(perMonth: SpendingByCategory[][]): SpendingByCategory[] {
  const merged = new Map<string, SpendingByCategory>()
  for (const rows of perMonth) {
    for (const row of rows) {
      const key = row.category_id ?? '__none__'
      const prev = merged.get(key)
      merged.set(key, prev ? { ...prev, total: prev.total + Number(row.total) } : { ...row, total: Number(row.total) })
    }
  }
  return [...merged.values()].sort((a, b) => b.total - a.total)
}

