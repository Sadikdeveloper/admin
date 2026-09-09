import { useState } from 'react';
import { ChevronDown, Link2, Search } from 'lucide-react';
import type * as api from '../api';
import { formatDateTime, humanise, shortAddress } from '../lib/format';

/** Keeps cents/kobo and FX precision instead of rounding them away. */
function decimal(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

/** Reads a value out of the loosely-typed record bags the search API returns. */
function pick(bag: Record<string, unknown> | null | undefined, ...keys: string[]): string | null {
  if (!bag) return null;
  for (const key of keys) {
    const value = bag[key];
    if (value == null) continue;
    if (typeof value === 'number') return Number.isFinite(value) ? decimal(value) : null;
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  }
  return null;
}

function pickRaw(bag: Record<string, unknown> | null | undefined, ...keys: string[]): unknown {
  if (!bag) return undefined;
  for (const key of keys) if (bag[key] != null) return bag[key];
  return undefined;
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="match-field">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
    </div>
  );
}

function amountLine(amounts: Record<string, unknown> | null | undefined): string | null {
  const value = pickRaw(amounts, 'amount', 'value', 'grossAmount', 'amountMajor');
  const currency = pickRaw(amounts, 'currency', 'currencyCode', 'localCurrency');
  if (value == null) return null;
  const formatted = typeof value === 'number' ? decimal(value) : String(value);
  return currency ? `${formatted} ${String(currency)}` : formatted;
}

