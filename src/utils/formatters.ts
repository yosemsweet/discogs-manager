import { DiscogsRelease } from '../types';

export function parseDiscogsRelease(data: any): DiscogsRelease {
  return {
    id: data.id,
    title: data.title,
    artists: data.artists.map((a: any) => a.name),
    year: data.year,
    genres: data.genres || [],
    styles: data.styles || [],
    uri: data.uri,
    resource_url: data.resource_url,
    thumb: data.thumb,
  };
}

export function formatGenreList(genres: string[]): string {
  return genres.join(', ');
}

export function generatePlaylistName(genres: string[], year?: number): string {
  const genreStr = genres.slice(0, 2).join(' + ');
  const yearStr = year ? ` (${year})` : '';
  return `${genreStr}${yearStr}`;
}
