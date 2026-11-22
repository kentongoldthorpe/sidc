// Message envelopes: the single shape for every command, query, event and reply that
// crosses the hexagon boundary. Envelopes are plain JSON data and deep-frozen.
//
//   { kind, type, v, id, correlationId, causationId, at, payload, meta }
//
// Building an envelope with bad input is a programmer error and throws TypeError.
// Checking an envelope that came from outside (UI, storage, a file) uses
// validateEnvelope(), which returns a Result with every problem found.
import { cloneJson, isJsonObject, isJsonValue } from './freeze.js';
import { ErrorCode, isAppError } from './errors.js';
import { ok, err, isResult } from './result.js';

export const MessageKind = Object.freeze({
  COMMAND: 'command',
  QUERY: 'query',
  EVENT: 'event',
  REPLY: 'reply',
});

/**
 * @typedef {'command'|'query'|'event'|'reply'} Kind
 * @typedef {Object} Envelope
 * @property {Kind} kind
 * @property {string} type            dotted lower-case, e.g. "symbol.add"; replies end in ".reply"
 * @property {number} v               payload schema version (integer ≥ 1)
 * @property {string} id              unique message id
 * @property {string} correlationId   id of the root message of this chain
 * @property {string|null} causationId id of the message that directly caused this one
 * @property {string} at              ISO-8601 UTC, canonical toISOString() form
 * @property {Object} payload         JSON object (a Result for replies)
 * @property {{source:string, actor?:string}} meta
 *
 * @typedef {{ kind: Kind, type: string, v: number, payload: Object, meta: Object }} EnvelopeInput
 * @typedef {{ id: string, now: string }} Stamp  id from IdGenerator, now from Clock
 */

const FIELDS = Object.freeze(['kind', 'type', 'v', 'id', 'correlationId', 'causationId', 'at', 'payload', 'meta']);
const KINDS = new Set(Object.values(MessageKind));
const REPLY_SUFFIX = '.reply';
const MAX_ID_LENGTH = 128;
const TYPE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;
const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

/** causationId of a reply to a request whose own id was unusable. */
export const UNKNOWN_CAUSATION = 'unknown';

/** True for a valid command / query / event type (dotted lower-case, not ending in ".reply"). */
export const isMessageType = (t) => typeof t === 'string' && TYPE_PATTERN.test(t) && !t.endsWith(REPLY_SUFFIX);

const isId = (v) => typeof v === 'string' && v.trim() !== '' && v.length <= MAX_ID_LENGTH;
const isNonBlankString = (v) => typeof v === 'string' && v.trim() !== '';

const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/** Canonical UTC timestamp as produced by Date#toISOString, e.g. 2026-11-22T20:40:00.000Z */
export function isIsoUtcTimestamp(value) {
  const m = typeof value === 'string' && value.match(ISO_UTC);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  return month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth(year, month)
    && hour <= 23 && minute <= 59 && second <= 59;
}

/** @returns {{field:string, reason:string}[]} every problem, in field order */
function findProblems(e) {
  if (e === null || typeof e !== 'object' || Array.isArray(e)) {
    return [{ field: '(root)', reason: 'must be an object' }];
  }
  const problems = [];
  const add = (field, reason) => problems.push({ field, reason });
  const isReply = e.kind === MessageKind.REPLY;

  if (!KINDS.has(e.kind)) add('kind', `must be one of ${[...KINDS].join(', ')}`);

  if (typeof e.type !== 'string' || !TYPE_PATTERN.test(e.type)) {
    add('type', 'must be lower-case dotted segments, e.g. "symbol.add"');
  } else if (isReply !== e.type.endsWith(REPLY_SUFFIX)) {
    add('type', isReply ? 'a reply type must end in ".reply"' : 'only replies may end in ".reply"');
  }

  if (!Number.isInteger(e.v) || e.v < 1) add('v', 'must be an integer ≥ 1');

  if (!isId(e.id)) add('id', `must be a non-blank string of at most ${MAX_ID_LENGTH} characters`);

  if (!isId(e.correlationId)) {
    add('correlationId', `must be a non-blank string of at most ${MAX_ID_LENGTH} characters`);
  } else if (!isReply && isId(e.id) && e.causationId === null && e.correlationId !== e.id) {
    add('correlationId', 'a root message (causationId null) must correlate to itself');
  }

  if (!('causationId' in e) || (e.causationId !== null && !isId(e.causationId))) {
    add('causationId', 'must be null or a message id');
  } else if (e.causationId !== null && e.causationId === e.id) {
    add('causationId', 'a message cannot cause itself');
  } else if (isReply && e.causationId === null) {
    add('causationId', 'a reply must reference the request it answers');
  }

  if (!isIsoUtcTimestamp(e.at)) add('at', 'must be an ISO-8601 UTC timestamp like 2026-11-22T20:40:00.000Z');

  if (!isJsonObject(e.payload)) {
    add('payload', 'must be a plain JSON object');
  } else if (isReply && !isResult(e.payload)) {
    add('payload', 'a reply payload must be a Result: { ok: true, value } or { ok: false, error }');
  }

  if (!isJsonObject(e.meta)) {
    add('meta', 'must be a plain JSON object');
  } else {
    if (!isNonBlankString(e.meta.source)) add('meta.source', 'must be a non-blank string naming the sender');
    if ('actor' in e.meta && !isNonBlankString(e.meta.actor)) add('meta.actor', 'must be a non-blank string when present');
  }

  for (const key of Object.keys(e)) if (!FIELDS.includes(key)) add(key, 'unknown field');

  return problems;
}

