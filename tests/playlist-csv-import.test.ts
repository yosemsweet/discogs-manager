import { parseCsvForImport, extractTrackIdFromUrl, buildCsvRow, parseCsv } from '../src/commands/export';

describe('CSV export helpers', () => {
  describe('extractTrackIdFromUrl', () => {
    test('extracts ID from fallback URL format', () => {
      expect(extractTrackIdFromUrl('https://soundcloud.com/tracks/12345')).toBe('12345');
    });

    test('returns null for permalink URL (cannot extract directly)', () => {
      expect(extractTrackIdFromUrl('https://soundcloud.com/artist/track-title')).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(extractTrackIdFromUrl('')).toBeNull();
    });
  });

  describe('parseCsv', () => {
    test('parses simple CSV correctly', () => {
      const csv = 'a,b,c\n1,2,3\n4,5,6\n';
      const rows = parseCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ a: '1', b: '2', c: '3' });
      expect(rows[1]).toEqual({ a: '4', b: '5', c: '6' });
    });

    test('handles double-quoted fields with commas', () => {
      const csv = 'name,value\n"Smith, John",42\n';
      const rows = parseCsv(csv);
      expect(rows[0].name).toBe('Smith, John');
      expect(rows[0].value).toBe('42');
    });

    test('handles escaped double quotes inside quoted fields', () => {
      const csv = 'title\n"She Said ""Yes"""\n';
      const rows = parseCsv(csv);
      expect(rows[0].title).toBe('She Said "Yes"');
    });
  });
});

describe('parseCsvForImport', () => {
  function buildPlaylistCsv(rows: Array<{
    soundcloud_url: string;
    status: string;
    include: string;
    confidence?: string;
  }>): string {
    const headers = ['discogs_artist', 'discogs_release', 'discogs_track', 'soundcloud_track', 'soundcloud_url', 'confidence', 'status', 'include'];
    const lines = [buildCsvRow(headers)];
    for (const row of rows) {
      lines.push(buildCsvRow([
        '',
        '',
        '',
        '',
        row.soundcloud_url,
        row.confidence || '0.85',
        row.status,
        row.include,
      ]));
    }
    return lines.join('\n') + '\n';
  }

  test('extracts included matched tracks', () => {
    const csv = buildPlaylistCsv([
      { soundcloud_url: 'https://soundcloud.com/tracks/111', status: 'matched', include: 'yes' },
      { soundcloud_url: 'https://soundcloud.com/tracks/222', status: 'matched', include: 'yes' },
    ]);
    const { includedTrackIds } = parseCsvForImport(csv);
    expect(includedTrackIds).toEqual(['111', '222']);
  });

  test('ignores include=yes on unmatched rows', () => {
    const csv = buildPlaylistCsv([
      { soundcloud_url: 'https://soundcloud.com/tracks/111', status: 'matched', include: 'yes' },
      { soundcloud_url: '', status: 'unmatched', include: 'yes' },
    ]);
    const { includedTrackIds } = parseCsvForImport(csv);
    expect(includedTrackIds).toEqual(['111']);
  });

  test('include=no matched rows go to excludedRows', () => {
    const csv = buildPlaylistCsv([
      { soundcloud_url: 'https://soundcloud.com/tracks/111', status: 'matched', include: 'yes' },
      { soundcloud_url: 'https://soundcloud.com/tracks/999', status: 'matched', include: 'no', confidence: '0.55' },
    ]);
    const { includedTrackIds, excludedRows } = parseCsvForImport(csv);
    expect(includedTrackIds).toEqual(['111']);
    expect(excludedRows).toHaveLength(1);
    expect(excludedRows[0].soundcloudTrackId).toBe('999');
    expect(excludedRows[0].confidence).toBe(0.55);
  });

  test('throws when more than 500 include=yes rows are present', () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      soundcloud_url: `https://soundcloud.com/tracks/${i + 1}`,
      status: 'matched',
      include: 'yes',
    }));
    const csv = buildPlaylistCsv(rows);
    expect(() => parseCsvForImport(csv)).toThrow(/501.*500/);
  });

  test('throws when a required column is missing', () => {
    // CSV without the 'include' column
    const csv = 'discogs_artist,soundcloud_url,status\n,,matched\n';
    expect(() => parseCsvForImport(csv)).toThrow(/include/);
  });

  test('throws on empty CSV (no data rows)', () => {
    expect(() => parseCsvForImport('')).toThrow();
  });

  test('returns empty arrays when no rows match', () => {
    const csv = buildPlaylistCsv([
      { soundcloud_url: '', status: 'unmatched', include: '' },
    ]);
    const { includedTrackIds, excludedRows } = parseCsvForImport(csv);
    expect(includedTrackIds).toHaveLength(0);
    expect(excludedRows).toHaveLength(0);
  });

  test('exactly 500 include=yes rows is allowed', () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      soundcloud_url: `https://soundcloud.com/tracks/${i + 1}`,
      status: 'matched',
      include: 'yes',
    }));
    const csv = buildPlaylistCsv(rows);
    const { includedTrackIds } = parseCsvForImport(csv);
    expect(includedTrackIds).toHaveLength(500);
  });
});
