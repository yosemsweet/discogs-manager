export interface DiscogsRelease {
  id: number;
  title: string;
  artists: string[];
  year: number;
  genres: string[];
  styles: string[];
  uri: string;
  resource_url: string;
  thumb: string;
  condition?: string;
  rating?: number;
}

export interface DiscogsCollection {
  id: number;
  name: string;
  count: number;
  uri: string;
  resource_url: string;
  releases: DiscogsRelease[];
}

export interface PlaylistFilter {
  genres?: string[];
  minYear?: number;
  maxYear?: number;
  minRating?: number;
  maxRating?: number;
  styles?: string[];
}

export interface SoundCloudPlaylist {
  id: string;
  title: string;
  description: string;
  trackCount: number;
  uri: string;
}

export interface StoredRelease {
  discogsId: number;
  title: string;
  artists: string;
  year: number;
  genres: string;
  styles: string;
  condition?: string;
  rating?: number;
  addedAt: Date;
}
