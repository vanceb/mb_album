from flask import Flask, render_template, render_template_string, request, jsonify, redirect, url_for, abort
import csv
import os
import json
import atexit
import requests
from datetime import datetime, timedelta
from dotenv import load_dotenv
from shared_data import shared_data
from background_worker import get_worker, start_worker, stop_worker

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

CATALOG_FILE = 'catalog.csv'
CONFIG_FILE = 'csv_fields.json'
TRACKS_CACHE_FILE = 'barcode_tracks.json'
STARRED_FILE = 'starred.csv'
STARRED_ALBUMS_FILE = 'starred_albums.csv'

# Start background worker on app startup (lazy initialization)
def startup():
    try:
        start_worker()
        print("Asynchronous barcode processing started")
    except Exception as e:
        print(f"Failed to start background worker: {e}")
        print("Worker will be started on first request")

# Register startup function
with app.app_context():
    startup()

# Graceful shutdown
def shutdown():
    print("Shutting down background worker...")
    stop_worker()

atexit.register(shutdown)

def load_existing_barcodes():
    """Load existing barcodes from catalog to prevent duplicates"""
    existing_barcodes = set()
    if os.path.exists(CATALOG_FILE):
        with open(CATALOG_FILE, newline='', encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                barcode = row.get("Barcode")
                if barcode:
                    existing_barcodes.add(barcode)
    return existing_barcodes

def load_catalog():
    """Load the entire catalog for display"""
    catalog = []
    if os.path.exists(CATALOG_FILE):
        with open(CATALOG_FILE, newline='', encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                catalog.append(row)
    return catalog

def load_tracks_cache():
    """Load track listings cache from disk"""
    if os.path.exists(TRACKS_CACHE_FILE):
        try:
            with open(TRACKS_CACHE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}

def save_tracks_cache(cache):
    """Save track listings cache to disk"""
    try:
        with open(TRACKS_CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)
    except IOError as e:
        print(f"Error saving tracks cache: {e}")

def get_tracks(barcode, mbid):
    """Get track listing from cache or fetch from MusicBrainz if not cached"""
    cache = load_tracks_cache()
    
    # Check if tracks are cached for this barcode
    if barcode in cache:
        return cache[barcode]
    
    # Fetch tracks from MusicBrainz
    tracks = []
    if mbid:
        from musicbrainz_barcode_lookup import get_track_names
        tracks = get_track_names(mbid) or []
        
        # Cache the result
        cache[barcode] = tracks
        save_tracks_cache(cache)
    
    return tracks

def remove_from_no_coverart_csv(barcode_to_remove):
    """Remove a barcode from the no_coverart.csv file"""
    no_coverart_file = 'no_coverart.csv'
    
    if not os.path.exists(no_coverart_file):
        return
    
    try:
        # Read all entries
        entries = []
        with open(no_coverart_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get('Barcode') != barcode_to_remove:
                    entries.append(row)
        
        # Write back without the removed entry
        with open(no_coverart_file, 'w', newline='', encoding='utf-8') as f:
            if entries:
                writer = csv.DictWriter(f, fieldnames=['Barcode', 'Artist', 'Album'])
                writer.writeheader()
                writer.writerows(entries)
            else:
                # If no entries left, just write header
                writer = csv.writer(f)
                writer.writerow(['Barcode', 'Artist', 'Album'])
        
        print(f"Removed {barcode_to_remove} from no_coverart.csv")
    except Exception as e:
        print(f"Error removing {barcode_to_remove} from no_coverart.csv: {e}")

def update_no_coverart_cache():
    """Update the shared data no cover art cache"""
    try:
        no_coverart_file = 'no_coverart.csv'
        no_coverart_data = []
        
        if os.path.exists(no_coverart_file):
            with open(no_coverart_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                no_coverart_data = list(reader)
        
        shared_data.update_no_coverart_cache(no_coverart_data)
        print("Updated no cover art cache")
    except Exception as e:
        print(f"Error updating no cover art cache: {e}")

def load_starred_tracks():
    """Load starred tracks from CSV file"""
    starred_tracks = {}
    if os.path.exists(STARRED_FILE):
        try:
            with open(STARRED_FILE, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    barcode = row.get('Barcode')
                    track_number = row.get('Track')
                    if barcode and track_number:
                        if barcode not in starred_tracks:
                            starred_tracks[barcode] = set()
                        starred_tracks[barcode].add(track_number)
        except Exception as e:
            print(f"Error loading starred tracks: {e}")
    return starred_tracks

def save_starred_tracks(starred_tracks):
    """Save starred tracks to CSV file"""
    try:
        with open(STARRED_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['Barcode', 'Track'])
            for barcode, track_numbers in starred_tracks.items():
                for track_number in track_numbers:
                    writer.writerow([barcode, track_number])
        print(f"Saved {sum(len(track_numbers) for track_numbers in starred_tracks.values())} starred tracks")
    except Exception as e:
        print(f"Error saving starred tracks: {e}")

def is_track_starred(barcode, track_number):
    """Check if a track is starred"""
    starred_tracks = load_starred_tracks()
    return barcode in starred_tracks and str(track_number) in starred_tracks[barcode]

def star_track(barcode, track_number):
    """Star a track"""
    starred_tracks = load_starred_tracks()
    if barcode not in starred_tracks:
        starred_tracks[barcode] = set()
    starred_tracks[barcode].add(str(track_number))
    save_starred_tracks(starred_tracks)

def unstar_track(barcode, track_number):
    """Unstar a track"""
    starred_tracks = load_starred_tracks()
    if barcode in starred_tracks and str(track_number) in starred_tracks[barcode]:
        starred_tracks[barcode].remove(str(track_number))
        if not starred_tracks[barcode]:  # Remove barcode if no tracks left
            del starred_tracks[barcode]
        save_starred_tracks(starred_tracks)

def load_starred_albums():
    """Load starred albums from CSV file"""
    starred_albums = set()
    if os.path.exists(STARRED_ALBUMS_FILE):
        try:
            with open(STARRED_ALBUMS_FILE, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    barcode = row.get('Barcode')
                    if barcode:
                        starred_albums.add(barcode)
        except Exception as e:
            print(f"Error loading starred albums: {e}")
    return starred_albums

def save_starred_albums(starred_albums):
    """Save starred albums to CSV file"""
    try:
        with open(STARRED_ALBUMS_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['Barcode'])
            for barcode in starred_albums:
                writer.writerow([barcode])
        print(f"Saved {len(starred_albums)} starred albums")
    except Exception as e:
        print(f"Error saving starred albums: {e}")

def is_album_starred(barcode):
    """Check if an album is starred"""
    starred_albums = load_starred_albums()
    return barcode in starred_albums

def star_album(barcode):
    """Star an album"""
    starred_albums = load_starred_albums()
    starred_albums.add(barcode)
    save_starred_albums(starred_albums)

def unstar_album(barcode):
    """Unstar an album"""
    starred_albums = load_starred_albums()
    if barcode in starred_albums:
        starred_albums.remove(barcode)
        save_starred_albums(starred_albums)

def get_enriched_starred_tracks():
    """Get starred tracks with full album and track information"""
    starred_tracks = load_starred_tracks()
    enriched_tracks = []
    
    for barcode, track_numbers in starred_tracks.items():
        # Get album information from catalog
        album = shared_data.get_catalog_item(barcode)
        if not album:
            continue
            
        # Get track listing for this album
        mbid = album.get('MusicBrainz ID')
        tracks = get_tracks(barcode, mbid)
        
        # Get cover art URL
        cover_url = f"/static/coverart/{barcode}.jpg" if os.path.exists(f"static/coverart/{barcode}.jpg") else None
        
        for track_number in track_numbers:
            try:
                track_index = int(track_number) - 1
                if 0 <= track_index < len(tracks):
                    track_name = tracks[track_index]
                    enriched_tracks.append({
                        'barcode': barcode,
                        'track_number': track_number,
                        'track_name': track_name,
                        'artist': album.get('Artist', 'Unknown Artist'),
                        'album': album.get('Album/Release', 'Unknown Album'),
                        'cover_url': cover_url,
                        'year': album.get('First Release', '').split('-')[0] if album.get('First Release') else 'Unknown'
                    })
            except (ValueError, IndexError):
                continue
    
    # Sort by artist, then album, then track number
    enriched_tracks.sort(key=lambda x: (x['artist'], x['album'], int(x['track_number'])))
    return enriched_tracks

@app.route('/admin')
def admin_index():
    """Admin barcode scanning page"""
    return render_template('index.html')

@app.route('/admin/scan', methods=['POST'])
def scan_barcode():
    """Handle barcode scanning - add to shared pending queue"""
    data = request.get_json()
    barcode = data.get('barcode', '').strip()
    
    if not barcode:
        return jsonify({'error': 'No barcode provided'}), 400
    
    # Check if already in catalog (using shared data)
    if shared_data.is_barcode_in_catalog(barcode):
        # Return existing catalog data
        catalog_item = shared_data.get_catalog_item(barcode)
        if catalog_item:
            response = {
                'success': True,
                'status': 'already_exists',
                'barcode': barcode,
                'title': catalog_item.get('Album/Release', 'Unknown Album'),
                'artist': catalog_item.get('Artist', 'Unknown Artist'),
                'first_release': catalog_item.get('First Release', 'Unknown')
            }
            return jsonify(response)
    
    # Check if already in processing queue (using shared data)
    queue_status = shared_data.get_queue_status(barcode)
    if queue_status:
        response = {
            'success': True,
            'status': 'in_queue',
            'barcode': barcode,
            'queue_status': queue_status['status'],
            'position': queue_status.get('position'),
            'retry_count': queue_status.get('retry_count', 0),
            'message': f'Barcode already in queue with status: {queue_status["status"]}'
        }
        return jsonify(response)
    
    # Add to pending barcodes for worker to pick up
    success = shared_data.add_pending_barcode(barcode)
    if success:
        # Record scan activity for catalog rebuild tracking
        shared_data.record_scan_activity()
        response = {
            'success': True,
            'status': 'queued',
            'barcode': barcode,
            'position': 1,  # Will be determined by worker
            'message': 'Barcode queued for processing'
        }
        return jsonify(response)
    else:
        return jsonify({'error': 'Failed to queue barcode'}), 500

@app.route('/admin/status/<barcode>')
def barcode_status(barcode):
    """Get current status of a barcode"""
    # Check if in catalog first (using shared data)
    if shared_data.is_barcode_in_catalog(barcode):
        catalog_item = shared_data.get_catalog_item(barcode)
        if catalog_item:
            return jsonify({
                'status': 'complete',
                'barcode': barcode,
                'title': catalog_item.get('Album/Release', 'Unknown Album'),
                'artist': catalog_item.get('Artist', 'Unknown Artist'),
                'first_release': catalog_item.get('First Release', 'Unknown'),
                'in_catalog': True
            })
    
    # Check queue status (using shared data)
    queue_status = shared_data.get_queue_status(barcode)
    if queue_status:
        response = {
            'status': queue_status['status'],
            'barcode': barcode,
            'retry_count': queue_status['retry_count'],
            'in_catalog': False
        }
        
        if queue_status.get('position'):
            response['position'] = queue_status['position']
        
        if queue_status['status'] == 'processing':
            response['steps'] = {
                'metadata': queue_status.get('metadata_complete', False),
                'coverart': queue_status.get('coverart_complete', False), 
                'tracks': queue_status.get('tracks_complete', False)
            }
        
        if queue_status.get('error_message'):
            response['error'] = queue_status['error_message']
            
        if queue_status.get('artist') and queue_status.get('album'):
            response['title'] = queue_status['album']
            response['artist'] = queue_status['artist']
            response['first_release'] = queue_status.get('release_date', 'Unknown')
        
        return jsonify(response)
    
    return jsonify({'error': 'Barcode not found'}), 404

@app.route('/admin/queue')
def queue_status():
    """Queue management page"""
    stats = shared_data.get_worker_stats()
    worker_status = stats  # Worker stats includes queue stats
    return render_template('queue.html', stats=stats, worker_status=worker_status)

@app.route('/admin/queue/stats')
def queue_stats_api():
    """API endpoint for queue statistics"""
    stats = shared_data.get_worker_stats()
    return jsonify(stats)

@app.route('/admin/queue/failed')
def failed_barcodes():
    """Get failed barcodes for retry"""
    # Get all queue items and filter for failed ones
    all_queue = shared_data.get_queue_status()
    failed = [item for item in all_queue.values() if item.get('status') == 'failed'] if all_queue else []
    return jsonify(failed)

@app.route('/admin/queue/retry/<barcode>', methods=['POST'])
def retry_barcode(barcode):
    """Retry a failed barcode - add back to pending queue"""
    success = shared_data.add_pending_barcode(barcode)
    if success:
        # Record scan activity for catalog rebuild tracking
        shared_data.record_scan_activity()
        return jsonify({'success': True, 'message': f'Barcode {barcode} queued for retry'})
    else:
        return jsonify({'success': False, 'error': 'Failed to queue barcode for retry'}), 500

@app.route('/admin/queue/no-coverart')
def no_coverart_list():
    """Get list of albums without cover art"""
    albums = shared_data.get_no_coverart_cache()
    return jsonify(albums)

@app.route('/admin/queue/retry-coverart/<barcode>', methods=['POST'])
def retry_coverart(barcode):
    """Retry cover art download for a specific barcode"""
    try:
        # Find the album in catalog to get MBID
        album = shared_data.get_catalog_item(barcode)
        if not album:
            return jsonify({'success': False, 'error': 'Album not found in catalog'}), 404
        
        mbid = album.get('MusicBrainz ID')
        if not mbid:
            return jsonify({'success': False, 'error': 'No MusicBrainz ID available for this album'}), 400
        
        # Import the MusicBrainz client
        from async_musicbrainz import RateLimitedMusicBrainz
        from rate_limiter import AdaptiveRateLimiter
        
        rate_limiter = AdaptiveRateLimiter()
        mb_client = RateLimitedMusicBrainz(rate_limiter)
        
        # Attempt to download cover art
        success = mb_client.download_cover_art(mbid, barcode, 'coverart')
        
        if success:
            # Remove from no_coverart.csv if download was successful
            remove_from_no_coverart_csv(barcode)
            
            # Update shared data cache to reflect the change
            update_no_coverart_cache()
            
            return jsonify({
                'success': True, 
                'message': f'Cover art downloaded successfully for {album.get("Artist", "Unknown")} - {album.get("Album/Release", "Unknown")}'
            })
        else:
            return jsonify({
                'success': False, 
                'error': 'Cover art not available or download failed'
            })
            
    except Exception as e:
        print(f"Error retrying cover art for {barcode}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/admin/catalog')
def catalog():
    """Catalog review page"""
    catalog_data = shared_data.get_catalog_cache()
    starred_albums = load_starred_albums()
    return render_template('catalog.html', catalog=catalog_data, starred_albums=starred_albums)

@app.route('/admin/missing-coverart')
def missing_coverart():
    """Missing cover art management page"""
    albums = shared_data.get_no_coverart_cache()
    
    # Enrich albums with MBID data from catalog
    enriched_albums = []
    for album in albums:
        catalog_item = shared_data.get_catalog_item(album.get('Barcode'))
        if catalog_item:
            album['MBID'] = catalog_item.get('MusicBrainz ID')
        enriched_albums.append(album)
    
    return render_template('missing_coverart.html', albums=enriched_albums)

@app.route('/admin/starred-tracks')
def starred_tracks():
    """Starred tracks page"""
    starred_tracks = get_enriched_starred_tracks()
    return render_template('starred_tracks.html', starred_tracks=starred_tracks)

@app.route('/star/<barcode>/<track_number>', methods=['POST'])
def star_track_endpoint(barcode, track_number):
    """Star a track"""
    try:
        star_track(barcode, track_number)
        return jsonify({'success': True, 'message': f'Starred track #{track_number}'})
    except Exception as e:
        print(f"Error starring track #{track_number} for {barcode}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/unstar/<barcode>/<track_number>', methods=['POST'])
def unstar_track_endpoint(barcode, track_number):
    """Unstar a track"""
    try:
        unstar_track(barcode, track_number)
        return jsonify({'success': True, 'message': f'Unstarred track #{track_number}'})
    except Exception as e:
        print(f"Error unstarring track #{track_number} for {barcode}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/admin/album/<barcode>')
def album_detail(barcode):
    """Full album details view"""
    # Find the album in catalog (using shared data)
    album = shared_data.get_catalog_item(barcode)
    
    if not album:
        return "Album not found", 404
    
    # Get track listing using cached data or fetch from MusicBrainz
    mbid = album.get('MusicBrainz ID')
    tracks = get_tracks(barcode, mbid)
    
    # Get starred tracks for this album
    starred_tracks = load_starred_tracks()
    starred_set = starred_tracks.get(barcode, set())
    
    # Get starred albums
    starred_albums = load_starred_albums()
    
    return render_template('album_detail.html', album=album, tracks=tracks, starred_tracks=starred_set, starred_albums=starred_albums)

@app.route('/star-album/<barcode>', methods=['POST'])
def star_album_endpoint(barcode):
    """Star an album"""
    try:
        star_album(barcode)
        return jsonify({'success': True, 'message': f'Starred album'})
    except Exception as e:
        print(f"Error starring album {barcode}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/unstar-album/<barcode>', methods=['POST'])
def unstar_album_endpoint(barcode):
    """Unstar an album"""
    try:
        unstar_album(barcode)
        return jsonify({'success': True, 'message': f'Unstarred album'})
    except Exception as e:
        print(f"Error unstarring album {barcode}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================================
# REST API ENDPOINTS FOR REACT SPA
# ============================================================================

@app.route('/api/catalog', methods=['GET'])
def api_get_catalog():
    """API endpoint to get full catalog data"""
    try:
        catalog_data = shared_data.get_catalog_cache()
        return jsonify({
            'success': True,
            'catalog': catalog_data,
            'count': len(catalog_data)
        })
    except Exception as e:
        print(f"Error getting catalog: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/album/<barcode>', methods=['GET'])
def api_get_album(barcode):
    """API endpoint to get album details and tracks"""
    try:
        # Get album data
        album = shared_data.get_catalog_item(barcode)
        if not album:
            return jsonify({'success': False, 'error': 'Album not found'}), 404
        
        # Get tracks
        mbid = album.get('MusicBrainz ID')
        tracks = get_tracks(barcode, mbid)
        
        # Get starred status for tracks
        starred_tracks = load_starred_tracks()
        starred_set = starred_tracks.get(barcode, set())
        
        # Get starred status for album
        starred_albums = load_starred_albums()
        album_starred = barcode in starred_albums
        
        return jsonify({
            'success': True,
            'album': album,
            'tracks': tracks,
            'starred_tracks': list(starred_set),
            'album_starred': album_starred
        })
    except Exception as e:
        print(f"Error getting album {barcode}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/starred-albums', methods=['POST'])
def api_sync_starred_albums():
    """API endpoint to sync starred albums to server as backup"""
    try:
        data = request.get_json()
        sync_id = data.get('syncId')
        starred_albums = data.get('starredAlbums', [])
        
        if not sync_id:
            return jsonify({'success': False, 'error': 'syncId required'}), 400
        
        # Create backup directory if it doesn't exist
        backup_dir = 'starred_backups'
        os.makedirs(backup_dir, exist_ok=True)
        
        # Save starred albums backup
        backup_file = os.path.join(backup_dir, f'{sync_id}_albums.json')
        with open(backup_file, 'w', encoding='utf-8') as f:
            json.dump({
                'syncId': sync_id,
                'starredAlbums': starred_albums,
                'lastUpdated': shared_data.get_current_timestamp()
            }, f, indent=2)
        
        return jsonify({
            'success': True,
            'message': f'Backed up {len(starred_albums)} starred albums',
            'syncId': sync_id
        })
    except Exception as e:
        print(f"Error syncing starred albums: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/starred-albums/<sync_id>', methods=['GET'])
def api_get_starred_albums_backup(sync_id):
    """API endpoint to get starred albums backup"""
    try:
        backup_file = os.path.join('starred_backups', f'{sync_id}_albums.json')
        
        if not os.path.exists(backup_file):
            return jsonify({'success': False, 'error': 'Backup not found'}), 404
        
        with open(backup_file, 'r', encoding='utf-8') as f:
            backup_data = json.load(f)
        
        return jsonify({
            'success': True,
            'data': backup_data
        })
    except Exception as e:
        print(f"Error getting starred albums backup {sync_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/starred-tracks', methods=['POST'])
def api_sync_starred_tracks():
    """API endpoint to sync starred tracks to server as backup"""
    try:
        data = request.get_json()
        sync_id = data.get('syncId')
        starred_tracks = data.get('starredTracks', {})
        
        if not sync_id:
            return jsonify({'success': False, 'error': 'syncId required'}), 400
        
        # Create backup directory if it doesn't exist
        backup_dir = 'starred_backups'
        os.makedirs(backup_dir, exist_ok=True)
        
        # Save starred tracks backup
        backup_file = os.path.join(backup_dir, f'{sync_id}_tracks.json')
        with open(backup_file, 'w', encoding='utf-8') as f:
            json.dump({
                'syncId': sync_id,
                'starredTracks': starred_tracks,
                'lastUpdated': shared_data.get_current_timestamp()
            }, f, indent=2)
        
        return jsonify({
            'success': True,
            'message': f'Backed up starred tracks for {len(starred_tracks)} albums',
            'syncId': sync_id
        })
    except Exception as e:
        print(f"Error syncing starred tracks: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/starred-tracks/<sync_id>', methods=['GET'])
def api_get_starred_tracks_backup(sync_id):
    """API endpoint to get starred tracks backup"""
    try:
        backup_file = os.path.join('starred_backups', f'{sync_id}_tracks.json')
        
        if not os.path.exists(backup_file):
            return jsonify({'success': False, 'error': 'Backup not found'}), 404
        
        with open(backup_file, 'r', encoding='utf-8') as f:
            backup_data = json.load(f)
        
        return jsonify({
            'success': True,
            'data': backup_data
        })
    except Exception as e:
        print(f"Error getting starred tracks backup {sync_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/catalog/refresh', methods=['POST'])
def api_refresh_catalog():
    """API endpoint to refresh catalog only if needed based on scan activity"""
    try:
        print("API: Checking if catalog refresh is needed...")
        
        # Check if catalog actually needs rebuilding
        if shared_data.should_rebuild_catalog():
            print("API: Catalog rebuild needed - forcing refresh...")
            # Force refresh of catalog cache
            shared_data.force_refresh_catalog()
            
            # Mark as rebuilt
            shared_data.mark_catalog_rebuilt()
            
            message = 'Catalog refreshed due to recent scan activity'
        else:
            print("API: Catalog is up to date - no rebuild needed")
            message = 'Catalog is already up to date'
        
        # Get current catalog
        catalog_data = shared_data.get_catalog_cache()
        
        # Get scan metadata for response
        scan_metadata = shared_data.get_scan_metadata()
        
        return jsonify({
            'success': True,
            'message': message,
            'count': len(catalog_data),
            'scan_info': {
                'last_scan_time': scan_metadata.get('last_scan_time'),
                'last_catalog_rebuild': scan_metadata.get('last_catalog_rebuild'),
                'pending_rebuild': scan_metadata.get('pending_catalog_rebuild', False)
            }
        })
    except Exception as e:
        print(f"Error refreshing catalog: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================================
# REACT SPA SERVING
# ============================================================================

# React SPA routes - only handle specific frontend paths
@app.route('/')
def react_app_root():
    """Serve the React SPA at root"""
    return serve_react_app('')

# Only serve React for specific frontend routes, not catch-all
@app.route('/album/<path:path>')
@app.route('/user/<path:path>')  
@app.route('/catalog')
@app.route('/catalog/<path:path>')
def react_app_routes(path=''):
    """Serve the React SPA for specific frontend routes"""
    return serve_react_app(path)

def serve_react_app(path):
    try:
        # Check if built files exist
        bundle_js = os.path.join('static', 'dist', 'bundle.js')
        bundle_css = os.path.join('static', 'dist', 'bundle.css')
        
        if not os.path.exists(bundle_js):
            return render_template_string("""
                <h1>React App Not Built</h1>
                <p>The React application has not been built yet.</p>
                <p>To build the React app, run:</p>
                <pre>npm install && npm run build</pre>
                <p><a href="/admin">← Admin Tools</a></p>
            """), 404
        
        # Serve the built index.html file
        index_file = os.path.join('static', 'dist', 'index.html')
        if os.path.exists(index_file):
            with open(index_file, 'r') as f:
                return f.read()
        else:
            # Fallback template with module script
            return render_template_string("""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Album Catalog</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <link rel="stylesheet" href="/static/dist/bundle.css">
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/static/dist/bundle.js"></script>
</body>
</html>
            """)
    except Exception as e:
        print(f"Error serving React app: {e}")
        return f"Error loading React app: {e}", 500

# Spotify Integration
SPOTIFY_CLIENT_ID = 'bf2410b819cb452eb0ff08b17005e414'
SPOTIFY_CLIENT_SECRET = os.getenv('SPOTIFY_CLIENT_SECRET')

if not SPOTIFY_CLIENT_SECRET:
    print("WARNING: SPOTIFY_CLIENT_SECRET environment variable not set!")
    print("Please add your Spotify Client Secret to the .env file")

@app.route('/spotify/callback')
def spotify_callback():
    """Handle Spotify OAuth callback"""
    try:
        code = request.args.get('code')
        error = request.args.get('error')
        
        if error:
            return redirect(f'/?spotify_error={error}')
            
        if not code:
            return redirect('/?spotify_error=no_code')
        
        # Exchange authorization code for tokens
        token_data = {
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': 'http://127.0.0.1:5000/spotify/callback',
            'client_id': SPOTIFY_CLIENT_ID,
            'client_secret': SPOTIFY_CLIENT_SECRET
        }
        
        response = requests.post('https://accounts.spotify.com/api/token', data=token_data)
        
        if not response.ok:
            return redirect(f'/?spotify_error=token_exchange_failed')
            
        token_info = response.json()
        
        # Calculate expiration time
        expires_in = token_info.get('expires_in', 3600)
        expires_at = (datetime.now() + timedelta(seconds=expires_in)).isoformat()
        
        # Get user profile
        profile_response = requests.get('https://api.spotify.com/v1/me', 
                                      headers={'Authorization': f"Bearer {token_info['access_token']}"})
        
        if profile_response.ok:
            profile = profile_response.json()
            spotify_user_id = profile.get('id', 'unknown')
            spotify_display_name = profile.get('display_name') or profile.get('id', 'Unknown User')
        else:
            spotify_user_id = 'unknown'
            spotify_display_name = 'Unknown User'
        
        # Build auth data to pass to frontend
        auth_data = {
            'access_token': token_info['access_token'],
            'refresh_token': token_info.get('refresh_token'),
            'expires_at': expires_at,
            'user_id': spotify_user_id,
            'display_name': spotify_display_name
        }
        
        # Redirect back to React app with auth data in URL fragment
        import urllib.parse
        auth_params = urllib.parse.urlencode({'spotify_auth': json.dumps(auth_data)})
        return redirect(f'/?{auth_params}')
        
    except Exception as e:
        print(f"Spotify callback error: {e}")
        return redirect(f'/?spotify_error=callback_failed')

@app.route('/spotify/refresh', methods=['POST'])
def spotify_refresh_token():
    """Refresh Spotify access token"""
    try:
        data = request.get_json()
        refresh_token = data.get('refresh_token')
        
        if not refresh_token:
            return jsonify({'error': 'No refresh token provided'}), 400
            
        token_data = {
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token,
            'client_id': SPOTIFY_CLIENT_ID,
            'client_secret': SPOTIFY_CLIENT_SECRET
        }
        
        response = requests.post('https://accounts.spotify.com/api/token', data=token_data)
        
        if not response.ok:
            return jsonify({'error': 'Token refresh failed'}), 400
            
        token_info = response.json()
        
        # Calculate new expiration time
        expires_in = token_info.get('expires_in', 3600)
        expires_at = (datetime.now() + timedelta(seconds=expires_in)).isoformat()
        
        return jsonify({
            'access_token': token_info['access_token'],
            'expires_at': expires_at,
            'refresh_token': token_info.get('refresh_token', refresh_token)  # Use new or keep existing
        })
        
    except Exception as e:
        print(f"Spotify refresh error: {e}")
        return jsonify({'error': 'Token refresh failed'}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)