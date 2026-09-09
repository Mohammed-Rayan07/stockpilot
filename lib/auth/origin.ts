import { ForbiddenError } from '../errors';

/**
 * Second CSRF layer, behind `sameSite: 'lax'`.
 *
 * SameSite already stops the cookie riding along on a cross-site POST, but it is a
 * browser-enforced policy and older or misconfigured clients weaken it. Comparing the
 * Origin header to the app's own origin is a cheap, independent check that does not
 * depend on the browser honouring a cookie attribute.
 *
 * Call on every mutating request. Never on GET, because §5.5 forbids mutations on GET
 * in the first place.
 */
export function requireSameOrigin(request: Request): void {
  const appOrigin = process.env.APP_ORIGIN;

  if (!appOrigin) {
    throw new Error('APP_ORIGIN is not set');
  }

  const origin = request.headers.get('origin');

  // A missing Origin header is rejected rather than allowed. Browsers send it on every
  // cross-origin request and on same-origin state-changing requests; treating "absent"
  // as "trusted" is how this check gets bypassed.
  if (origin !== appOrigin) {
    throw new ForbiddenError('Request origin is not allowed.');
  }
}
