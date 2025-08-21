# MusicBrainz Album Tracker - React SPA Architecture Design

## Project Overview
Complete architectural redesign of the viewing components (/catalog, /album) into a React Single Page Application with multi-user localStorage-based starring system and Admin user privileges.

## Core Architecture

### 1. Hybrid Architecture Pattern
- **Admin Functions**: Traditional Flask server-rendered pages (scanning, queue status, missing cover art)
- **Viewing Functions**: React SPA for catalog browsing and album details
- **Navigation**: Shared navbar with Admin dropdown hidden for non-Admin users

### 2. Technology Stack
- **Frontend**: React SPA with modern JavaScript (ES6+)
- **Backend**: Flask REST API endpoints for data and starring operations
- **State Management**: React Context/hooks for application state
- **Data Storage**: localStorage for user data + server backup for starred items
- **Build Tools**: Modern bundler (Vite/Webpack) for React build

## User Management System

### 3. User Types and Permissions
- **Admin User**: First user created, has access to all functionality
  - Can access Admin dropdown (scanning, queue status, missing cover art)
  - Can force catalog refresh
  - Can star/unstar albums and tracks
- **Regular Users**: Additional users with limited permissions
  - Admin dropdown hidden from navbar
  - Read-only access to catalog data
  - Can star/unstar albums and tracks (own data only)
  - Cannot force catalog refresh

### 4. User Selection Interface
- **Location**: Dropdown in navbar (replaces current user-agnostic design)
- **Default State**: Shows "Select User" with starring disabled
- **User Creation**: "Add New User" option in dropdown
- **Admin Identification**: First user created is automatically marked as Admin

### 5. Data Storage Strategy

#### localStorage Structure
```javascript
{
  "users": ["Admin", "User2", "User3"],
  "currentUser": "Admin", 
  "userData": {
    "Admin": {
      "isAdmin": true,
      "starredAlbums": ["barcode1", "barcode2"],
      "starredTracks": {"barcode1": ["1", "3"], "barcode2": ["2"]},
      "syncId": "uuid-admin-123"
    },
    "User2": {
      "isAdmin": false,
      "starredAlbums": ["barcode3"],
      "starredTracks": {"barcode3": ["1"]},
      "syncId": "uuid-user2-456"
    }
  },
  "catalogCache": {
    "lastUpdated": "2025-08-21T15:37:16.380052",
    "data": [/* catalog albums array */]
  }
}
```

#### Server Backup Strategy
- Immediate async sync of starred changes to server
- Server endpoints: `/api/starred-albums/<syncId>`, `/api/starred-tracks/<syncId>`
- Server stores data by syncId (UUID) to avoid user identification
- Fallback: If localStorage lost, users can re-import or start fresh

## React SPA Architecture

### 6. Component Structure
```
src/
├── components/
│   ├── App.jsx                 # Main app component
│   ├── UserSelector.jsx        # Navbar user dropdown
│   ├── CatalogView.jsx         # Main catalog with list/grid/artist views
│   ├── AlbumDetail.jsx         # Album detail page
│   ├── StarIcon.jsx            # Reusable star component
│   └── RefreshButton.jsx       # Admin-only catalog refresh
├── hooks/
│   ├── useUsers.js             # User management logic
│   ├── useCatalog.js           # Catalog data management
│   └── useStarred.js           # Starring functionality
├── services/
│   ├── api.js                  # All API calls
│   └── storage.js              # localStorage management
└── utils/
    └── constants.js            # App constants
```

### 7. Routing Strategy
- **React Router**: Client-side routing within SPA
- **Routes**: 
  - `/app` - Catalog view (default)
  - `/app/album/:barcode` - Album detail
- **Fallback**: Admin routes remain server-rendered (`/`, `/queue_status`, `/missing_coverart`)

### 8. State Management
- **React Context**: Global state for current user, catalog data, starred items
- **Local State**: Component-specific UI state (view mode, selected artist, etc.)
- **Persistence**: Automatic localStorage sync on state changes

## API Design

### 9. New REST Endpoints
```
GET  /api/catalog              # Get full catalog data
GET  /api/album/:barcode       # Get album details + tracks  
POST /api/starred-albums       # Sync starred albums to server
GET  /api/starred-albums/:syncId # Get starred albums backup
POST /api/starred-tracks       # Sync starred tracks to server  
GET  /api/starred-tracks/:syncId # Get starred tracks backup
POST /api/catalog/refresh      # Force catalog refresh (Admin only)
```

### 10. Data Export/Import
- **Export**: Download JSON file with user's starred data + syncId
- **Import**: File upload to restore starred data
- **Sync Code**: Share syncId between devices for easy data transfer
- **Format**: Same as localStorage userData structure for simplicity

## Migration Strategy

### 11. Implementation Phases

#### Phase 1: API Foundation
- Create new REST endpoints alongside existing routes
- Test API endpoints with current data
- Ensure backwards compatibility

#### Phase 2: React SPA Development  
- Set up React build environment
- Create basic SPA shell with routing
- Implement user management system
- Build catalog and album detail views

#### Phase 3: Integration
- Update navbar to include user selector
- Replace "Albums" link to point to React SPA
- Hide Admin dropdown for non-Admin users
- Migrate starring functionality to localStorage + API backup

#### Phase 4: Cleanup
- Remove old catalog.html and album_detail.html templates
- Remove unused Flask routes for catalog/album pages
- Optimize and polish React components

### 12. Technical Considerations

#### Build Process
- Modern bundler (Vite recommended for fast dev experience)
- Build output to Flask static folder for easy serving
- Development proxy to Flask backend during development

#### Performance
- Lazy loading for album detail views
- Virtual scrolling for large catalogs (if needed)
- Image lazy loading for cover art
- Optimistic updates for starring actions

#### Error Handling
- Graceful fallback if localStorage unavailable
- Network error handling with retry logic
- Clear user feedback for sync failures

#### Browser Compatibility
- Modern browsers only (ES6+ support required)
- localStorage availability detection
- Fallback messaging for unsupported browsers

## File Structure Changes
```
/home/vance/code/mb_album/
├── app.py                     # Flask backend (API routes added)
├── templates/
│   ├── base.html             # Updated navbar with user selector
│   ├── index.html            # Admin-only barcode scanning
│   ├── queue_status.html     # Admin-only queue status
│   ├── missing_coverart.html # Admin-only missing cover art
│   ├── starred_tracks.html   # Keep as server-rendered
│   └── react_app.html        # SPA shell template
├── static/
│   ├── dist/                 # React build output
│   │   ├── bundle.js
│   │   └── bundle.css
│   └── coverart/             # Existing cover art images
└── src/                      # React source code (new)
    └── [React component structure as outlined above]
```

## Success Criteria
1. **Functional**: All current features work in React SPA
2. **Multi-User**: Multiple users can maintain separate starred items
3. **Admin Control**: Admin users have full access, others are appropriately restricted
4. **Data Persistence**: Starred items survive browser sessions and can be exported/imported
5. **Performance**: Fast client-side navigation between catalog and album views
6. **Maintainable**: Clear separation between viewing (React) and admin (Flask) functionality

This design provides a modern, scalable architecture while maintaining the simplicity of the current system for administrative functions.