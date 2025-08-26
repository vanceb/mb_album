# Real-Time Sync Architecture Plan

## Goal
Implement automatic sync between different browser windows/devices without manual refresh, maintaining real-time consistency of starred albums and tracks.

## Core Architecture Components Needed

### 1. Real-time Communication Layer
- **WebSockets** (bidirectional, immediate updates) vs **Server-Sent Events** (simpler, server-to-client only)
- Connection management, reconnection handling

### 2. Event Sourcing Backend
- Event log: `{timestamp, user_sync_id, device_uuid, event_type, event_data}`
- Events like: `star_album`, `unstar_album`, `star_track`, `unstar_track`
- State reconstruction from event history

### 3. Device/Browser Identification
- Unique UUID per browser window/tab (stored in localStorage)
- Prevents echo-back to originating device

### 4. Conflict Resolution System
- Handle simultaneous operations from multiple devices
- State consistency guarantees

## Key Design Questions

### 1. Real-time Technology Choice
- **WebSockets**: Full bidirectional, but more complex server setup
- **Server-Sent Events (SSE)**: Simpler, unidirectional (server → client)
  
**Decision Needed**: WebSockets allow immediate event sending, SSE requires polling for outbound events.

### 2. Conflict Resolution Strategy
What should happen if two browsers simultaneously star/unstar the same album?
- **Last-write-wins** (simpler, some operations might be lost)
- **Operational transformation** (complex, but preserves all user intent)
- **Show conflicts to user** (most accurate, but UX overhead)

### 3. Device UUID Scope
- **Per browser tab** (each tab gets unique UUID)
- **Per browser instance** (all tabs in same browser share UUID)

### 4. Offline/Connection Handling
- Should the app work offline and queue changes for later sync?
- Or require constant connection with error states when disconnected?

### 5. Event History Management
- How long to retain event history? (affects storage and performance)
- Should we implement event compaction (star→unstar→star = star)?

### 6. Sync Scope
- One global event stream per sync_id?
- Or multiple sync groups/channels per user?

## Implementation Phases

### Phase 1: Simple Polling (Current Approach)
- Manual refresh button to pull latest state
- Server maintains current state snapshots
- No real-time updates

### Phase 2: Basic Real-time Updates
- Choose simpler technology (likely SSE)
- Basic event broadcasting without history
- Simple last-write-wins conflict resolution

### Phase 3: Full Event Sourcing
- Complete event log with history
- Advanced conflict resolution
- Offline support with event queuing

### Phase 4: Advanced Features
- Event compaction
- Multiple sync channels
- Performance optimizations

## Current Status
- Phase 1 complete (manual sync with refresh button)
- Ready to proceed with Phase 2 implementation
- Architecture decisions pending for simpler initial approach