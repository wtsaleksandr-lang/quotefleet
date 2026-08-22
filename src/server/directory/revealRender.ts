/**
 * Server-rendered HTML fragment for the Directory Pro "Reveal additional
 * contacts" result. The reveal endpoint returns this fragment; the small inline
 * enhancement script in pages.ts swaps it into the profile's `.cp-reveal-result`
 * container (and it also stands alone as the no-JS POST response).
 *
 * Pure (no DB / no network) so it is unit-testable in isolation. Theme-aware
 * (token-only via the `.cp-reveal-*` classes styled in pages.ts), every value
 * escaped, links encoded. Renders the empty / message states too.
 */
import type { RevealedContact } from './carrierContacts.js';

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] as string,
  );
}

/** A plain status message (loading / cap-reached / error). `kind` themes it. */
export function renderRevealMessage(message: string, kind: 'note' | 'error' = 'note'): string {
  const cls = kind === 'error' ? 'cp-reveal-msg cp-reveal-msg--error' : 'cp-reveal-msg';
  return `<p class="${cls}" role="status">${esc(message)}</p>`;
}

function contactCard(c: RevealedContact): string {
  const heading = [c.contactName, c.title].filter((x) => x && String(x).trim()).map(esc).join(' · ');
  const rows: string[] = [];
  if (c.email) {
    rows.push(
      `<div class="cp-contact-row"><span class="k">Email</span><span class="v"><a href="mailto:${encodeURIComponent(
        c.email,
      )}">${esc(c.email)}</a></span></div>`,
    );
  }
  if (c.phone) {
    rows.push(
      `<div class="cp-contact-row"><span class="k">Phone</span><span class="v"><a href="tel:${encodeURIComponent(
        c.phone,
      )}">${esc(c.phone)}</a></span></div>`,
    );
  }
  const conf =
    c.confidence === 'high' || c.confidence === 'low'
      ? `<span class="cp-reveal-conf cp-reveal-conf--${c.confidence}">${esc(c.confidence)} confidence</span>`
      : '';
  return `<div class="cp-reveal-card">
      <div class="cp-reveal-name">${heading || 'Website contact'}${conf}</div>
      ${rows.join('')}
    </div>`;
}

/**
 * Render the revealed contacts. Empty ⇒ a friendly "nothing found" note. The
 * free FMCSA phone/email block above this is untouched — these are ONLY the
 * additional/enriched contacts.
 */
export function renderRevealedContacts(contacts: RevealedContact[]): string {
  if (!contacts.length) {
    return renderRevealMessage('No additional contacts found for this carrier.');
  }
  const n = contacts.length;
  const note = `${n} additional contact${n === 1 ? '' : 's'} found from the carrier's website.`;
  return `<div class="cp-reveal-list">
      <p class="cp-reveal-note">${esc(note)}</p>
      ${contacts.map(contactCard).join('\n')}
    </div>`;
}
