/**
 * The physical file remains immutable. MP3 playback may present the audio after
 * a leading ID3 tag as byte zero, so embedded artwork need not precede sound.
 */
export function id3v2TagBytes(header: Uint8Array, fileSize: number): number | undefined {
  if (!Number.isSafeInteger(fileSize) || fileSize < 10 || header.byteLength < 10) return;
  if (header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) return 0;
  const version = header[3], revision = header[4], flags = header[5];
  if (version < 2 || version > 4 || revision === 0xff) return;
  // Each version reserves different low flag bits. In v2.2 bit 0x40 means
  // compression; only v2.4 permits the footer flag at 0x10.
  const allowedFlags = version === 2 ? 0xc0 : version === 3 ? 0xe0 : 0xf0;
  if (flags & ~allowedFlags) return;
  if (header[6] & 0x80 || header[7] & 0x80 || header[8] & 0x80 || header[9] & 0x80) return;
  const payload = header[6] * 0x200000 + header[7] * 0x4000 + header[8] * 0x80 + header[9];
  const bytes = 10 + payload + (version === 4 && flags & 0x10 ? 10 : 0);
  // At least one MPEG frame header must remain. Invalid or unsupported tags
  // retain the original representation instead of claiming a guessed offset.
  if (bytes > fileSize - 4) return;
  return bytes;
}

/** Validate the proposed audio boundary before omitting any physical bytes. */
export function isMpegAudioFrameHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) return false;
  const version = bytes[1] >> 3 & 3, layer = bytes[1] >> 1 & 3;
  const bitrate = bytes[2] >> 4, sampleRate = bytes[2] >> 2 & 3;
  return version !== 1 && layer !== 0 && bitrate !== 0xf && sampleRate !== 3 && (bytes[3] & 3) !== 2;
}

/** Map the native media request onto the same original file's byte interval. */
export function originalAudioRange(start: number, end: number, fileSize: number, audioOffset: number): { start: number; end: number; size: number } | undefined {
  if (!Number.isSafeInteger(fileSize) || !Number.isSafeInteger(audioOffset) || audioOffset < 0 || audioOffset >= fileSize
    || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= fileSize - audioOffset) return;
  return { start: start + audioOffset, end: end + audioOffset, size: fileSize - audioOffset };
}
