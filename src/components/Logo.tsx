import Image from 'next/image';

/**
 * The company mark.
 *
 * Looks for /logo.svg then /logo.png at build time via NEXT_PUBLIC_LOGO_URL,
 * and falls back to a wordmark when no file is present — so the portal never
 * renders a broken image, and dropping a logo into /public is the only step
 * needed to brand it.
 */

const LOGO_SRC = process.env.NEXT_PUBLIC_LOGO_URL ?? '/logo.png';
const COMPANY = process.env.NEXT_PUBLIC_APP_NAME ?? 'Artfresh';
const HAS_LOGO = process.env.NEXT_PUBLIC_HAS_LOGO === 'true';

interface Props {
  /** Rendered height in px; width scales with the image's aspect ratio. */
  height?: number;
  /** Show the company name beside the mark. */
  showName?: boolean;
  className?: string;
}

export default function Logo({ height = 32, showName = false, className = '' }: Props) {
  if (!HAS_LOGO) {
    return <Wordmark height={height} className={className} />;
  }

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Image
        src={LOGO_SRC}
        alt={COMPANY}
        height={height}
        width={height * 4}
        priority
        className="w-auto object-contain"
        style={{ height }}
      />
      {showName && (
        <span className="text-lg font-semibold tracking-tight text-slate-900">{COMPANY}</span>
      )}
    </span>
  );
}

/**
 * Typographic fallback. Deliberately plain — a placeholder that looks like a
 * placeholder is better than one mistaken for the real brand.
 */
function Wordmark({ height, className }: { height: number; className: string }) {
  return (
    <span
      className={`inline-flex items-center font-semibold tracking-tight text-slate-900 ${className}`}
      style={{ fontSize: Math.round(height * 0.6), lineHeight: 1 }}
    >
      <span
        className="mr-2 inline-flex items-center justify-center rounded-md bg-brand-600 font-bold text-white"
        style={{ height, width: height, fontSize: Math.round(height * 0.5) }}
        aria-hidden="true"
      >
        {COMPANY.charAt(0).toUpperCase()}
      </span>
      {COMPANY}
    </span>
  );
}
