// Dhan feed uses little-endian binary packets. Keep offsets aligned with the current official docs.
const SEGMENT_BY_CODE = {
  0: "IDX_I",
  1: "NSE_EQ",
  2: "NSE_FNO",
  3: "NSE_CURRENCY",
  4: "BSE_EQ",
  5: "MCX_COMM",
  7: "BSE_CURRENCY",
  8: "BSE_FNO",
};

function asBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(data);
}

export function decodeDhanPacket(raw) {
  const buffer = asBuffer(raw);
  if (buffer.length < 8) return null;

  const code = buffer.readUInt8(0);
  const messageLength = buffer.readUInt16LE(1);
  const segmentCode = buffer.readUInt8(3);
  const securityId = String(buffer.readUInt32LE(4));
  const exchangeSegment = SEGMENT_BY_CODE[segmentCode];

  if (!exchangeSegment) return { type: "unknown", code, securityId, segmentCode, messageLength };
  if (code === 50) {
    return {
      type: "disconnect",
      code,
      disconnectCode: buffer.length >= 10 ? buffer.readUInt16LE(8) : null,
    };
  }

  // Index packets use the same leading LTP/LTT payload shape in the feed.
  if (code === 1 && buffer.length >= 16) {
    return {
      type: "tick", packetType: "index", code, exchangeSegment, securityId,
      ltp: buffer.readFloatLE(8),
      ltt: buffer.readInt32LE(12),
    };
  }

  // The common ticker payload begins at byte 8.
  if (code === 2 && buffer.length >= 16) {
    return {
      type: "tick", packetType: "ticker", code, exchangeSegment, securityId,
      ltp: buffer.readFloatLE(8),
      ltt: buffer.readInt32LE(12),
    };
  }

  if (code === 4 && buffer.length >= 51) {
    return {
      type: "tick", packetType: "quote", code, exchangeSegment, securityId,
      ltp: buffer.readFloatLE(8),
      lastQuantity: buffer.readInt16LE(12),
      ltt: buffer.readInt32LE(14),
      averagePrice: buffer.readFloatLE(18),
      volume: buffer.readInt32LE(22),
      sellQuantity: buffer.readInt32LE(26),
      buyQuantity: buffer.readInt32LE(30),
      dayOpen: buffer.readFloatLE(34),
      dayClose: buffer.readFloatLE(38),
      dayHigh: buffer.readFloatLE(42),
      dayLow: buffer.readFloatLE(46),
    };
  }

  if (code === 5 && buffer.length >= 12) {
    return { type: "oi", code, exchangeSegment, securityId, oi: buffer.readInt32LE(8) };
  }

  if (code === 6 && buffer.length >= 16) {
    return {
      type: "prevClose", code, exchangeSegment, securityId,
      previousClose: buffer.readFloatLE(8),
      previousOi: buffer.readInt32LE(12),
    };
  }

  // Full packet fields follow the same leading quote layout, with OI fields added.
  if (code === 8 && buffer.length >= 63) {
    return {
      type: "tick", packetType: "full", code, exchangeSegment, securityId,
      ltp: buffer.readFloatLE(8),
      lastQuantity: buffer.readInt16LE(12),
      ltt: buffer.readInt32LE(14),
      averagePrice: buffer.readFloatLE(18),
      volume: buffer.readInt32LE(22),
      sellQuantity: buffer.readInt32LE(26),
      buyQuantity: buffer.readInt32LE(30),
      oi: buffer.readInt32LE(34),
      oiDayHigh: buffer.readInt32LE(38),
      oiDayLow: buffer.readInt32LE(42),
      dayOpen: buffer.readFloatLE(46),
      dayClose: buffer.readFloatLE(50),
      dayHigh: buffer.readFloatLE(54),
      dayLow: buffer.readFloatLE(58),
    };
  }

  return { type: "other", code, exchangeSegment, securityId, messageLength };
}
