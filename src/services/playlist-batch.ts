import { SoundCloudAPIClient } from '../api/soundcloud';
import { ProgressCallback, noopProgress } from '../utils/progress';

/** Maximum number of tracks SoundCloud allows in a single playlist. */
export const SOUNDCLOUD_PLAYLIST_TRACK_LIMIT = 500;

/**
 * Handles batch operations for playlists on SoundCloud.
 * Since SoundCloud caps playlists at 500 tracks and callers enforce that cap
 * upstream, all payloads are guaranteed to be ≤ 500 and can be sent in a
 * single PUT request.
 */
export class PlaylistBatchManager {
    constructor(private soundcloudClient: SoundCloudAPIClient) { }

    /**
     * Create a playlist with the given tracks in a single API call.
     * Callers must ensure trackIds.length ≤ SOUNDCLOUD_PLAYLIST_TRACK_LIMIT.
     */
    async createPlaylistWithBatching(
        title: string,
        trackIds: string[],
        description: string = '',
        isPublic: boolean = false,
        onProgress: ProgressCallback = noopProgress
    ) {
        onProgress({
            stage: 'Creating playlist',
            current: 0,
            total: trackIds.length,
            message: title,
        });

        const playlist = await this.soundcloudClient.createPlaylistWithTracks(
            title, trackIds, description, isPublic
        );

        return playlist;
    }

    /**
     * Replace an existing playlist's track list with a single PUT.
     * Callers must ensure trackIds.length ≤ SOUNDCLOUD_PLAYLIST_TRACK_LIMIT.
     */
    async addTracksInBatches(
        playlistId: string,
        trackIds: string[],
        onProgress: ProgressCallback = noopProgress
    ) {
        if (trackIds.length === 0) {
            return;
        }

        onProgress({
            stage: 'Adding tracks to playlist',
            current: trackIds.length,
            total: trackIds.length,
            message: `${trackIds.length} tracks`,
        });

        await this.soundcloudClient.addTracksToPlaylist(playlistId, trackIds);
    }
}
