export function textToHex(s: string): string {
  return Buffer.from(s, "utf8").toString("hex");
}

export function hexToUtf8(hex: string): string {
  try {
    return decodeURIComponent(
      hex.replace(/\s+/g, "").replace(/../g, "%$&")
    );
  } catch {
    return hex;
  }
}
