'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import FormRenderer from '@/components/FormRenderer';
import SiteHeader from '@/components/SiteHeader';
import DocumentUpload from '@/components/DocumentUpload';
import type { FormSchema, FormData, ValidationError } from '@/lib/forms';

interface LoadedForm {
  formVersionId: string;
  name: string;
  description: string | null;
  company: { id: string; name: string };
  schema: FormSchema;
}

type Save = 'idle' | 'saving' | 'saved' | 'error';

export default function ApplyPage() {
  const router = useRouter();

  const [form, setForm] = useState<LoadedForm | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('draft');
  const [data, setData] = useState<FormData>({});
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [uploadedKeys, setUploadedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [save, setSave] = useState<Save>('idle');
  const [submitting, setSubmitting] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestData = useRef<FormData>({});

  // --- bootstrap ------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const meRes = await fetch('/api/auth/me');
        if (meRes.status === 401) {
          router.push('/login');
          return;
        }
        const me = await meRes.json();

        // Already approved — the application step is behind them.
        if (me.user?.customer) {
          router.push('/portal');
          return;
        }

        const formRes = await fetch('/api/public/form');
        if (!formRes.ok) {
          setFatal('No application form is published yet. Please contact us.');
          return;
        }
        const loaded: LoadedForm = await formRes.json();
        setForm(loaded);

        // Resume the existing application, or start one.
        const existingId: string | undefined = me.application?.id;
        if (existingId) {
          const appRes = await fetch(`/api/applications/${existingId}`);
          if (appRes.ok) {
            const app = await appRes.json();
            setApplicationId(app.application.id);
            setStatus(app.application.status);
            setData(app.application.data ?? {});
            latestData.current = app.application.data ?? {};
            setUploadedKeys((app.documents ?? []).map((d: { doc_key: string }) => d.doc_key));

            if (['submitted', 'under_review', 'approved', 'rejected'].includes(app.application.status)) {
              router.push(`/apply/${app.application.id}`);
              return;
            }
          }
        } else {
          const created = await fetch('/api/applications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ formVersionId: loaded.formVersionId, data: {} }),
          });
          if (created.ok) {
            const c = await created.json();
            setApplicationId(c.id);
          } else {
            setFatal((await created.json()).error ?? 'Could not start an application.');
          }
        }
      } catch {
        setFatal('Could not load the application form.');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  // --- autosave -------------------------------------------------------------
  const persist = useCallback(
    async (payload: FormData) => {
      if (!applicationId) return;
      setSave('saving');
      try {
        const res = await fetch(`/api/applications/${applicationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: payload }),
        });
        setSave(res.ok ? 'saved' : 'error');
      } catch {
        setSave('error');
      }
    },
    [applicationId],
  );

  function onChange(key: string, value: unknown) {
    setData((prev) => {
      const next = { ...prev, [key]: value };
      latestData.current = next;
      return next;
    });
    // Clear this field's error as soon as the applicant edits it.
    setErrors((prev) => prev.filter((e) => e.field !== key));

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(latestData.current), 1200);
  }

  async function submit() {
    if (!applicationId) return;
    setSubmitting(true);
    setErrors([]);

    try {
      // Flush any pending autosave first, so the server validates what the
      // applicant actually sees.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await persist(latestData.current);

      const res = await fetch(`/api/applications/${applicationId}/submit`, { method: 'POST' });
      const body = await res.json();

      if (!res.ok) {
        if (body.details) setErrors(body.details);
        setFatal(body.details ? null : body.error);
        // Take them to the first problem.
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      router.push(`/apply/${applicationId}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <main className="p-10 text-center text-slate-500">Loading…</main>;
  }
  if (fatal && !form) {
    return <main className="p-10 text-center text-red-600">{fatal}</main>;
  }
  if (!form) return null;

  const readOnly = !['draft', 'info_requested'].includes(status);

  return (
    <>
      <SiteHeader href="/" />
      <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm font-medium text-brand-600">{form.company.name}</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{form.name}</h1>
        {form.description && <p className="mt-2 text-sm text-slate-600">{form.description}</p>}

        <p className="mt-3 text-xs text-slate-400">
          {save === 'saving' && 'Saving…'}
          {save === 'saved' && 'Draft saved.'}
          {save === 'error' && <span className="text-red-500">Could not save your draft.</span>}
          {save === 'idle' && 'Your answers save automatically as you type.'}
        </p>
      </header>

      {errors.length > 0 && (
        <div className="mb-6 rounded-md bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Please fix {errors.length} {errors.length === 1 ? 'item' : 'items'} before submitting:
          </p>
          <ul className="mt-2 list-inside list-disc text-sm text-red-700">
            {errors.slice(0, 8).map((e) => (
              <li key={e.field}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      <FormRenderer
        schema={form.schema}
        data={data}
        errors={errors}
        disabled={readOnly}
        onChange={onChange}
      />

      {applicationId && form.schema.documents?.length ? (
        <div className="mt-8">
          <DocumentUpload
            applicationId={applicationId}
            documents={form.schema.documents}
            uploadedKeys={uploadedKeys}
            disabled={readOnly}
            onUploaded={(key) => setUploadedKeys((k) => (k.includes(key) ? k : [...k, key]))}
          />
        </div>
      ) : null}

      {!readOnly && (
        <div className="mt-8 flex items-center justify-end gap-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => persist(latestData.current)}
            disabled={save === 'saving'}
          >
            Save draft
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>
        </div>
      )}
      </main>
    </>
  );
}
