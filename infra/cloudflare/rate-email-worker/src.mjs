// QuoteFleet rate-email inbound Worker (Cloudflare Email Worker).
// Catch-all for quotefleet.net. Mail addressed to rates-<token>@… is parsed
// and POSTed to the app's inbound webhook; EVERYTHING else (and any error)
// forwards to support@loadmode.net — preserving the pre-existing catch-all
// behavior so no mail is ever lost.
import PostalMime from 'postal-mime';

const WEBHOOK_URL = 'https://quotefleet.net/api/inbound/rate-email';
const FALLBACK = 'support@loadmode.net';
// rates-<alphanumeric token>[+subaddr]@…  (mirrors parseInboundToken server-side)
const RATES_RE = /^rates-[0-9a-z]+(\+[^@]*)?@/i;

function toB64(u8) {
  const bytes = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export default {
  async email(message, env) {
    const to = String(message.to || '');
    if (!RATES_RE.test(to)) {
      return message.forward(FALLBACK); // not ours — behave like the old catch-all
    }
    try {
      const raw = await new Response(message.raw).arrayBuffer();
      const email = await PostalMime.parse(raw);
      const attachments = (email.attachments || []).map((a) => ({
        filename: a.filename || 'attachment',
        contentType: a.mimeType || 'application/octet-stream',
        contentBase64:
          typeof a.content === 'string'
            ? btoa(unescape(encodeURIComponent(a.content)))
            : toB64(a.content),
      }));
      const payload = {
        from: message.from,
        to,
        subject: email.subject || message.headers.get('subject') || '',
        text: email.text || '',
        html: email.html || '',
        attachments,
      };
      const resp = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Inbound-Secret': env.INBOUND_WEBHOOK_SECRET || '',
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        // Webhook rejected/failed — don't drop the mail; forward for manual handling.
        return message.forward(FALLBACK);
      }
    } catch (err) {
      try {
        return message.forward(FALLBACK);
      } catch (_) {
        /* nothing else we can do */
      }
    }
  },
};
