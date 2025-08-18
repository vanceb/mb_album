from flask import Flask, render_template, request, jsonify, redirect, url_for
import csv
import os
import json
from musicbrainz_barcode_lookup import MusicBrainzBarcodeLookup, write_release_to_csv, extract_json_path, download_cover_art

app = Flask(__name__)

CATALOG_FILE = 'catalog.csv'
CONFIG_FILE = 'csv_fields.json'
TRACKS_CACHE_FILE = 'barcode_tracks.json'

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

@app.route('/')
def index():
    """Main barcode scanning page"""
    return render_template('index.html')

@app.route('/scan', methods=['POST'])
def scan_barcode():
    """Handle barcode scanning and lookup"""
    data = request.get_json()
    barcode = data.get('barcode', '').strip()
    
    if not barcode:
        return jsonify({'error': 'No barcode provided'}), 400
    
    # Check for duplicates
    existing_barcodes = load_existing_barcodes()
    if barcode in existing_barcodes:
        return jsonify({'error': f'Barcode {barcode} already exists in catalog'}), 409
    
    # Lookup barcode
    lookup = MusicBrainzBarcodeLookup()
    result = lookup.lookup_by_barcode(barcode)
    
    if not result:
        return jsonify({'error': 'No album found for this barcode'}), 404
    
    # Extract album info for response
    release = result['release']
    full_release = result['full_release']
    
    title = release.get('title', 'Unknown Title')
    artist = "Unknown Artist"
    artist_credit = release.get('artist-credit')
    if artist_credit and isinstance(artist_credit, list):
        for credit in artist_credit:
            if isinstance(credit, dict) and 'artist' in credit:
                artist = credit['artist'].get('name', artist)
                break
    
    # Get first release date
    first_release = "Unknown Date"
    release_group = full_release.get('release-group')
    if release_group:
        first_release = release_group.get('first-release-date', 'Unknown Date')
    else:
        first_release = full_release.get('date', 'Unknown Date')
    
    # Write to CSV
    try:
        write_release_to_csv(result, CATALOG_FILE, existing_barcodes, CONFIG_FILE)
        
        # Download cover art
        mbid = release.get('id')
        if mbid:
            download_cover_art(mbid, barcode, folder="coverart")
        
        return jsonify({
            'success': True,
            'barcode': barcode,
            'title': title,
            'artist': artist,
            'first_release': first_release
        })
    except Exception as e:
        return jsonify({'error': f'Failed to write to catalog: {str(e)}'}), 500

@app.route('/catalog')
def catalog():
    """Catalog review page"""
    catalog_data = load_catalog()
    return render_template('catalog.html', catalog=catalog_data)

@app.route('/album/<barcode>')
def album_detail(barcode):
    """Full album details view"""
    # Find the album in catalog
    catalog_data = load_catalog()
    album = None
    for item in catalog_data:
        if item.get('Barcode') == barcode:
            album = item
            break
    
    if not album:
        return "Album not found", 404
    
    # Get track listing using cached data or fetch from MusicBrainz
    mbid = album.get('MusicBrainz ID')
    tracks = get_tracks(barcode, mbid)
    
    return render_template('album_detail.html', album=album, tracks=tracks)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)