/**
 * Lightweight zero-dependency ISO-BMFF (MP4) video track demuxer for WebCodecs `VideoDecoder`.
 * Extracts exact sample offsets, sizes, presentation timestamps (PTS with ctts/elst support),
 * keyframes (stss), and codec configuration records (avcC / hvcC / vpcC / av1C).
 */

export interface Mp4VideoSample {
  offset: number;
  size: number;
  dtsUs: number;
  ptsUs: number;
  durationUs: number;
  isKey: boolean;
}

export interface Mp4VideoTrackInfo {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  description?: Uint8Array;
  timescale: number;
  durationUs: number;
  samples: Mp4VideoSample[];
}

interface BoxRange {
  type: string;
  start: number;
  payloadStart: number;
  end: number;
}

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function readUint64(view: DataView, offset: number): number {
  const hi = view.getUint32(offset, false);
  const lo = view.getUint32(offset + 4, false);
  return hi * 4294967296 + lo;
}

function readInt64(view: DataView, offset: number): number {
  const hi = view.getInt32(offset, false);
  const lo = view.getUint32(offset + 4, false);
  return hi * 4294967296 + lo;
}

function iterBoxes(
  view: DataView,
  bytes: Uint8Array,
  start: number,
  end: number,
): BoxRange[] {
  const boxes: BoxRange[] = [];
  let off = start;
  while (off + 8 <= end) {
    let size = view.getUint32(off, false);
    const type = readFourCC(bytes, off + 4);
    let hdr = 8;
    if (size === 1) {
      if (off + 16 > end) break;
      size = readUint64(view, off + 8);
      hdr = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < hdr || off + size > end) break;
    boxes.push({
      type,
      start: off,
      payloadStart: off + hdr,
      end: off + size,
    });
    off += size;
  }
  return boxes;
}

