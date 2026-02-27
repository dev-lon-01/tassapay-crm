/**
 * src/utils/tayoCrypto.js
 *
 * AES-256-CBC encrypt/decrypt matching the C# RijndaelManaged implementation:
 *   Mode    : CipherMode.CBC
 *   Padding : PaddingMode.Zeros  (manual zero-padding; setAutoPadding(false))
 *   Key     : 32-byte ASCII string
 *   IV      : 16-byte ASCII string
 */

const crypto = require("crypto");

const KEY = Buffer.from("XMlkfg2845acGTbvdr270FGHBfghjkdc", "ascii"); // 32 bytes → AES-256
const IV = Buffer.from("HQreTFgdtm1485rt", "ascii"); // 16 bytes

/**
 * Encrypt a plain-text string.
 * Pads the input with null bytes to the next 16-byte boundary before encrypting.
 * @param {string} plainText
 * @returns {string} Base64-encoded cipher text
 */
function encrypt(plainText) {
  const buf = Buffer.from(plainText, "utf8");
  const paddedLen = Math.ceil(buf.length / 16) * 16;
  const padded = Buffer.alloc(paddedLen, 0); // zero-filled
  buf.copy(padded);

  const cipher = crypto.createCipheriv("aes-256-cbc", KEY, IV);
  cipher.setAutoPadding(false); // we handle padding manually
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

/**
 * Decrypt a Base64-encoded cipher text.
 * Strips trailing null bytes from the decrypted result before returning.
 * @param {string} cipherText  Base64 string
 * @returns {string} Decrypted plain text (trailing null bytes removed)
 */
function decrypt(cipherText) {
  const cipherBytes = Buffer.from(cipherText, "base64");
  const decipher = crypto.createDecipheriv("aes-256-cbc", KEY, IV);
  decipher.setAutoPadding(false); // padding was Zeros, not PKCS7
  const dec = Buffer.concat([decipher.update(cipherBytes), decipher.final()]);
  return dec.toString("utf8").replace(/\0+$/, "");
}

module.exports = { encrypt, decrypt };
