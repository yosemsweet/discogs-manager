import crypto from 'crypto';

/**
 * Result of encryption operation containing all necessary data for decryption
 */
export interface EncryptedData {
  encrypted: string;
  iv: string;
  authTag: string;
}

/**
 * Service for encrypting and decrypting sensitive data (tokens, credentials)
 * Uses AES-256-GCM with authenticated encryption
 */
export class EncryptionService {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 16; // 128 bits
  private static readonly KEY_LENGTH = 32; // 256 bits
  private static readonly AUTH_TAG_LENGTH = 16; // 128 bits
  private static readonly ENCODING = 'hex';

  private key: Buffer;

  /**
   * Initialize EncryptionService with encryption key
   * @param encryptionKey - 32-byte hex-encoded encryption key (from env or generated)
   * @throws Error if key is invalid or missing
   */
  constructor(encryptionKey?: string) {
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY environment variable is required for token encryption');
    }

    // Validate key is proper length
    const keyBuffer = Buffer.from(encryptionKey, 'hex');
    if (keyBuffer.length !== EncryptionService.KEY_LENGTH) {
      throw new Error(
        `ENCRYPTION_KEY must be 64 hex characters (32 bytes). Got ${encryptionKey.length} characters (${keyBuffer.length} bytes)`,
      );
    }

    this.key = keyBuffer;
  }

  /**
   * Generate a new encryption key (call this once on first setup)
   * @returns 64-character hex string representing 32-byte key
   */
  static generateKey(): string {
    return crypto.randomBytes(EncryptionService.KEY_LENGTH).toString('hex');
  }

  /**
   * Encrypt plaintext using AES-256-GCM
   * @param plaintext - Text to encrypt (e.g., OAuth token)
   * @returns EncryptedData with encrypted text, IV, and auth tag
   */
  encrypt(plaintext: string): EncryptedData {
    // Generate random IV for this encryption
    const iv = crypto.randomBytes(EncryptionService.IV_LENGTH);

    // Create cipher
    const cipher = crypto.createCipheriv(EncryptionService.ALGORITHM, this.key, iv);

    // Encrypt the plaintext
    let encrypted = cipher.update(plaintext, 'utf8', EncryptionService.ENCODING);
    encrypted += cipher.final(EncryptionService.ENCODING);

    // Get auth tag for authenticated encryption
    const authTag = cipher.getAuthTag().toString(EncryptionService.ENCODING);

    return {
      encrypted,
      iv: iv.toString(EncryptionService.ENCODING),
      authTag,
    };
  }

  /**
   * Decrypt ciphertext using AES-256-GCM
   * @param encrypted - EncryptedData with ciphertext, IV, and auth tag
   * @returns Decrypted plaintext
   * @throws Error if decryption fails (tampered data or wrong key)
   */
  decrypt(encrypted: EncryptedData): string {
    try {
      // Convert hex strings back to buffers
      const iv = Buffer.from(encrypted.iv, EncryptionService.ENCODING);
      const authTag = Buffer.from(encrypted.authTag, EncryptionService.ENCODING);
      const ciphertext = encrypted.encrypted;

      // Create decipher
      const decipher = crypto.createDecipheriv(EncryptionService.ALGORITHM, this.key, iv);

      // Set auth tag for verification
      decipher.setAuthTag(authTag);

      // Decrypt
      let decrypted = decipher.update(ciphertext, EncryptionService.ENCODING, 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Decryption failed: ${error.message}. Data may be corrupted or key may have changed.`);
      }
      throw error;
    }
  }

  /**
   * Encrypt and return as JSON string (for database storage)
   * @param plaintext - Text to encrypt
   * @returns JSON string of EncryptedData
   */
  encryptToJson(plaintext: string): string {
    const encrypted = this.encrypt(plaintext);
    return JSON.stringify(encrypted);
  }

  /**
   * Decrypt from JSON string (from database)
   * @param jsonString - JSON string of EncryptedData
   * @returns Decrypted plaintext
   */
  decryptFromJson(jsonString: string): string {
    const encrypted: EncryptedData = JSON.parse(jsonString);
    return this.decrypt(encrypted);
  }
}

/**
 * Create singleton EncryptionService instance
 * Initialized with ENCRYPTION_KEY from environment
 */
export const createEncryptionService = (): EncryptionService => {
  const encryptionKey = process.env.ENCRYPTION_KEY;

  if (!encryptionKey) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required. Generate one with: ENCRYPTION_KEY=$(openssl rand -hex 32)',
    );
  }

  return new EncryptionService(encryptionKey);
};
