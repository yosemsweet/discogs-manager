import { EncryptionService } from '../src/utils/encryption';

describe('EncryptionService', () => {
  let encryptionService: EncryptionService;
  const testEncryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64 hex chars = 32 bytes

  beforeAll(() => {
    encryptionService = new EncryptionService(testEncryptionKey);
  });

  describe('encrypt and decrypt', () => {
    it('should encrypt a plaintext string', () => {
      const plaintext = 'test-token-12345';
      const encrypted = encryptionService.encrypt(plaintext);

      expect(encrypted).toHaveProperty('encrypted');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('authTag');
      expect(typeof encrypted.encrypted).toBe('string');
      expect(typeof encrypted.iv).toBe('string');
      expect(typeof encrypted.authTag).toBe('string');
    });

    it('should decrypt encrypted data back to plaintext', () => {
      const plaintext = 'my-secret-token';
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertexts for same plaintext (due to random IV)', () => {
      const plaintext = 'same-token-twice';
      const encrypted1 = encryptionService.encrypt(plaintext);
      const encrypted2 = encryptionService.encrypt(plaintext);

      // Different IVs should produce different ciphertexts
      expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);

      // But both should decrypt to same plaintext
      expect(encryptionService.decrypt(encrypted1)).toBe(plaintext);
      expect(encryptionService.decrypt(encrypted2)).toBe(plaintext);
    });

    it('should handle long strings', () => {
      const plaintext = 'a'.repeat(10000); // 10KB string
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle strings with special characters', () => {
      const plaintext = '!@#$%^&*()_+-=[]{}|;:,.<>?~`';
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode characters', () => {
      const plaintext = '你好世界 🚀 مرحبا العالم';
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty string', () => {
      const plaintext = '';
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('JSON serialization', () => {
    it('should encrypt to JSON and decrypt from JSON', () => {
      const plaintext = 'token-for-json-test';
      const json = encryptionService.encryptToJson(plaintext);
      const decrypted = encryptionService.decryptFromJson(json);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce valid JSON', () => {
      const plaintext = 'test-token';
      const json = encryptionService.encryptToJson(plaintext);

      // Should not throw
      const parsed = JSON.parse(json);
      expect(parsed).toHaveProperty('encrypted');
      expect(parsed).toHaveProperty('iv');
      expect(parsed).toHaveProperty('authTag');
    });

    it('should handle storing and retrieving from database simulation', () => {
      const plaintext = 'refresh_token_abc123xyz';

      // Simulate database storage
      const json = encryptionService.encryptToJson(plaintext);
      const stored = JSON.stringify({ token_data: json });

      // Simulate retrieval
      const retrieved = JSON.parse(stored);
      const decrypted = encryptionService.decryptFromJson(retrieved.token_data);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('error handling', () => {
    it('should throw on decryption with wrong key', () => {
      const plaintext = 'test-token';
      const encrypted = encryptionService.encrypt(plaintext);

      // Create new instance with different key
      const wrongKey = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      const wrongEncryption = new EncryptionService(wrongKey);

      expect(() => wrongEncryption.decrypt(encrypted)).toThrow();
    });

    it('should throw on decryption with tampered ciphertext', () => {
      const plaintext = 'test-token';
      const encrypted = encryptionService.encrypt(plaintext);

      // Tamper with ciphertext
      const tampered = {
        ...encrypted,
        encrypted: encrypted.encrypted.slice(0, -2) + 'XX',
      };

      expect(() => encryptionService.decrypt(tampered)).toThrow();
    });

    it('should throw on decryption with wrong IV', () => {
      const plaintext = 'test-token';
      const encrypted = encryptionService.encrypt(plaintext);

      // Use wrong IV
      const wrongIv = {
        ...encrypted,
        iv: '00000000000000000000000000000000',
      };

      expect(() => encryptionService.decrypt(wrongIv)).toThrow();
    });

    it('should throw on decryption with wrong auth tag', () => {
      const plaintext = 'test-token';
      const encrypted = encryptionService.encrypt(plaintext);

      // Use wrong auth tag
      const wrongTag = {
        ...encrypted,
        authTag: '00000000000000000000000000000000',
      };

      expect(() => encryptionService.decrypt(wrongTag)).toThrow();
    });

    it('should throw when initialized with missing key', () => {
      expect(() => new EncryptionService(undefined)).toThrow('ENCRYPTION_KEY environment variable is required');
    });

    it('should throw when initialized with invalid key length', () => {
      expect(() => new EncryptionService('tooshort')).toThrow('must be 64 hex characters');
    });

    it('should throw when initialized with non-hex characters', () => {
      const invalidKey = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
      expect(() => new EncryptionService(invalidKey)).toThrow();
    });
  });

  describe('generateKey', () => {
    it('should generate a valid encryption key', () => {
      const key = EncryptionService.generateKey();

      // Should be 64 hex characters (32 bytes)
      expect(key).toMatch(/^[0-9a-f]{64}$/i);

      // Should be usable to create a new EncryptionService
      expect(() => new EncryptionService(key)).not.toThrow();
    });

    it('should generate different keys each time', () => {
      const key1 = EncryptionService.generateKey();
      const key2 = EncryptionService.generateKey();

      expect(key1).not.toBe(key2);
    });

    it('generated keys should encrypt and decrypt correctly', () => {
      const key = EncryptionService.generateKey();
      const service = new EncryptionService(key);
      const plaintext = 'test-with-generated-key';

      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('real world scenarios', () => {
    it('should encrypt OAuth access token', () => {
      const accessToken = 'ya29.a0AfH6SMDg_Eo0QyVvLvJh5kL9D_tZ0xC1Q2bE-jVzVgVH2Q9aZ_wz4F3uKrQ';
      const encrypted = encryptionService.encrypt(accessToken);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(accessToken);
    });

    it('should encrypt OAuth refresh token', () => {
      const refreshToken =
        '1//0gZqqL0iJq7_dCgYIARAAGAwSNwF-L9IrJqL-h0s1Q2bE-jVzVgVH2Q9aZ_wz4F3uKrQ5J_0QnP0TDL4W2';
      const encrypted = encryptionService.encrypt(refreshToken);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(refreshToken);
    });

    it('should encrypt SoundCloud API credentials', () => {
      const clientId = '1234567890abcdef1234567890abcdef';
      const encrypted = encryptionService.encrypt(clientId);
      const decrypted = encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(clientId);
    });

    it('should handle multiple concurrent encryptions', () => {
      const tokens = [
        'token-1-abc',
        'token-2-def',
        'token-3-ghi',
        'token-4-jkl',
        'token-5-mno',
      ];

      const encrypted = tokens.map((token) => encryptionService.encrypt(token));
      const decrypted = encrypted.map((e) => encryptionService.decrypt(e));

      expect(decrypted).toEqual(tokens);
    });
  });
});
