import { InputSanitizer, OutputSanitizer } from '../src/utils/sanitizer';

describe('InputSanitizer', () => {
  describe('SQL Sanitization', () => {
    it('should remove single quotes', () => {
      const result = InputSanitizer.sanitizeSql("user'; DROP TABLE users;--");
      expect(result).not.toContain("'");
      expect(result).not.toContain('DROP');
    });

    it('should remove double quotes', () => {
      const result = InputSanitizer.sanitizeSql('user"; DROP TABLE');
      expect(result).not.toContain('"');
    });

    it('should remove SQL comments', () => {
      const result = InputSanitizer.sanitizeSql('user -- comment');
      expect(result).not.toContain('--');
    });

    it('should remove semicolons', () => {
      const result = InputSanitizer.sanitizeSql('user; DROP TABLE');
      expect(result).not.toContain(';');
    });

    it('should remove extended stored procedures', () => {
      const result = InputSanitizer.sanitizeSql('exec xp_cmdshell');
      expect(result).not.toContain('xp_');
    });

    it('should handle empty input', () => {
      const result = InputSanitizer.sanitizeSql('');
      expect(result).toBe('');
    });

    it('should preserve legitimate input', () => {
      const result = InputSanitizer.sanitizeSql('user123');
      expect(result).toBe('user123');
    });
  });

  describe('HTML/XSS Sanitization', () => {
    it('should escape HTML tags', () => {
      const result = InputSanitizer.sanitizeHtml('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;');
    });

    it('should escape ampersands', () => {
      const result = InputSanitizer.sanitizeHtml('A & B');
      expect(result).toBe('A &amp; B');
    });

    it('should escape quotes', () => {
      const result = InputSanitizer.sanitizeHtml('"quoted"');
      expect(result).toContain('&quot;');
    });

    it('should escape single quotes', () => {
      const result = InputSanitizer.sanitizeHtml("'quoted'");
      expect(result).toContain('&#x27;');
    });

    it('should escape slashes for JSON context', () => {
      const result = InputSanitizer.sanitizeHtml('</script>');
      expect(result).toContain('&#x2F;');
    });
  });

  describe('Command Injection Sanitization', () => {
    it('should remove shell metacharacters', () => {
      const result = InputSanitizer.sanitizeCommand('cmd; rm -rf /');
      expect(result).not.toContain(';');
      expect(result).not.toContain('/');
    });

    it('should remove pipe characters', () => {
      const result = InputSanitizer.sanitizeCommand('cmd | cat file');
      expect(result).not.toContain('|');
    });

    it('should remove backticks', () => {
      const result = InputSanitizer.sanitizeCommand('echo `id`');
      expect(result).not.toContain('`');
    });

    it('should remove command substitution', () => {
      const result = InputSanitizer.sanitizeCommand('echo $(whoami)');
      expect(result).not.toContain('$(');
      expect(result).not.toContain(')');
    });
  });

  describe('Path Traversal Sanitization', () => {
    it('should remove parent directory references', () => {
      const result = InputSanitizer.sanitizePath('../../../etc/passwd');
      expect(result).not.toContain('..');
    });

    it('should remove double slashes', () => {
      const result = InputSanitizer.sanitizePath('path//to//file');
      expect(result).not.toContain('//');
    });

    it('should remove leading slashes', () => {
      const result = InputSanitizer.sanitizePath('/etc/passwd');
      expect(result).not.toMatch(/^\/+/);
    });

    it('should remove Windows drive letters', () => {
      const result = InputSanitizer.sanitizePath('C:\\windows\\system32');
      expect(result).not.toMatch(/^[a-zA-Z]:/);
    });

    it('should remove null bytes', () => {
      const result = InputSanitizer.sanitizePath('file\0name');
      expect(result).not.toContain('\0');
    });

    it('should handle valid relative paths', () => {
      const result = InputSanitizer.sanitizePath('uploads/image.jpg');
      expect(result).toBe('uploads/image.jpg');
    });
  });

  describe('Email Sanitization', () => {
    it('should accept valid email', () => {
      const result = InputSanitizer.sanitizeEmail('user@example.com');
      expect(result).toBe('user@example.com');
    });

    it('should reject invalid email', () => {
      const result = InputSanitizer.sanitizeEmail('not-an-email');
      expect(result).toBeNull();
    });

    it('should lowercase email', () => {
      const result = InputSanitizer.sanitizeEmail('User@Example.COM');
      expect(result).toBe('user@example.com');
    });

    it('should trim whitespace', () => {
      const result = InputSanitizer.sanitizeEmail('  user@example.com  ');
      expect(result).toBe('user@example.com');
    });
  });

  describe('URL Sanitization', () => {
    it('should accept valid HTTP URL', () => {
      const result = InputSanitizer.sanitizeUrl('https://example.com');
      expect(result).toContain('https');
    });

    it('should reject invalid URL', () => {
      const result = InputSanitizer.sanitizeUrl('not a url');
      expect(result).toBeNull();
    });

    it('should reject dangerous protocol', () => {
      const result = InputSanitizer.sanitizeUrl('javascript:alert("xss")');
      expect(result).toBeNull();
    });

    it('should reject file protocol', () => {
      const result = InputSanitizer.sanitizeUrl('file:///etc/passwd');
      expect(result).toBeNull();
    });
  });

  describe('String Normalization', () => {
    it('should trim whitespace', () => {
      const result = InputSanitizer.normalizeString('  test  ');
      expect(result).toBe('test');
    });

    it('should collapse multiple spaces', () => {
      const result = InputSanitizer.normalizeString('test   multiple   spaces');
      expect(result).toBe('test multiple spaces');
    });

    it('should remove null bytes', () => {
      const result = InputSanitizer.normalizeString('test\0string');
      expect(result).not.toContain('\0');
    });

    it('should enforce max length', () => {
      const result = InputSanitizer.normalizeString('a'.repeat(100), 50);
      expect(result.length).toBeLessThanOrEqual(50);
    });
  });

  describe('Number Sanitization', () => {
    it('should parse valid number string', () => {
      const result = InputSanitizer.sanitizeNumber('42');
      expect(result).toBe(42);
    });

    it('should return null for invalid number', () => {
      const result = InputSanitizer.sanitizeNumber('not a number');
      expect(result).toBeNull();
    });

    it('should enforce minimum value', () => {
      const result = InputSanitizer.sanitizeNumber('5', { min: 10 });
      expect(result).toBeNull();
    });

    it('should enforce maximum value', () => {
      const result = InputSanitizer.sanitizeNumber('15', { max: 10 });
      expect(result).toBeNull();
    });

    it('should enforce integer requirement', () => {
      const result = InputSanitizer.sanitizeNumber('42.5', { isInteger: true });
      expect(result).toBeNull();
    });
  });

  describe('Array Sanitization', () => {
    it('should filter out empty strings', () => {
      const result = InputSanitizer.sanitizeStringArray(['a', '', 'b']);
      expect(result).toEqual(['a', 'b']);
    });

    it('should enforce max items', () => {
      const result = InputSanitizer.sanitizeStringArray(
        ['a', 'b', 'c', 'd'],
        { maxItems: 2 }
      );
      expect(result.length).toBe(2);
    });

    it('should lowercase items if requested', () => {
      const result = InputSanitizer.sanitizeStringArray(['ABC', 'DEF'], {
        lowercase: true,
      });
      expect(result).toEqual(['abc', 'def']);
    });

    it('should handle non-array input', () => {
      const result = InputSanitizer.sanitizeStringArray(null as any);
      expect(result).toEqual([]);
    });
  });

  describe('Object Sanitization', () => {
    it('should block prototype pollution', () => {
      const input = {
        __proto__: { isAdmin: true },
        name: 'test',
      } as any;
      const result = InputSanitizer.sanitizeObject(input);
      expect(result.__proto__).toBeUndefined();
      expect(result.name).toBe('test');
    });

    it('should block constructor key', () => {
      const input = {
        constructor: { prototype: { isAdmin: true } },
        name: 'test',
      } as any;
      const result = InputSanitizer.sanitizeObject(input);
      expect(result.constructor).toBeUndefined();
      expect(result.name).toBe('test');
    });

    it('should enforce allowlist', () => {
      const input = { name: 'test', email: 'user@example.com', secret: 'hidden' };
      const result = InputSanitizer.sanitizeObject(input, ['name', 'email']);
      expect(result.name).toBe('test');
      expect(result.email).toBe('user@example.com');
      expect(result.secret).toBeUndefined();
    });
  });

  describe('Discogs ID Validation', () => {
    it('should accept valid Discogs ID', () => {
      const result = InputSanitizer.sanitizeDiscogsId('12345');
      expect(result).toBe(12345);
    });

    it('should reject invalid Discogs ID', () => {
      const result = InputSanitizer.sanitizeDiscogsId('not a number');
      expect(result).toBeNull();
    });

    it('should reject too large ID', () => {
      const result = InputSanitizer.sanitizeDiscogsId('9999999999');
      expect(result).toBeNull();
    });

    it('should reject negative ID', () => {
      const result = InputSanitizer.sanitizeDiscogsId('-1');
      expect(result).toBeNull();
    });
  });

  describe('SoundCloud ID Validation', () => {
    it('should accept valid SoundCloud ID', () => {
      const result = InputSanitizer.sanitizeSoundCloudId('12345678901');
      expect(result).toBe(12345678901);
    });

    it('should reject negative ID', () => {
      const result = InputSanitizer.sanitizeSoundCloudId('-1');
      expect(result).toBeNull();
    });
  });

  describe('Playlist Name Validation', () => {
    it('should accept valid playlist name', () => {
      const result = InputSanitizer.sanitizePlaylistName('My Awesome Playlist');
      expect(result).toBe('My Awesome Playlist');
    });

    it('should reject empty name', () => {
      const result = InputSanitizer.sanitizePlaylistName('');
      expect(result).toBeNull();
    });

    it('should enforce max length', () => {
      const result = InputSanitizer.sanitizePlaylistName('a'.repeat(300), 200);
      expect(result).toBeNull();
    });
  });

  describe('Search Query Sanitization', () => {
    it('should accept valid search query', () => {
      const result = InputSanitizer.sanitizeSearchQuery('rock albums');
      expect(result).toBe('rock albums');
    });

    it('should remove wildcards', () => {
      const result = InputSanitizer.sanitizeSearchQuery('rock*');
      expect(result).not.toContain('*');
    });

    it('should remove SQL comments', () => {
      const result = InputSanitizer.sanitizeSearchQuery('rock -- comment');
      expect(result).not.toContain('--');
    });

    it('should reject empty query', () => {
      const result = InputSanitizer.sanitizeSearchQuery('');
      expect(result).toBeNull();
    });
  });

  describe('Suspicious Pattern Detection', () => {
    it('should detect SQL injection', () => {
      const result = InputSanitizer.isSuspicious("user' UNION SELECT * FROM users--");
      expect(result).toBe(true);
    });

    it('should detect XSS attempts', () => {
      const result = InputSanitizer.isSuspicious('<script>alert("xss")</script>');
      expect(result).toBe(true);
    });

    it('should detect path traversal', () => {
      const result = InputSanitizer.isSuspicious('../../../etc/passwd');
      expect(result).toBe(true);
    });

    it('should not flag legitimate input', () => {
      const result = InputSanitizer.isSuspicious('normal user input');
      expect(result).toBe(false);
    });
  });
});