function findBox(
  view: DataView,
  bytes: Uint8Array,
  start: number,
  end: number,
  type: string,
): BoxRange | null {
  for (const box of iterBoxes(view, bytes, start, end)) {
    if (box.type === type) return box;
  }
  return null;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

function parseStsdVideo(
  view: DataView,
  bytes: Uint8Array,
  stsd: BoxRange,
): { codec: string; codedWidth: number; codedHeight: number; description?: Uint8Array } | null {
  // FullBox: version(1) + flags(3) + entryCount(4) = 8 bytes
  const entryStart = stsd.payloadStart + 8;
  if (entryStart + 8 > stsd.end) return null;
  const entries = iterBoxes(view, bytes, entryStart, stsd.end);
  const entry = entries[0];
  if (!entry) return null;

  // VisualSampleEntry has 78 bytes of fixed header fields after the 8-byte box header:
  // reserved(6) + data_ref_idx(2) + pre_defined/reserved(16) + width(2) + height(2) + ...
  if (entry.payloadStart + 78 > entry.end) return null;
  const codedWidth = view.getUint16(entry.payloadStart + 24, false);
  const codedHeight = view.getUint16(entry.payloadStart + 26, false);
  const childStart = entry.payloadStart + 78;
  const children = iterBoxes(view, bytes, childStart, entry.end);

  if (entry.type === "avc1" || entry.type === "avc3") {
    const avcC = children.find((b) => b.type === "avcC");
    if (!avcC || avcC.end - avcC.payloadStart < 4) return null;
    const description = bytes.slice(avcC.payloadStart, avcC.end);
    const codec = `${entry.type}.${hex2(description[1])}${hex2(description[2])}${hex2(description[3])}`;
    return { codec, codedWidth, codedHeight, description };
  }

  if (entry.type === "hvc1" || entry.type === "hev1") {
    const hvcC = children.find((b) => b.type === "hvcC");
    if (!hvcC || hvcC.end - hvcC.payloadStart < 13) return null;
    const description = bytes.slice(hvcC.payloadStart, hvcC.end);
    const generalProfileSpace = (description[1] >> 6) & 0x03;
    const generalTierFlag = (description[1] >> 5) & 0x01;
    const generalProfileIdc = description[1] & 0x1f;
    const profileSpaceStr = ["", "A", "B", "C"][generalProfileSpace] ?? "";
    const tierChar = generalTierFlag ? "H" : "L";
    const generalLevelIdc = description[12];
    // Reversed profile compatibility bits per ISO/IEC 14496-15
    const compat = view.getUint32(hvcC.payloadStart + 2, false);
    let revCompat = 0;
    for (let i = 0; i < 32; i++) {
      revCompat = (revCompat << 1) | ((compat >>> i) & 1);
    }
    const compatHex = (revCompat >>> 0).toString(16);
    const codec = `${entry.type}.${profileSpaceStr}${generalProfileIdc}.${compatHex}.${tierChar}${generalLevelIdc}.B0`;
    return { codec, codedWidth, codedHeight, description };
  }

  if (entry.type === "vp09") {
    const vpcC = children.find((b) => b.type === "vpcC");
    if (!vpcC || vpcC.end - vpcC.payloadStart < 10) return null;
    // vpcC is a FullBox (4 bytes version/flags), then profile(1), level(1), bitDepth+chroma(1)
    const p = vpcC.payloadStart + 4;
    const profile = bytes[p];
    const level = bytes[p + 1];
    const bitDepth = (bytes[p + 2] >> 4) & 0x0f;
    const codec = `vp09.${String(profile).padStart(2, "0")}.${String(level).padStart(2, "0")}.${String(bitDepth).padStart(2, "0")}`;
    return { codec, codedWidth, codedHeight };
  }

  if (entry.type === "av01") {
    const av1C = children.find((b) => b.type === "av1C");
    if (!av1C || av1C.end - av1C.payloadStart < 4) return null;
    const description = bytes.slice(av1C.payloadStart, av1C.end);
    const seqProfile = (description[1] >> 5) & 0x07;
    const seqLevelIdx0 = description[1] & 0x1f;
    const seqTier0 = (description[2] >> 7) & 0x01;
    const highBitdepth = (description[2] >> 6) & 0x01;
    const twelveBit = (description[2] >> 5) & 0x01;
    const bitDepth = highBitdepth ? (twelveBit ? 12 : 10) : 8;
    const codec = `av01.${seqProfile}.${String(seqLevelIdx0).padStart(2, "0")}${seqTier0 ? "H" : "M"}.${String(bitDepth).padStart(2, "0")}`;
    return { codec, codedWidth, codedHeight, description };
  }

  return null;
}

/**
 * Parse the primary video track of a non-fragmented MP4 container.
 * Returns `null` if the buffer is not a supported MP4 or contains no sample table (e.g. fragmented MP4/WebM).
 */
export function parseMp4VideoTrack(buffer: ArrayBuffer): Mp4VideoTrackInfo | null {
  if (buffer.byteLength < 32) return null;
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const topBoxes = iterBoxes(view, bytes, 0, buffer.byteLength);
  const moov = topBoxes.find((b) => b.type === "moov");
  if (!moov) return null;

  // Read movie timescale from mvhd (used if edts/elst specifies an initial empty edit)
  const mvhd = findBox(view, bytes, moov.payloadStart, moov.end, "mvhd");
  let movieTimescale = 1000;
  if (mvhd) {
    const ver = bytes[mvhd.payloadStart];
    movieTimescale =
      ver === 1
        ? view.getUint32(mvhd.payloadStart + 20, false)
        : view.getUint32(mvhd.payloadStart + 12, false);
    if (movieTimescale <= 0) movieTimescale = 1000;
  }

  const moovChildren = iterBoxes(view, bytes, moov.payloadStart, moov.end);
  for (const trak of moovChildren) {
    if (trak.type !== "trak") continue;

    const mdia = findBox(view, bytes, trak.payloadStart, trak.end, "mdia");
    if (!mdia) continue;

    const hdlr = findBox(view, bytes, mdia.payloadStart, mdia.end, "hdlr");
    if (!hdlr || hdlr.payloadStart + 12 > hdlr.end) continue;
    const handler = readFourCC(bytes, hdlr.payloadStart + 8);
    if (handler !== "vide") continue;

    const mdhd = findBox(view, bytes, mdia.payloadStart, mdia.end, "mdhd");
    if (!mdhd) continue;
    const mdhdVer = bytes[mdhd.payloadStart];
    const timescale =
      mdhdVer === 1
        ? view.getUint32(mdhd.payloadStart + 20, false)
        : view.getUint32(mdhd.payloadStart + 12, false);
    if (timescale <= 0) continue;

    const minf = findBox(view, bytes, mdia.payloadStart, mdia.end, "minf");
    if (!minf) continue;
    const stbl = findBox(view, bytes, minf.payloadStart, minf.end, "stbl");
    if (!stbl) continue;

    const stsd = findBox(view, bytes, stbl.payloadStart, stbl.end, "stsd");
    const stts = findBox(view, bytes, stbl.payloadStart, stbl.end, "stts");
    const stsz = findBox(view, bytes, stbl.payloadStart, stbl.end, "stsz");
    const stsc = findBox(view, bytes, stbl.payloadStart, stbl.end, "stsc");
    const stco = findBox(view, bytes, stbl.payloadStart, stbl.end, "stco");
    const co64 = findBox(view, bytes, stbl.payloadStart, stbl.end, "co64");
    const stss = findBox(view, bytes, stbl.payloadStart, stbl.end, "stss");
    const ctts = findBox(view, bytes, stbl.payloadStart, stbl.end, "ctts");

    if (!stsd || !stts || !stsz || !stsc || (!stco && !co64)) continue;

    const videoDesc = parseStsdVideo(view, bytes, stsd);
    if (!videoDesc || videoDesc.codedWidth <= 0 || videoDesc.codedHeight <= 0) continue;

    // 1. Sample sizes (stsz)
    const defaultSampleSize = view.getUint32(stsz.payloadStart + 4, false);
    const sampleCount = view.getUint32(stsz.payloadStart + 8, false);
    if (sampleCount === 0) continue;

    const sizes = new Uint32Array(sampleCount);
    if (defaultSampleSize > 0) {
      sizes.fill(defaultSampleSize);
    } else {
      for (let i = 0; i < sampleCount; i++) {
        sizes[i] = view.getUint32(stsz.payloadStart + 12 + i * 4, false);
      }
    }

    // 2. Chunk offsets (stco or co64)
    const chunkOffsets: number[] = [];
    if (stco) {
      const count = view.getUint32(stco.payloadStart + 4, false);
      for (let i = 0; i < count; i++) {
        chunkOffsets.push(view.getUint32(stco.payloadStart + 8 + i * 4, false));
      }
    } else if (co64) {
      const count = view.getUint32(co64.payloadStart + 4, false);
      for (let i = 0; i < count; i++) {
        chunkOffsets.push(readUint64(view, co64.payloadStart + 8 + i * 8));
      }
    }
    if (chunkOffsets.length === 0) continue;

    // 3. Sample-to-chunk mapping (stsc) -> byte offset per sample
    const stscCount = view.getUint32(stsc.payloadStart + 4, false);
    const stscEntries: { firstChunk: number; samplesPerChunk: number }[] = [];
    for (let i = 0; i < stscCount; i++) {
      stscEntries.push({
        firstChunk: view.getUint32(stsc.payloadStart + 8 + i * 12, false),
        samplesPerChunk: view.getUint32(stsc.payloadStart + 12 + i * 12, false),
      });
    }

    const offsets = new Float64Array(sampleCount);
    let sampleIdx = 0;
    for (let e = 0; e < stscEntries.length && sampleIdx < sampleCount; e++) {
      const startChunk = stscEntries[e].firstChunk - 1;
      const endChunk =
        e + 1 < stscEntries.length ? stscEntries[e + 1].firstChunk - 1 : chunkOffsets.length;
      const perChunk = stscEntries[e].samplesPerChunk;
      for (let chunk = startChunk; chunk < endChunk && sampleIdx < sampleCount; chunk++) {
        let curOff = chunkOffsets[chunk];
        if (curOff === undefined) break;
        for (let s = 0; s < perChunk && sampleIdx < sampleCount; s++) {
          offsets[sampleIdx] = curOff;
          curOff += sizes[sampleIdx];
          sampleIdx++;
        }
      }
    }
    if (sampleIdx !== sampleCount) continue;

    // 4. Decoding timestamps & durations (stts)
    const sttsCount = view.getUint32(stts.payloadStart + 4, false);
    const dtsTicks = new Float64Array(sampleCount);
    const durTicks = new Uint32Array(sampleCount);
    let curTick = 0;
    let tIdx = 0;
    for (let i = 0; i < sttsCount && tIdx < sampleCount; i++) {
      const count = view.getUint32(stts.payloadStart + 8 + i * 8, false);
      const delta = view.getUint32(stts.payloadStart + 12 + i * 8, false);
      for (let j = 0; j < count && tIdx < sampleCount; j++) {
        dtsTicks[tIdx] = curTick;
        durTicks[tIdx] = delta;
        curTick += delta;
        tIdx++;
      }
    }

    // 5. Optional composition time offsets (ctts) for B-frames
    const ctoTicks = new Int32Array(sampleCount);
    if (ctts) {
      const cttsVer = bytes[ctts.payloadStart];
      const cttsCount = view.getUint32(ctts.payloadStart + 4, false);
      let cIdx = 0;
      for (let i = 0; i < cttsCount && cIdx < sampleCount; i++) {
        const count = view.getUint32(ctts.payloadStart + 8 + i * 8, false);
        const offsetVal =
          cttsVer === 1
            ? view.getInt32(ctts.payloadStart + 12 + i * 8, false)
            : view.getUint32(ctts.payloadStart + 12 + i * 8, false);
        for (let j = 0; j < count && cIdx < sampleCount; j++) {
          ctoTicks[cIdx] = offsetVal;
          cIdx++;
        }
      }
    }

    // 6. Optional edit list (edts/elst) media-time offset so PTS aligns with HTMLVideoElement.currentTime
    let elstShiftUs = 0;
    const edts = findBox(view, bytes, trak.payloadStart, trak.end, "edts");
    if (edts) {
      const elst = findBox(view, bytes, edts.payloadStart, edts.end, "elst");
      if (elst) {
        const elstVer = bytes[elst.payloadStart];
        const entryCount = view.getUint32(elst.payloadStart + 4, false);
        let p = elst.payloadStart + 8;
        let delayUs = 0;
        for (let i = 0; i < entryCount; i++) {
          const segDur = elstVer === 1 ? readUint64(view, p) : view.getUint32(p, false);
          const mediaTime =
            elstVer === 1 ? readInt64(view, p + 8) : view.getInt32(p + 4, false);
          p += elstVer === 1 ? 20 : 12;
          if (mediaTime === -1) {
            delayUs += Math.round((segDur / movieTimescale) * 1_000_000);
          } else {
            elstShiftUs = delayUs - Math.round((mediaTime / timescale) * 1_000_000);
            break;
          }
        }
      }
    }

    // 7. Sync samples / keyframes (stss)
    const keySet = new Set<number>();
    let allKeys = false;
    if (stss) {
      const stssCount = view.getUint32(stss.payloadStart + 4, false);
      for (let i = 0; i < stssCount; i++) {
        keySet.add(view.getUint32(stss.payloadStart + 8 + i * 4, false) - 1);
      }
    } else {
      allKeys = true;
    }

    // Build sample list and verify byte bounds
    const samples: Mp4VideoSample[] = new Array(sampleCount);
    let minPtsUs = Number.POSITIVE_INFINITY;
    let maxEndUs = 0;

    for (let i = 0; i < sampleCount; i++) {
      const offset = offsets[i];
      const size = sizes[i];
      if (offset + size > buffer.byteLength) return null;

      const dtsUs = Math.round((dtsTicks[i] / timescale) * 1_000_000);
      const ptsUs = Math.round(((dtsTicks[i] + ctoTicks[i]) / timescale) * 1_000_000) + elstShiftUs;
      const durationUs = Math.max(1, Math.round((durTicks[i] / timescale) * 1_000_000));
      if (ptsUs < minPtsUs) minPtsUs = ptsUs;
      if (ptsUs + durationUs > maxEndUs) maxEndUs = ptsUs + durationUs;

      samples[i] = {
        offset,
        size,
        dtsUs,
        ptsUs,
        durationUs,
        isKey: allKeys || keySet.has(i) || i === 0,
      };
    }

    // Normalize negative/shifted start if no elst was present and first frame starts slightly > 0 due to ctts
    if (!edts && minPtsUs > 0 && minPtsUs < 500_000) {
      for (let i = 0; i < sampleCount; i++) {
        samples[i].ptsUs -= minPtsUs;
      }
      maxEndUs -= minPtsUs;
    }

    return {
      codec: videoDesc.codec,
      codedWidth: videoDesc.codedWidth,
      codedHeight: videoDesc.codedHeight,
      description: videoDesc.description,
      timescale,
      durationUs: Math.max(1, maxEndUs),
      samples,
    };
  }

  return null;
}
