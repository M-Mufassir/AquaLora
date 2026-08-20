import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

// AES-256-GCM: confidentiality (nobody on the WiFi can read readings) plus
// authenticity (a forged/tampered message fails the tag check and is
// dropped, rather than being silently trusted). The key is derived from the
// same WiFi password the user types into the Connect Device wizard to join
// the Master Node's AP — that password is already the shared secret
// establishing the pairing, so there's nothing extra to provision or keep
// in sync; the Arduino firmware derives the identical key the same way
// (SHA-256 of its AP_PASSWORD constant) via mbedtls. See
// firmware_design/master_node/README.md for the firmware side.
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

interface EncryptedEnvelope {
  iv: string
  tag: string
  data: string
}

export function deriveKeyFromPassword(password: string): Buffer {
  return createHash('sha256').update(password, 'utf8').digest()
}

export function encryptMessage(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const envelope: EncryptedEnvelope = {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  }
  return JSON.stringify(envelope)
}

// Returns null (rather than throwing) on any failure — bad JSON, wrong key,
// or a failed auth tag all mean "don't trust this message," and the caller
// should just drop it and move on rather than crash the connection.
export function decryptMessage(key: Buffer, raw: string): string | null {
  try {
    const envelope = JSON.parse(raw) as Partial<EncryptedEnvelope>
    if (!envelope.iv || !envelope.tag || !envelope.data) return null
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final()
    ])
    return decrypted.toString('utf8')
  } catch (err) {
    console.error('[secureChannel] dropped message: failed to decrypt/verify:', err)
    return null
  }
}
