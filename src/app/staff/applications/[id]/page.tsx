'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { FormSchema } from '@/lib/forms';

interface Detail {
  application: {
    id: string;
    referenceNo: string;
    status: string;
    data: Record<string, unknown>;
    businessName: string | null;
    applicantEmail: string;
    submittedAt: string | null;
    decisionNotes: string | null;
    customerId: string | null;
    companyName: string;
  };
  form: { schema: FormSchema; version: number };
  documents: { id: string; doc_key: string; file_name: string; size_bytes: string; status: string }[];
  events: {
    id: string;
    event_type: string;
    message: string | null;
    is_public: boolean;
    actor_label: string | null;
    created_at: string;
  }[];
}

type Action = 'approve' | 'reject' | 'request_info' | 'start_review';

export default function ReviewApplicationPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState({ paymentTermsDays: '', creditLimit: '' });
  const [busy, setBusy] = useState<Action | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/applications/${params.id}`);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? 'Application not found.');
      return;
    }
    setDetail(await res.json());
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(action: Action) {
    if (!detail) return;

    if ((action === 'reject' || action === 'request_info') && !notes.trim()) {
      setError('Please write a note explaining your decision.');
      return;
    }

    setBusy(action);
    setError(null);

    try {
      const payload: Record<string, unknown> = { action, notes: notes.trim() || undefined };
      if (action === 'approve') {
        if (terms.paymentTermsDays) payload.paymentTermsDays = Number(terms.paymentTermsDays);
        if (terms.creditLimit) payload.creditLimit = Number(terms.creditLimit);
      }

      const res = await fetch(`/api/staff/applications/${params.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? 'That action failed.');
        return;
      }

      if (action === 'approve') {
        router.push('/staff/applications');
        return;
      }
      setNotes('');
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (error && !detail) return <main className="p-10 text-center text-red-600">{error}</main>;
  if (!detail) return <main className="p-10 text-center text-slate-500">Loading…</main>;

  const { application, form, documents, events } = detail;
  const decided = ['approved', 'rejected', 'withdrawn'].includes(application.status);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/staff/applications" className="text-sm text-brand-600 hover:text-brand-700">
        ← Back to the queue
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {application.businessName ?? 'Untitled application'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            <span className="font-mono">{application.referenceNo}</span> ·{' '}
            {application.applicantEmail} · {application.companyName}
          </p>
        </div>
        <span className="badge bg-slate-100 text-slate-700">
          {application.status.replace(/_/g, ' ')}
        </span>
      </header>

      {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* ---- submitted answers ------------------------------------------ */}
        <div className="space-y-6 lg:col-span-2">
          {form.schema.sections.map((section) => (
            <section key={section.key} className="card p-6">
              <h2 className="text-base font-semibold text-slate-900">{section.title}</h2>
              <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {section.fields
                  .filter((f) => f.type !== 'section_note')
                  .map((f) => {
                    const raw = application.data[f.key];
                    const shown =
                      raw === true ? 'Yes'
                      : raw === false ? 'No'
                      : Array.isArray(raw) ? raw.join(', ')
                      : raw === undefined || raw === null || raw === '' ? '—'
                      : String(raw);

                    // Show the option label rather than the stored value.
                    const label =
                      f.options?.find((o) => o.value === String(raw))?.label ?? shown;

                    return (
                      <div key={f.key}>
                        <dt className="text-xs uppercase tracking-wide text-slate-400">
                          {f.label}
                        </dt>
                        <dd className="mt-0.5 text-sm text-slate-800">{label}</dd>
                      </div>
                    );
                  })}
              </dl>
            </section>
          ))}

          <section className="card p-6">
            <h2 className="text-base font-semibold text-slate-900">Documents</h2>
            {documents.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No documents were uploaded.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{d.doc_key}</p>
                      <p className="text-xs text-slate-500">
                        {d.file_name} · {(Number(d.size_bytes) / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <span className="badge bg-slate-100 text-slate-600">{d.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ---- decision panel --------------------------------------------- */}
        <div className="space-y-6">
          {!decided && (
            <section className="card p-6">
              <h2 className="text-base font-semibold text-slate-900">Decision</h2>

              <label htmlFor="notes" className="label mt-4">
                Notes
              </label>
              <textarea
                id="notes"
                rows={4}
                className="input"
                placeholder="Required when rejecting or asking for more information."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="terms" className="label">Terms (days)</label>
                  <input
                    id="terms"
                    type="number"
                    min={0}
                    className="input"
                    placeholder="30"
                    value={terms.paymentTermsDays}
                    onChange={(e) => setTerms((t) => ({ ...t, paymentTermsDays: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="credit" className="label">Credit limit</label>
                  <input
                    id="credit"
                    type="number"
                    min={0}
                    className="input"
                    placeholder="100000"
                    value={terms.creditLimit}
                    onChange={(e) => setTerms((t) => ({ ...t, creditLimit: e.target.value }))}
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Applied when you approve. The applicant&apos;s requested terms are only a request.
              </p>

              <div className="mt-5 space-y-2">
                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={busy !== null}
                  onClick={() => act('approve')}
                >
                  {busy === 'approve' ? 'Approving…' : 'Approve & create customer'}
                </button>
                <button
                  type="button"
                  className="btn-secondary w-full"
                  disabled={busy !== null}
                  onClick={() => act('request_info')}
                >
                  Ask for more information
                </button>
                <button
                  type="button"
                  className="btn-danger w-full"
                  disabled={busy !== null}
                  onClick={() => act('reject')}
                >
                  Reject
                </button>
                {application.status === 'submitted' && (
                  <button
                    type="button"
                    className="btn-secondary w-full"
                    disabled={busy !== null}
                    onClick={() => act('start_review')}
                  >
                    Mark as in review
                  </button>
                )}
              </div>
            </section>
          )}

          <section className="card p-6">
            <h2 className="text-base font-semibold text-slate-900">History</h2>
            <ol className="mt-4 space-y-3">
              {events.map((e) => (
                <li key={e.id} className="text-sm">
                  <p className="text-slate-800">
                    {e.message ?? e.event_type.replace(/_/g, ' ')}
                    {!e.is_public && (
                      <span className="ml-1 text-xs text-slate-400">(internal)</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">
                    {new Date(e.created_at).toLocaleString()}
                    {e.actor_label ? ` · ${e.actor_label}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </main>
  );
}
