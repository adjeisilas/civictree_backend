import crypto from 'crypto';
import config from '../../config/config.js';

/**
 * Signed USSD ClientState.
 *
 * Hubtel echoes ClientState back to us on the next request, but anyone who POSTs directly to our
 * USSD URL can send any ClientState they like (e.g. a CONFIRM step with their own price, or a
 * TX_SELECT step listing someone else's orders). Every state we issue is therefore signed with an
 * HMAC bound to the SessionId and Mobile number, and unsigned or altered states are rejected.
 */

const SIGNATURE_SEPARATOR = '~';
const SIGNATURE_LENGTH = 22;

// Derived from the JWT access secret so no extra environment variable is needed.
const stateKey = crypto
  .createHmac('sha256', process.env.USSD_STATE_SECRET || config.jwt.accessSecret)
  .update('ussd-client-state')
  .digest();

const computeSignature = (state, sessionId, mobile) =>
  crypto
    .createHmac('sha256', stateKey)
    .update(`${sessionId}|${mobile}|${state}`)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);

/**
 * Returns the ClientState string to send to Hubtel for the given state.
 * @param {string} state - e.g. 'SELECT_OPTION' or 'CONFIRM:BECE:2'
 * @param {{ sessionId: string, mobile: string }} context
 */
export const signUssdState = (state, { sessionId, mobile }) =>
  `${state}${SIGNATURE_SEPARATOR}${computeSignature(state, sessionId, mobile)}`;

/**
 * Returns the state carried by a ClientState we issued for this session, or null when the
 * ClientState is missing, unsigned, altered, or was issued for another session or number.
 * @param {string} clientState - ClientState received in the request
 * @param {{ sessionId: string, mobile: string }} context
 */
export const readUssdState = (clientState, { sessionId, mobile }) => {
  if (!clientState || typeof clientState !== 'string') return null;

  const separatorIndex = clientState.lastIndexOf(SIGNATURE_SEPARATOR);
  if (separatorIndex <= 0) return null;

  const state = clientState.slice(0, separatorIndex);
  const signature = Buffer.from(clientState.slice(separatorIndex + 1));
  const expected = Buffer.from(computeSignature(state, sessionId, mobile));

  if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) {
    return null;
  }
  return state;
};
