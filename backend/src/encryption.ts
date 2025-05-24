import crypto from 'crypto';

// Secret key used for encryption/decryption operations
// This must match the Java implementation's secretKey
const SECRET_KEY = 'channelplay_help';
const IV_SIZE = 16; // AES block size
const ALGORITHM = 'AES';
const TRANSFORMATION = 'AES/CBC/PKCS5Padding'; // Node.js uses PKCS7 which is identical for AES

/**
 * Prepares a 16-byte AES key from the secret string (padded or trimmed).
 * This matches the Java implementation's getSecretKey method.
 */
function getSecretKey(key: string): Buffer {
  // Create exactly 16 bytes (128 bits) as in Java implementation
  const keyBytes = Buffer.alloc(16);
  Buffer.from(key, 'utf8').copy(keyBytes);
  return keyBytes;
}

/**
 * Decrypts an encrypted email ID using AES-128-CBC algorithm - compatible with Java's javax.crypto
 * 
 * @param encryptedBase64 - The encrypted email in base64 format
 * @returns The decrypted email ID as a string
 */
export function decryptEmailId(encryptedBase64: string): string {
  try {
    // Decode the Base64 string to get IV + ciphertext
    const combined = Buffer.from(encryptedBase64, 'base64');
    
    // Extract IV and ciphertext (first 16 bytes are IV)
    const iv = combined.slice(0, IV_SIZE);
    const encryptedBytes = combined.slice(IV_SIZE);
    
    // Prepare key using the same method as Java
    const secretKeySpec = getSecretKey(SECRET_KEY);
    
    // Create decipher - equivalent to Java's Cipher.getInstance("AES/CBC/PKCS5Padding")
    const decipher = crypto.createDecipheriv('aes-128-cbc', secretKeySpec, iv);
    
    // Decrypt - equivalent to Java's cipher.doFinal(encryptedBytes)
    let decrypted = decipher.update(encryptedBytes);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    // Convert to UTF-8 string - equivalent to Java's new String(decrypted, StandardCharsets.UTF_8)
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('Error decrypting email ID:', error);
    throw new Error('Invalid encrypted email format');
  }
}

/**
 * Encrypts an email ID using AES-128-CBC algorithm - compatible with Java's javax.crypto
 * This matches exactly the Java implementation:
 * com.channelplay.office.util.EncryptionUtil.encrypt()
 * 
 * @param emailId - The email ID to encrypt
 * @returns The encrypted email in base64 format
 */
export function encryptEmailId(emailId: string): string {
  try {
    // Convert plaintext to bytes - equivalent to Java's getBytes(StandardCharsets.UTF_8)
    const clean = Buffer.from(emailId, 'utf8');
    
    // Generate a random IV - equivalent to Java's SecureRandom().nextBytes(iv)
    const iv = crypto.randomBytes(IV_SIZE);
    
    // Prepare key using the same method as Java's getSecretKey
    const secretKeySpec = getSecretKey(SECRET_KEY);
    
    // Create cipher - equivalent to Java's Cipher.getInstance("AES/CBC/PKCS5Padding")
    const cipher = crypto.createCipheriv('aes-128-cbc', secretKeySpec, iv);
    
    // Encrypt - equivalent to Java's cipher.doFinal(clean)
    let encrypted = cipher.update(clean);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Concatenate IV and encrypted data, then convert to base64
    // This matches exactly Java's concatenation of IV + encrypted
    const combined = Buffer.concat([iv, encrypted]);
    return combined.toString('base64');
  } catch (error) {
    console.error('Error encrypting email ID:', error);
    throw new Error('Failed to encrypt email ID');
  }
}

/**
 * Test function that validates encryption/decryption roundtrip
 */
export function testCrypto(email: string = 'test@example.com'): boolean {
  const encrypted = encryptEmailId(email);
  const decrypted = decryptEmailId(encrypted);
  return email === decrypted;
}