/**
 * Check an envelope from outside the core.
 * @returns {import('./result.js').Result<Envelope>} the same object on success
 */
export function validateEnvelope(value) {
  const problems = findProblems(value);
  return problems.length === 0
    ? ok(value)
    : err(ErrorCode.INVALID_ENVELOPE, 'Invalid message envelope', { problems });
}

/** @returns {boolean} */
export const isEnvelope = (value) => findProblems(value).length === 0;

function build(caller, candidate) {
  const problems = findProblems(candidate);
  if (problems.length) {
    const list = problems.map((p) => `${p.field}: ${p.reason}`).join('; ');
    throw new TypeError(`${caller}: invalid envelope — ${list}`);
  }
  return Object.freeze({ ...candidate, payload: cloneJson(candidate.payload), meta: cloneJson(candidate.meta) });
}

function assertNotReply(caller, kind) {
  if (kind === MessageKind.REPLY) throw new TypeError(`${caller}: build replies with createReply()`);
}

/**
 * Start a new message chain.
 * @param {EnvelopeInput} input @param {Stamp} stamp @returns {Readonly<Envelope>}
 */
export function createEnvelope({ kind, type, v, payload, meta }, { id, now }) {
  assertNotReply('createEnvelope', kind);
  return build('createEnvelope', { kind, type, v, id, correlationId: id, causationId: null, at: now, payload, meta });
}

/**
 * A message caused by `parent` (e.g. the event a command produced).
 * @param {Envelope} parent @param {EnvelopeInput} input @param {Stamp} stamp @returns {Readonly<Envelope>}
 */
export function deriveEnvelope(parent, { kind, type, v, payload, meta }, { id, now }) {
  if (!isEnvelope(parent)) throw new TypeError('deriveEnvelope: parent is not a valid envelope');
  assertNotReply('deriveEnvelope', kind);
  return build('deriveEnvelope', {
    kind, type, v, id, correlationId: parent.correlationId, causationId: parent.id, at: now, payload, meta,
  });
}

/**
 * The reply to a command or query. A void success (value undefined) becomes value null.
 * @param {Envelope} request @param {import('./result.js').Result<unknown>} result
 * @param {Stamp & { source?: string }} stamp @returns {Readonly<Envelope>}
 */
export function createReply(request, result, { id, now, source = 'app' }) {
  if (!isEnvelope(request) || (request.kind !== MessageKind.COMMAND && request.kind !== MessageKind.QUERY)) {
    throw new TypeError('createReply: request must be a valid command or query envelope');
  }
  if (!isResult(result)) throw new TypeError('createReply: result must be a Result');
  const payload = result.ok
    ? { ok: true, value: result.value === undefined ? null : result.value }
    : { ok: false, error: result.error };
  if (!isJsonValue(payload)) throw new TypeError('createReply: result value must be plain JSON data');
  return build('createReply', {
    kind: MessageKind.REPLY, type: `${request.type}${REPLY_SUFFIX}`, v: 1, id,
    correlationId: request.correlationId, causationId: request.id, at: now, payload, meta: { source },
  });
}

/**
 * A failure reply to something that is not a valid envelope (or not the expected kind),
 * so a sender always gets a well-formed reply. Links to the request where its id, type
 * and correlationId are usable; otherwise uses type "invalid.message.reply" and
 * causationId UNKNOWN_CAUSATION.
 * @param {unknown} request @param {import('./errors.js').AppError} error
 * @param {Stamp & { source?: string }} stamp @returns {Readonly<Envelope>}
 */
export function createReplyToInvalid(request, error, { id, now, source = 'app' }) {
  if (!isAppError(error)) throw new TypeError('createReplyToInvalid: error must be an AppError');
  const r = request !== null && typeof request === 'object' ? request : {};
  const requestId = isId(r.id) && r.id !== id ? r.id : null;
  return build('createReplyToInvalid', {
    kind: MessageKind.REPLY,
    type: isMessageType(r.type) ? `${r.type}${REPLY_SUFFIX}` : `invalid.message${REPLY_SUFFIX}`,
    v: 1,
    id,
    correlationId: isId(r.correlationId) ? r.correlationId : requestId ?? id,
    causationId: requestId ?? UNKNOWN_CAUSATION,
    at: now,
    payload: { ok: false, error },
    meta: { source },
  });
}
