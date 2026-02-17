import { SoundCloudRateLimitService } from '../src/services/soundcloud-rate-limit';

describe('SoundCloudRateLimitService', () => {
  let rateLimitService: SoundCloudRateLimitService;

  beforeEach(() => {
    rateLimitService = new SoundCloudRateLimitService();
  });

  describe('initialization', () => {
    test('should start with no state', () => {
      expect(rateLimitService.getState()).toBeNull();
    });

    test('should not be at limit initially', () => {
      expect(rateLimitService.isLimitExceeded()).toBe(false);
      expect(rateLimitService.isApproachingLimit()).toBe(false);
    });
  });

  describe('updateFromResponse', () => {
    test('should parse valid reset time and update state', () => {
      const futureTime = new Date(Date.now() + 3600000); // 1 hour from now
      const resetTimeString = futureTime.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).replace(/(\d+)\/(\d+)\/(\d+),\s(\d+:\d+:\d+)/, '$3/$1/$2 $4 +0000');

      rateLimitService.updateFromResponse(100, resetTimeString);

      const state = rateLimitService.getState();
      expect(state).not.toBeNull();
      expect(state?.remaining).toBe(100);
      expect(state?.maxRequests).toBe(15000);
    });

    test('should handle ISO 8601 date format', () => {
      const futureTime = new Date(Date.now() + 7200000);
      rateLimitService.updateFromResponse(5000, futureTime.toISOString());

      const state = rateLimitService.getState();
      expect(state?.remaining).toBe(5000);
    });
  });

  describe('isApproachingLimit', () => {
    test('should return true when remaining <= 5', () => {
      const futureTime = new Date(Date.now() + 3600000);
      rateLimitService.updateFromResponse(5, futureTime.toISOString());
      expect(rateLimitService.isApproachingLimit()).toBe(true);
    });

    test('should return true when remaining is 0', () => {
      const futureTime = new Date(Date.now() + 3600000);
      rateLimitService.updateFromResponse(0, futureTime.toISOString());
      expect(rateLimitService.isApproachingLimit()).toBe(true);
    });

    test('should return false when remaining > 5', () => {
      const futureTime = new Date(Date.now() + 3600000);
      rateLimitService.updateFromResponse(100, futureTime.toISOString());
      expect(rateLimitService.isApproachingLimit()).toBe(false);
    });
  });

  describe('isLimitExceeded', () => {
    test('should return true when remaining is 0', () => {
      const futureTime = new Date(Date.now() + 3600000);
      rateLimitService.updateFromResponse(0, futureTime.toISOString());
      expect(rateLimitService.isLimitExceeded()).toBe(true);
    });

    test('should return false when remaining > 0', () => {
      const futureTime = new Date(Date.now() + 3600000);
      rateLimitService.updateFromResponse(1, futureTime.toISOString());
      expect(rateLimitService.isLimitExceeded()).toBe(false);
    });
  });

  describe('getTimeUntilReset', () => {
    test('should return 0 when no state', () => {
      expect(rateLimitService.getTimeUntilReset()).toBe(0);
    });

    test('should return positive value when reset is in future', () => {
      const futureTime = new Date(Date.now() + 3600000); // 1 hour
      rateLimitService.updateFromResponse(100, futureTime.toISOString());
      const timeUntilReset = rateLimitService.getTimeUntilReset();
      expect(timeUntilReset).toBeGreaterThan(0);
      expect(timeUntilReset).toBeLessThanOrEqual(3600000);
    });

    test('should return 0 when reset time is in past', () => {
      const pastTime = new Date(Date.now() - 3600000); // 1 hour ago
      rateLimitService.updateFromResponse(100, pastTime.toISOString());
      const timeUntilReset = rateLimitService.getTimeUntilReset();
      expect(timeUntilReset).toBe(0);
    });
  });

  describe('isStateStale', () => {
    test('should return true for fresh service', () => {
      expect(rateLimitService.isStateStale()).toBe(true);
    });

    test('should return false after recent update', () => {
      const futureTime = new Date(Date.now() + 3600000);
      rateLimitService.updateFromResponse(100, futureTime.toISOString());
      expect(rateLimitService.isStateStale()).toBe(false);
    });
  });

  describe('reset', () => {
    test('should clear state', () => {
      const futureTime = new Date(Date.now() + 3600000);
      rateLimitService.updateFromResponse(100, futureTime.toISOString());
      expect(rateLimitService.getState()).not.toBeNull();

      rateLimitService.reset();
      expect(rateLimitService.getState()).toBeNull();
    });
  });

  describe('getFormattedResetTime', () => {
    test('should return ISO string when state exists', () => {
      const futureTime = new Date(Date.now() + 3600000);
      rateLimitService.updateFromResponse(100, futureTime.toISOString());
      const formatted = rateLimitService.getFormattedResetTime();
      expect(formatted).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('should return "unknown" when no state', () => {
      expect(rateLimitService.getFormattedResetTime()).toBe('unknown');
    });
  });

  describe('getTimeUntilResetHuman', () => {
    test('should format minutes and seconds', () => {
      const futureTime = new Date(Date.now() + 125000); // 2m 5s
      rateLimitService.updateFromResponse(100, futureTime.toISOString());
      const formatted = rateLimitService.getTimeUntilResetHuman();
      expect(formatted).toMatch(/\d+m/);
    });

    test('should format hours and minutes', () => {
      const futureTime = new Date(Date.now() + 3900000); // 1h 5m
      rateLimitService.updateFromResponse(100, futureTime.toISOString());
      const formatted = rateLimitService.getTimeUntilResetHuman();
      expect(formatted).toMatch(/\d+h/);
    });

    test('should return "now" when time is zero or past', () => {
      const pastTime = new Date(Date.now() - 1000);
      rateLimitService.updateFromResponse(100, pastTime.toISOString());
      expect(rateLimitService.getTimeUntilResetHuman()).toBe('now');
    });
  });
});
