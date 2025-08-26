# Spotify Integration Design & Implementation Plan

## Overview
Add Spotify playback integration to the album catalog, allowing users to link catalog albums to Spotify and play them on their devices.

## Design Decisions (Finalized)

### 1. User Authentication & Scope
- ✅ Each catalog user links their own Spotify account
- ✅ Link data stored in localStorage alongside starred data
- ✅ Spotify Premium required (for playback control)

### 2. Search & Matching Strategy  
- ✅ On-demand linking (user-initiated)
- ✅ User chooses specific Spotify album from search results
- ✅ Show chronological releases for selection
- ✅ Use Artist + Album name + release year for search matching

### 3. User Interface Integration
- ✅ Play buttons in every album view:
  - **Album covers**: Overlay button next to star button (grid/artist views)
  - **List view**: Separate "Play" column in table
  - **Album detail**: Play buttons on individual tracks
- ✅ Auto-detect devices and show picker
- ✅ Match current UI style (not Spotify branding)

### 4. Data Architecture
- ✅ No database - store in localStorage
- ✅ Linked albums in user's localStorage alongside starred data
- ✅ User-specific Spotify album links
- ✅ Handle unavailable albums with re-search option

### 5. Feature Scope for MVP
- ✅ Album playback + individual track control
- ✅ Start with play/pause functionality
- ✅ No playlist features initially

### 6. Workflow
- ✅ No batch process for existing/new albums
- ✅ Allow re-linking and removal of links
- ✅ Manual linking process for each album

## Data Structure Extension

### User Data Schema Update
```javascript
const userData = {
  isAdmin: false,
  starredAlbums: [...],
  starredTracks: {...},
  syncId: "uuid",
  linkedSyncId: "uuid",
  // NEW Spotify integration fields:
  spotifyAuth: {
    accessToken: "token",
    refreshToken: "token", 
    expiresAt: timestamp,
    userId: "spotify_user_id"
  },
  linkedAlbums: {
    "barcode1": {
      spotifyAlbumId: "spotify_album_id",
      spotifyAlbumName: "Album Name",
      spotifyArtist: "Artist Name", 
      spotifyUri: "spotify:album:id",
      linkedAt: timestamp
    }
  }
}
```

## Implementation Phases

### Phase 1: Spotify Authentication & User Setup
- Set up Spotify Developer App credentials
- Implement OAuth 2.0 flow using Spotify Web API
- Create Spotify authentication component/modal
- Extend user data structure for Spotify auth tokens
- Add token refresh mechanism

### Phase 2: Album Search & Linking System  
- Create Spotify search API integration
- Implement album search with artist/album/year matching
- Create album selection modal for multiple results (chronological display)
- Add "Link to Spotify" button to album covers (next to star button)
- Store linked Spotify album IDs in user's localStorage

### Phase 3: Play Button Integration
- Add play buttons to all views:
  - Album covers: Overlay play button next to star
  - List view: New "Play" column 
  - Album detail: Individual track play buttons
- Implement device detection and selection
- Add basic playback controls (play/pause)

### Phase 4: Error Handling & Management
- Handle unavailable/deleted Spotify albums
- Implement re-search and re-linking functionality  
- Add unlinking capability
- Graceful API error handling

### Phase 5: Enhanced Playback Features
- Track progress indication
- Next/previous track controls
- Volume control
- Queue management

## Technical Implementation Notes

### Spotify Web API Endpoints Needed
- `/v1/search` - Search for albums
- `/v1/me/player/devices` - Get available devices  
- `/v1/me/player/play` - Start/resume playback
- `/v1/me/player/pause` - Pause playback
- `/v1/me/player` - Get current playback state

### Authentication Flow
1. User clicks "Connect Spotify" in Transfer Modal or settings
2. Redirect to Spotify OAuth with required scopes
3. Handle callback and store tokens
4. Refresh tokens as needed

### Required Spotify Scopes
- `user-read-playback-state` - Read current playback
- `user-modify-playback-state` - Control playback
- `user-read-currently-playing` - Get current track
- `streaming` - Play tracks in web player (if needed)

### UI Components to Create
- `SpotifyAuth` - Authentication flow component
- `SpotifySearch` - Album search and selection modal
- `SpotifyPlayButton` - Reusable play button component  
- `SpotifyDevicePicker` - Device selection dropdown
- `SpotifyLinkManager` - Link/unlink management

## Answers to Implementation Questions

1. **Spotify Developer Setup**: Guide user through Spotify App registration
2. **Device Control**: Auto-detect available devices and show picker
3. **Play Button Style**: Match current UI style (not official Spotify branding)
4. **Search Results**: Show chronological releases for user selection

## Next Steps
1. Guide user through Spotify Developer App setup
2. Begin Phase 1 implementation with authentication flow
3. Extend localStorage data structures
4. Create basic UI components for Spotify integration