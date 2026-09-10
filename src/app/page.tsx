import Link from 'next/link';
import Logo from '@/components/Logo';

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'Customer Portal';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-16">
      <div className="w-full text-center">
        <div className="mb-8 flex justify-center">
          <Logo height={56} />
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Customer Portal
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
          Apply for a trade account with {APP_NAME}, place orders at your contracted
          prices, track every delivery, and view your statement of account.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/register" className="btn-primary px-6 py-2.5">
            Apply for an account
          </Link>
          <Link href="/login" className="btn-secondary px-6 py-2.5">
            Sign in
          </Link>
        </div>
      </div>

      <div className="mt-16 grid w-full gap-6 sm:grid-cols-3">
        {[
          {
            title: 'Apply online',
            body: 'Fill in the application form, upload your documents, and track the review.',
          },
          {
            title: 'Order at your price',
            body: 'Your contracted rates are applied automatically at checkout.',
          },
          {
            title: 'Follow every delivery',
            body: 'See each order move from approval to truck assignment to delivered.',
          },
        ].map((f) => (
          <div key={f.title} className="card p-6 text-left">
            <h2 className="font-semibold text-slate-900">{f.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{f.body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
