import Link from 'next/link';
import Logo from '@/components/Logo';

interface Props {
  /** Where the logo links to — the portal for customers, queue for staff. */
  href?: string;
  /** Rendered to the right of the logo: nav links, a sign-out button, etc. */
  children?: React.ReactNode;
}

export default function SiteHeader({ href = '/', children }: Props) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href={href} className="flex items-center" aria-label="Home">
          <Logo height={30} />
        </Link>
        {children && <div className="flex items-center gap-4">{children}</div>}
      </div>
    </header>
  );
}