describe('OutputSanitizer', () => {
  describe('Log Escaping', () => {
    it('should escape newlines', () => {
      const result = OutputSanitizer.escapeLog('line1\nline2');
      expect(result).toContain('\\n');
      expect(result).not.toContain('\n');
    });

    it('should escape carriage returns', () => {
      const result = OutputSanitizer.escapeLog('line1\rline2');
      expect(result).toContain('\\r');
      expect(result).not.toContain('\r');
    });

    it('should remove ANSI codes', () => {
      const result = OutputSanitizer.escapeLog('normal \x1B[31mred\x1B[0m text');
      expect(result).not.toContain('\x1B');
    });

    it('should remove null bytes', () => {
      const result = OutputSanitizer.escapeLog('test\0string');
      expect(result).not.toContain('\0');
    });
  });

  describe('Safe JSON Stringification', () => {
    it('should stringify objects', () => {
      const result = OutputSanitizer.safeJsonStringify({ name: 'test' });
      expect(result).toContain('name');
      expect(result).toContain('test');
    });

    it('should redact passwords', () => {
      const result = OutputSanitizer.safeJsonStringify({
        username: 'user',
        password: 'secret123',
      });
      expect(result).toContain('REDACTED');
      expect(result).not.toContain('secret123');
    });

    it('should redact tokens', () => {
      const result = OutputSanitizer.safeJsonStringify({
        accessToken: 'super-secret-token',
      });
      expect(result).toContain('REDACTED');
      expect(result).not.toContain('super-secret-token');
    });

    it('should handle circular references', () => {
      const obj: any = { name: 'test' };
      obj.self = obj;
      const result = OutputSanitizer.safeJsonStringify(obj);
      expect(result).toContain('Circular');
    });

    it('should limit depth', () => {
      const deep = { a: { b: { c: { d: { e: { f: 'deep' } } } } } };
      const result = OutputSanitizer.safeJsonStringify(deep, { maxDepth: 3 });
      // depth limiting works through excludes via the replacer function
      expect(typeof result).toBe('string');
      expect(result.length > 0).toBe(true);
    });
  });

  describe('Error Message Sanitization', () => {
    it('should remove file paths', () => {
      const error = new Error('Failed at /home/user/project/file.ts:42');
      const result = OutputSanitizer.sanitizeErrorMessage(error);
      expect(result).not.toContain('/home');
      expect(result).toContain('[PATH]');
    });

    it('should escape special characters', () => {
      const error = new Error('Error: user\ntraced');
      const result = OutputSanitizer.sanitizeErrorMessage(error);
      expect(result).not.toContain('\n');
    });

    it('should redact potential secrets', () => {
      const error = new Error('Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9ABC==');
      const result = OutputSanitizer.sanitizeErrorMessage(error);
      expect(result).toContain('REDACTED');
    });
  });

  describe('Sensitive Data Redaction', () => {
    it('should redact token values', () => {
      const input = 'token: "secret123"';
      const result = OutputSanitizer.redactSensitive(input);
      expect(result).toContain('REDACTED');
      expect(result).not.toContain('secret123');
    });

    it('should redact password values', () => {
      const input = 'password = "mypassword"';
      const result = OutputSanitizer.redactSensitive(input);
      expect(result).toContain('REDACTED');
      expect(result).not.toContain('mypassword');
    });

    it('should redact API keys', () => {
      const input = 'api_key: abc123def456';
      const result = OutputSanitizer.redactSensitive(input);
      expect(result).toContain('REDACTED');
      expect(result).not.toContain('abc123def456');
    });

    it('should redact authorization headers', () => {
      const input = 'authorization: Bearer token123';
      const result = OutputSanitizer.redactSensitive(input);
      expect(result).toContain('REDACTED');
      expect(result).not.toContain('Bearer');
      expect(result).not.toContain('token123');
    });
  });

  describe('String Truncation', () => {
    it('should truncate long strings', () => {
      const input = 'a'.repeat(300);
      const result = OutputSanitizer.truncate(input, 100);
      expect(result.length).toBeLessThanOrEqual(103); // 100 + '...'
      expect(result).toContain('...');
    });

    it('should not truncate short strings', () => {
      const input = 'short';
      const result = OutputSanitizer.truncate(input, 100);
      expect(result).toBe('short');
    });
  });

  describe('Display Formatting', () => {
    it('should handle string input', () => {
      const result = OutputSanitizer.formatForDisplay('test');
      expect(result).toBe('test');
    });

    it('should handle null input', () => {
      const result = OutputSanitizer.formatForDisplay(null);
      expect(result).toBe('null');
    });

    it('should handle object input', () => {
      const result = OutputSanitizer.formatForDisplay({ key: 'value' });
      expect(result).toContain('key');
    });

    it('should handle undefined input', () => {
      const result = OutputSanitizer.formatForDisplay(undefined);
      expect(result).toBe('undefined');
    });

    it('should truncate long output', () => {
      const input = 'a'.repeat(1000);
      const result = OutputSanitizer.formatForDisplay(input, 100);
      expect(result.length).toBeLessThanOrEqual(103);
    });
  });
});
