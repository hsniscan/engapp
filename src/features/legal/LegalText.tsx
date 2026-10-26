import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CONTACT_FALLBACK_URL } from '@/legal/contact';

/**
 * Renders the small inline markup of the legal texts (src/legal/types.ts): **bold**,
 * [label](href) and {{email}}. Internal paths use the router; mailto/https are plain links.
 * Without a contact e-mail, {{email}} becomes a link to the public feedback page labelled
 * `missingEmail`.
 */
export function LegalText({
  text,
  email,
  missingEmail,
}: {
  text: string;
  email: string | null;
  missingEmail: string;
}) {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\{\{email\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(
        <strong key={k++} className="font-semibold text-fg">
          <LegalText text={m[1]} email={email} missingEmail={missingEmail} />
        </strong>,
      );
    } else if (m[2] !== undefined && m[3] !== undefined) {
      out.push(<LegalLink key={k++} href={m[3]} label={m[2]} />);
    } else if (email) {
      out.push(<LegalLink key={k++} href={`mailto:${email}`} label={email} />);
    } else {
      out.push(<LegalLink key={k++} href={CONTACT_FALLBACK_URL} label={missingEmail} />);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
}

const linkClass =
  'font-medium text-accent-text underline decoration-1 underline-offset-2 hover:decoration-2';

function LegalLink({ href, label }: { href: string; label: string }) {
  if (href.startsWith('/')) {
    return (
      <Link to={href} className={linkClass}>
        {label}
      </Link>
    );
  }
  const external = /^https:\/\//.test(href);
  return (
    <a
      href={href}
      className={linkClass}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {label}
    </a>
  );
}
