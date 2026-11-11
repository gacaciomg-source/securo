/**
 * Words that say how a payment was made, not where: a key built from them
 * would match half the statement.
 */
const NOISE = new Set([
  'PIX', 'TED', 'DOC', 'TEF', 'COMPRA', 'COMPRAS', 'PAGAMENTO', 'PAGTO', 'PAG', 'PGTO', 'TRANSF', 'TRANSFERENCIA',
  'TRANSFERÊNCIA', 'ENVIADA', 'ENVIADO', 'RECEBIDA', 'RECEBIDO', 'DEBITO', 'DÉBITO', 'CREDITO', 'CRÉDITO', 'CARTAO',
  'CARTÃO', 'ELO', 'VISA', 'MASTER', 'MASTERCARD', 'PARCELA', 'PARC', 'AUTOMATICO', 'AUTOMÁTICO', 'APLICACAO',
  'APLICAÇÃO', 'NACIONAL', 'INTERNACIONAL', 'ONLINE', 'LTDA', 'EIRELI', 'COM', 'BR', 'BRA', 'BRASIL',
  'DE', 'DA', 'DO', 'DAS', 'DOS', 'PARA', 'POR', 'THE', 'AND',
])

/** First words that name a kind of shop rather than the shop itself. */
const GENERIC = new Set([
  'MERCADO', 'SUPERMERCADO', 'POSTO', 'PADARIA', 'FARMACIA', 'FARMÁCIA', 'DROGARIA', 'RESTAURANTE', 'LOJA', 'LOJAS',
  'CASA', 'AUTO', 'BAR', 'LANCHONETE', 'ACOUGUE', 'AÇOUGUE', 'PET', 'CLINICA', 'CLÍNICA', 'ACADEMIA',
])

const isDistinctive = (word: string) => word.length >= 3 && !/\d/.test(word) && !NOISE.has(word.toUpperCase())

/**
 * The part of a bank description that names the merchant, for a rule that
 * catches the same purchase next time. It is always a contiguous piece of
 * the description, because the rule matches with "contains":
 * "DROGASIL 1234 SAO PAULO" gives "DROGASIL", "Mercado Pão de Açúcar"
 * gives "Mercado Pão", "PIX ENVIADO Maria Souza" gives "Maria Souza".
 * Null when nothing distinctive is left (a bare "PIX 12345").
 */
export function merchantKey(description: string): string | null {
  const tokens = [...description.matchAll(/[^\s*/|\\:;,()[\]]+/g)].map((m) => {
    const raw = m[0]
    const lead = raw.length - raw.replace(/^[-.#]+/, '').length
    const word = raw.replace(/^[-.#]+|[-.#]+$/g, '')
    const start = (m.index ?? 0) + lead
    return { word, start, end: start + word.length }
  })
  const i = tokens.findIndex((t) => isDistinctive(t.word))
  if (i < 0) return null
  const first = tokens[i]
  const next = tokens[i + 1]
  // A short or generic first word needs the next one, but only when the
  // two sit side by side, so the key is still in the text as written.
  const wantsMore = first.word.length < 6 || GENERIC.has(first.word.toUpperCase())
  if (wantsMore && next && isDistinctive(next.word) && description.slice(first.end, next.start) === ' ') {
    return description.slice(first.start, next.end)
  }
  return first.word.length >= 4 ? first.word : null
}
