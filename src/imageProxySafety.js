import net from 'node:net';

function ipv4Parts(address) {
  if (!net.isIPv4(address)) return null;
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function isPrivateIpv4Parts(parts) {
  if (!parts) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function parseIpv4SuffixToHextets(part) {
  const pieces = ipv4Parts(part);
  if (!pieces) return null;
  return [
    ((pieces[0] << 8) | pieces[1]).toString(16),
    ((pieces[2] << 8) | pieces[3]).toString(16)
  ];
}

function parseIpv6Bytes(address) {
  if (!net.isIPv6(address)) return null;
  const withoutZone = String(address || '').split('%')[0].toLowerCase();
  const segments = withoutZone.split('::');
  if (segments.length > 2) return null;

  const parseSide = (side) => {
    if (!side) return [];
    const parts = side.split(':');
    const last = parts[parts.length - 1];
    if (last?.includes('.')) {
      const ipv4Hextets = parseIpv4SuffixToHextets(last);
      if (!ipv4Hextets) return null;
      parts.splice(parts.length - 1, 1, ...ipv4Hextets);
    }
    return parts.map((part) => {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      return Number.parseInt(part, 16);
    });
  };

  const left = parseSide(segments[0]);
  const right = parseSide(segments[1] || '');
  if (!left || !right || left.some((part) => part === null) || right.some((part) => part === null)) return null;
  const missing = 8 - left.length - right.length;
  if (segments.length === 1 && missing !== 0) return null;
  if (segments.length === 2 && missing < 1) return null;
  const hextets = segments.length === 2
    ? [...left, ...Array(missing).fill(0), ...right]
    : left;
  if (hextets.length !== 8) return null;
  const bytes = [];
  hextets.forEach((value) => {
    bytes.push((value >> 8) & 0xff, value & 0xff);
  });
  return bytes;
}

function bytesToIpv4Parts(bytes) {
  return bytes.length === 4 ? bytes.map((byte) => byte & 0xff) : null;
}

function isAllZero(bytes, start = 0, end = bytes.length) {
  return bytes.slice(start, end).every((byte) => byte === 0);
}

function embeddedIpv4FromIpv6(bytes) {
  if (!bytes || bytes.length !== 16) return null;
  if (isAllZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return bytesToIpv4Parts(bytes.slice(12, 16));
  }
  if (isAllZero(bytes, 0, 12)) {
    return bytesToIpv4Parts(bytes.slice(12, 16));
  }
  if (bytes[0] === 0 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && isAllZero(bytes, 4, 12)) {
    return bytesToIpv4Parts(bytes.slice(12, 16));
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return bytesToIpv4Parts(bytes.slice(2, 6));
  }
  return null;
}

export function isPrivateProxyIp(address) {
  if (!address) return true;
  const ipv4 = ipv4Parts(address);
  if (ipv4) return isPrivateIpv4Parts(ipv4);
  const bytes = parseIpv6Bytes(address);
  if (!bytes) return true;

  const embeddedIpv4 = embeddedIpv4FromIpv6(bytes);
  if (embeddedIpv4) return isPrivateIpv4Parts(embeddedIpv4);

  const isUnspecified = isAllZero(bytes);
  const isLoopback = isAllZero(bytes, 0, 15) && bytes[15] === 1;
  const isUniqueLocal = (bytes[0] & 0xfe) === 0xfc;
  const isLinkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
  const isMulticast = bytes[0] === 0xff;
  const isDocumentation = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;
  const isDiscardOnly = bytes[0] === 0x01 && isAllZero(bytes, 1, 8);
  const isTeredo = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0 && bytes[3] === 0;
  const isOrchid = bytes[0] === 0x20 && bytes[1] === 0x01 && (bytes[2] & 0xf0) === 0x10;
  const isSixToFour = bytes[0] === 0x20 && bytes[1] === 0x02;

  return isUnspecified
    || isLoopback
    || isUniqueLocal
    || isLinkLocal
    || isMulticast
    || isDocumentation
    || isDiscardOnly
    || isTeredo
    || isOrchid
    || isSixToFour;
}