export function TransactionMatchCard({ match, index }: { match: api.TransactionMatch; index: number }) {
  const [open, setOpen] = useState(false);

  const gross = amountLine(match.amounts);
  const usd = pick(match.amounts, 'usdAmount', 'amountUsd', 'usd');
  const fee = pick(match.amounts, 'fee', 'feeAmount', 'fees');
  const net = pick(match.amounts, 'netAmount', 'net');
  const rate = pick(match.amounts, 'rate', 'fxRate', 'exchangeRate');

  const providerName = pick(match.provider, 'name', 'provider', 'code');
  const providerRef = pick(match.provider, 'reference', 'providerReference', 'id', 'transactionId');
  const providerStatus = pick(match.provider, 'status', 'providerStatus');

  const txHash = pick(match.onchain, 'txHash', 'hash', 'transactionHash');
  const chain = pick(match.onchain, 'chain', 'network', 'chainName');
  const token = pick(match.onchain, 'token', 'asset', 'symbol');
  const confirmations = pick(match.onchain, 'confirmations');

  const cpName = pick(match.counterparty, 'name', 'accountName', 'fullName');
  const cpAccount = pick(match.counterparty, 'accountNumber', 'account', 'address', 'phone');
  const cpBank = pick(match.counterparty, 'bank', 'bankName', 'institution');

  const lifecycle = Object.entries(match.lifecycle || {}).filter(
    ([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
  );

  const hasDetail = Boolean(
    lifecycle.length || match.related?.length || match.providerPayload || cpName || cpAccount || txHash,
  );

  return (
    <div className="match-card">
      <div className="match-card-head">
        <span className="match-index">#{index + 1}</span>
        <span className="match-source">{humanise(match.source)}</span>
        {match.reference && <span className="match-id">{match.reference}</span>}
        <span className={`match-status status-${(match.status || '').toLowerCase()}`}>{humanise(match.status)}</span>
      </div>

      <div className="match-fields">
        {match.customer && (
          <div className="match-section">
            <dt>Customer</dt>
            <dd>
              {match.customer.fullName || 'Unnamed customer'}
              {match.customer.phone && <span className="match-sub">{match.customer.phone}</span>}
              {match.customer.email && <span className="match-sub">{match.customer.email}</span>}
              <span className="match-sub">
                {match.customer.kycCompleted ? 'KYC verified' : 'KYC pending'} ·{' '}
                {match.customer.hasCreatedWallet ? 'Wallet created' : 'No wallet'}
                {match.customer.country ? ` · ${match.customer.country}` : ''}
              </span>
            </dd>
          </div>
        )}

        <Field label="Category" value={humanise(match.category)} />
        <Field label="Matched on" value={humanise(match.matchedOn)} />
        <Field label="Status scope" value={humanise(match.statusScope)} />
        <Field label="Amount" value={gross} />
        <Field label="USD value" value={usd} />
        <Field label="Fee" value={fee} />
        <Field label="Net" value={net} />
        <Field label="Rate" value={rate} />
        <Field label="Provider" value={providerName} />
        <Field label="Provider ref" value={providerRef} mono />
        <Field label="Provider status" value={providerStatus ? humanise(providerStatus) : null} />
        <Field label="Created" value={match.createdAt ? formatDateTime(match.createdAt) : null} />
        <Field label="Updated" value={match.updatedAt ? formatDateTime(match.updatedAt) : null} />
        <Field label="Settled" value={match.settledAt ? formatDateTime(match.settledAt) : null} />
      </div>

      {hasDetail && (
        <button type="button" className="match-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <ChevronDown size={14} className={open ? 'rotated' : ''} />
          {open ? 'Hide full trail' : 'Show full trail'}
        </button>
      )}

      {open && (
        <div className="match-detail">
          {(txHash || chain || token) && (
            <div className="match-detail-block">
              <p className="eyebrow">ON-CHAIN</p>
              <div className="match-fields">
                <Field label="Chain" value={chain} />
                <Field label="Token" value={token} />
                <Field label="Confirmations" value={confirmations} />
                <Field label="Tx hash" value={txHash ? shortAddress(txHash) : null} mono />
              </div>
            </div>
          )}

          {(cpName || cpAccount || cpBank) && (
            <div className="match-detail-block">
              <p className="eyebrow">COUNTERPARTY</p>
              <div className="match-fields">
                <Field label="Name" value={cpName} />
                <Field label="Account" value={cpAccount} mono />
                <Field label="Bank" value={cpBank} />
              </div>
            </div>
          )}

          {lifecycle.length > 0 && (
            <div className="match-detail-block">
              <p className="eyebrow">LIFECYCLE</p>
              <div className="match-fields">
                {lifecycle.map(([key, value]) => (
                  <Field
                    key={key}
                    label={humanise(key)}
                    value={
                      typeof value === 'boolean'
                        ? value
                          ? 'Yes'
                          : 'No'
                        : /at$|date$|time$/i.test(key)
                          ? formatDateTime(String(value))
                          : String(value)
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {match.related?.length > 0 && (
            <div className="match-detail-block">
              <p className="eyebrow">RELATED RECORDS</p>
              <ul className="related-list">
                {match.related.map(rel => (
                  <li key={`${rel.source}-${rel.id}`}>
                    <Link2 size={13} />
                    <span className="match-source">{humanise(rel.source)}</span>
                    <code>{rel.reference || rel.id}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {match.providerPayload && (
            <details className="payload">
              <summary>Raw provider payload</summary>
              <pre>{JSON.stringify(match.providerPayload, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Search panel                                                        */
/* ------------------------------------------------------------------ */

export function SearchPanel({
  eyebrow,
  query,
  setQuery,
  onSubmit,
  onClear,
  loading,
  result,
}: {
  eyebrow: string;
  query: string;
  setQuery: (q: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClear: () => void;
  loading: boolean;
  result: api.SearchResult | null;
}) {
  return (
    <section className="panel search-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>Find a transaction</h2>
        </div>
        <span className="muted">Reference, hash, phone or provider ID</span>
      </div>

      <form onSubmit={onSubmit}>
        <div className="search-input">
          <Search size={18} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="e.g. RWN-20260901-a1b2c3d4"
            aria-label="Search transactions"
          />
          {query && (
            <button type="button" className="search-clear" onClick={onClear} aria-label="Clear search">
              ✕
            </button>
          )}
          <button type="submit" disabled={loading || !query.trim()}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {result &&
        (result.matches.length > 0 ? (
          <div className="search-results">
            <div className="search-results-head">
              <strong>
                {result.matches.length} matching record{result.matches.length === 1 ? '' : 's'}
              </strong>
              <span>for "{result.query}"</span>
              {result.isRownReference && <span className="ref-badge">Rown reference</span>}
              <button type="button" className="search-results-clear" onClick={onClear}>
                Clear
              </button>
            </div>
            {result.matches.map((match, i) => (
              <TransactionMatchCard key={`${match.source}-${match.reference}-${i}`} match={match} index={i} />
            ))}
          </div>
        ) : (
          <div className="search-empty">
            <Search size={20} />
            <p>No transactions matched "{result.query}". Check the reference or try a full transaction hash.</p>
          </div>
        ))}
    </section>
  );
}
