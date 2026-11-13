import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import streaming from '../../rebuild/core/streaming.js';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, If-Range, If-Match, Authorization, Content-Type, X-Sakura-Playback',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, X-Audio-Size, Retry-After',
  'Access-Control-Max-Age': '86400'
};
export const features = ['exact-metadata-search', 'verified-metadata-aliases', 'resumable-ranges', 'document-etag'];
export const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store', ...headers } });
export const audioRoute = path => /^\/v2\/audio\/([a-zA-Z0-9_]{3,64})\/([1-9]\d{0,14})$/.exec(path);
export const tagOf = audio => '"' + createHash('sha256').update(JSON.stringify([audio.chatScope, audio.messageId, audio.fileId, audio.size, audio.mimeType])).digest('hex') + '"';
export const validTag = tag => typeof tag === 'string' && /^"[a-f0-9]{64}"$/.test(tag);
export const signature = (secret, bot, id, exp, tag) => createHmac('sha256', secret).update(JSON.stringify([bot.toLowerCase(), String(id), exp, ...(tag ? [tag] : [])])).digest('hex');
export function authorized(request, secret) {
  if (!secret || secret.length < 24) return false;
  const bearer = request.headers.get('Authorization') || '';
  if (bearer.startsWith('Bearer ') && timingSafeEqual(createHash('sha256').update(bearer.slice(7).trim()).digest(), createHash('sha256').update(secret).digest())) return true;
  const url = new URL(request.url), audio = audioRoute(url.pathname);
  if (!audio || !['GET', 'HEAD'].includes(request.method)) return false;
  const query = url.searchParams, exp = Number(query.get('exp')), sig = query.get('sig') || '', tag = query.get('documentTag');
  if (query.getAll('exp').length !== 1 || query.getAll('sig').length !== 1 || query.getAll('documentTag').length > 1 || !Number.isSafeInteger(exp) || exp < Date.now() / 1000 || !/^[a-f0-9]{64}$/.test(sig) || (tag !== null && !validTag(tag))) return false;
  return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(signature(secret, audio[1], audio[2], exp, tag), 'hex'));
}
export async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const parts = []; let count = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; count += part.value.length; if (count > 1024 * 1024) throw new Error('Request body too large'); parts.push(part.value); }
    const value = JSON.parse(Buffer.concat(parts, count).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON body');
    return value;
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
export function audioHeaders(request, audio) {
  const etag = tagOf(audio), url = new URL(request.url), signedTag = url.searchParams.get('documentTag'), ifMatch = request.headers.get('If-Match');
  const headers = { ...CORS, 'Content-Type': audio.mimeType, 'Cache-Control': 'private, max-age=3600', 'Accept-Ranges': 'bytes', ETag: etag, 'X-Audio-Size': String(audio.size), 'X-Content-Type-Options': 'nosniff' };
  const matches = tag => tag === '*' || tag.split(',').map(v => v.trim()).includes(etag);
  if ((signedTag && signedTag !== etag) || (ifMatch && !matches(ifMatch))) return { response: new Response(null, { status: 412, headers }) };
  const useRange = request.method !== 'HEAD' && (!request.headers.get('If-Range') || request.headers.get('If-Range') === etag);
  const range = streaming.parseByteRange(useRange ? request.headers.get('Range') : null, audio.size);
  if (range.status === 'unsatisfiable') return { response: new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${audio.size}` } }) };
  const start = range.status === 'range' ? range.start : 0, end = range.status === 'range' ? range.end : audio.size - 1;
  headers['Content-Length'] = String(end - start + 1);
  if (range.status === 'range') headers['Content-Range'] = `bytes ${start}-${end}/${audio.size}`;
  return { start, length: end - start + 1, headers, status: range.status === 'range' ? 206 : 200,
    playback: request.method === 'GET' && (request.headers.get('X-Sakura-Playback') === '1' || request.headers.get('Sec-Fetch-Dest') === 'audio') };
}
