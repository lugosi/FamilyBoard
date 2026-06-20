import crypto from "crypto";

const SIGN_KEY =
  "00109190907746a7ad0e2139b6d09ce47551770157fe4ac5922f3a5454c82712";

const RSA_PUBLIC_KEY_B64 =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCCA9I+iEl2AI8dnhdwwxPxHVK8iNAt6aTq6UhNsLsguWS5qtbLnuGz2RQdfNS" +
  "aKSU2B6D/vE2gb1fM6f1A5cKndqF/riWGWn1EfL3FFQZduOTxoA0RTQzhrTa5LHcJ/an/NuHUwShwIOij0Mf4g8faTe4FT7/HdA" +
  "oK7uW0cG9mZwIDAQAB";

export function signCatlinkParameters(
  parameters: Record<string, string | number | boolean>,
): string {
  const sorted = Object.entries(parameters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  sorted.push(`key=${SIGN_KEY}`);
  return crypto.createHash("md5").update(sorted.join("&")).digest("hex").toUpperCase();
}

export function encryptCatlinkPassword(password: string): string {
  if (password.length > 16) return password;
  const md5 = crypto.createHash("md5").update(password).digest("hex").toLowerCase();
  const sha1 = crypto.createHash("sha1").update(md5).digest("hex").toUpperCase();
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(RSA_PUBLIC_KEY_B64, "base64"),
    format: "der",
    type: "spki",
  });
  const encrypted = crypto.publicEncrypt(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(sha1),
  );
  return encrypted.toString("base64");
}
