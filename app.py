from flask import Flask, render_template, request, jsonify, redirect, url_for
import csv
import os
import json
import atexit
from shared_data import shared_data
from background_worker import get_worker, start_worker, stop_worker

app = Flask(__name__)

CATALOG_FILE = 'catalog.csv'
CONFIG_FILE = 'csv_fields.json'
TRACKS_CACHE_FILE = 'barcode_tracks.json'
STARRED_FILE = 'starred.csv'

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

@app.route('/')
def index():
    """Main barcode scanning page"""
    return render_template('index.html')

@app.route('/scan', methods=['POST'])
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

@app.route('/status/<barcode>')
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

@app.route('/queue')
def queue_status():
    """Queue management page"""
    stats = shared_data.get_worker_stats()
    worker_status = stats  # Worker stats includes queue stats
    return render_template('queue.html', stats=stats, worker_status=worker_status)

@app.route('/queue/stats')
def queue_stats_api():
    """API endpoint for queue statistics"""
    stats = shared_data.get_worker_stats()
    return jsonify(stats)

@app.route('/queue/failed')
def failed_barcodes():
    """Get failed barcodes for retry"""
    # Get all queue items and filter for failed ones
    all_queue = shared_data.get_queue_status()
    failed = [item for item in all_queue.values() if item.get('status') == 'failed'] if all_queue else []
    return jsonify(failed)

@app.route('/queue/retry/<barcode>', methods=['POST'])
def retry_barcode(barcode):
    """Retry a failed barcode - add back to pending queue"""
    success = shared_data.add_pending_barcode(barcode)
    if success:
        return jsonify({'success': True, 'message': f'Barcode {barcode} queued for retry'})
    else:
        return jsonify({'success': False, 'error': 'Failed to queue barcode for retry'}), 500

@app.route('/queue/no-coverart')
def no_coverart_list():
    """Get list of albums without cover art"""
    albums = shared_data.get_no_coverart_cache()
    return jsonify(albums)

@app.route('/queue/retry-coverart/<barcode>', methods=['POST'])
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

@app.route('/catalog')
def catalog():
    """Catalog review page"""
    catalog_data = shared_data.get_catalog_cache()
    return render_template('catalog.html', catalog=catalog_data)

@app.route('/missing-coverart')
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

@app.route('/album/<barcode>')
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
    
    return render_template('album_detail.html', album=album, tracks=tracks, starred_tracks=starred_set)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)