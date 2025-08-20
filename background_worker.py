import threading
import time
import traceback
import csv
from typing import Optional
from queue_manager import QueueManager
from rate_limiter import AdaptiveRateLimiter
from shared_data import shared_data
from async_musicbrainz import (
    RateLimitedMusicBrainz, 
    ServiceUnavailableError, 
    MusicBrainzError,
    extract_metadata_from_result
)
from musicbrainz_barcode_lookup import write_release_to_csv, extract_json_path
import json
import os

class BackgroundWorker:
    """
    Background worker thread that processes barcode lookups from the queue
    with respect for MusicBrainz rate limits.
    """
    
    def __init__(self, catalog_file='catalog.csv', config_file='csv_fields.json', 
                 tracks_cache_file='barcode_tracks.json', coverart_folder='coverart',
                 no_coverart_file='no_coverart.csv'):
        self.catalog_file = catalog_file
        self.config_file = config_file
        self.tracks_cache_file = tracks_cache_file
        self.coverart_folder = coverart_folder
        self.no_coverart_file = no_coverart_file
        
        # Initialize components
        self.queue_manager = QueueManager()
        self.rate_limiter = AdaptiveRateLimiter()
        self.mb_client = RateLimitedMusicBrainz(self.rate_limiter)
        
        # Worker control
        self.is_running = False
        self.worker_thread: Optional[threading.Thread] = None
        self.stop_event = threading.Event()
        
        # Configuration
        self.max_retries = 3
        self.retry_delay = 5.0  # Base delay between retries
        self.worker_sleep = 1.0  # Sleep between queue checks
        self.cache_update_interval = 5.0  # Update shared data every 5 seconds
        self.last_cache_update = 0
    
    def start(self):
        """Start the background worker thread"""
        if self.is_running:
            print("Background worker is already running")
            return
        
        self.is_running = True
        self.stop_event.clear()
        self.worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
        self.worker_thread.start()
        print("Background worker started")
    
    def stop(self):
        """Stop the background worker thread"""
        if not self.is_running:
            return
        
        print("Stopping background worker...")
        self.is_running = False
        self.stop_event.set()
        
        if self.worker_thread:
            self.worker_thread.join(timeout=10)
        
        print("Background worker stopped")
    
    def _worker_loop(self):
        """Main worker loop that processes queue items"""
        print("Background worker loop started")
        
        while self.is_running and not self.stop_event.is_set():
            try:
                # Send heartbeat every loop iteration to prove worker is alive
                self._send_heartbeat()
                
                # Process any new pending barcodes from Flask (linear processing)
                self._process_pending_barcodes()
                
                # Get next pending barcode from database queue (one at a time)
                item = self.queue_manager.get_next_pending()
                
                if item is None:
                    # No pending items, update shared data and sleep briefly
                    self._update_shared_data_if_needed()
                    time.sleep(self.worker_sleep)
                    continue
                
                # Process the item completely before moving to next (linear processing)
                self._process_barcode_item(item)
                
                # Update shared data after each item processing
                self._update_shared_data_if_needed()
                
            except Exception as e:
                print(f"Unexpected error in worker loop: {e}")
                traceback.print_exc()
                # Don't crash on error, just continue after delay
                time.sleep(5.0)
        
        print("Background worker loop finished")
    
    def _send_heartbeat(self):
        """Send a lightweight heartbeat to prove worker is alive"""
        try:
            current_time = time.time()
            # Only send heartbeat every 2 seconds to avoid excessive file writes
            if current_time - getattr(self, '_last_heartbeat_time', 0) >= 2.0:
                from datetime import datetime
                import os
                heartbeat_data = {
                    'last_heartbeat': datetime.now().isoformat(),
                    'worker_pid': os.getpid(),
                    'is_running': self.is_running
                }
                shared_data._write_json_file(
                    shared_data.worker_stats_file.replace('.json', '_heartbeat.json'),
                    heartbeat_data
                )
                self._last_heartbeat_time = current_time
        except Exception as e:
            print(f"Error sending heartbeat: {e}")
    
    def _process_pending_barcodes(self):
        """Process any pending barcodes from Flask and add them to database queue"""
        try:
            pending_barcodes = shared_data.get_pending_barcodes()
            if not pending_barcodes:
                return
            
            print(f"Processing {len(pending_barcodes)} pending barcodes from Flask")
            
            # Remove duplicates from pending list while preserving order
            seen_barcodes = set()
            unique_barcodes = []
            for barcode in pending_barcodes:
                if barcode not in seen_barcodes:
                    seen_barcodes.add(barcode)
                    unique_barcodes.append(barcode)
                else:
                    print(f"Duplicate barcode {barcode} in pending list, skipping")
            
            for barcode in unique_barcodes:
                try:
                    # Check if already in catalog (using shared data)
                    if shared_data.is_barcode_in_catalog(barcode):
                        print(f"Barcode {barcode} already in catalog, skipping")
                        continue
                    
                    # Check if already in queue using shared data (avoid database call)
                    queue_status = shared_data.get_queue_status(barcode)
                    if queue_status:
                        print(f"Barcode {barcode} already in queue with status: {queue_status['status']}")
                        continue
                    
                    # Add to database queue
                    result = self.queue_manager.add_barcode(barcode)
                    if result['success']:
                        print(f"Added {barcode} to database queue (position {result['position']})")
                    else:
                        print(f"Failed to add {barcode} to queue: {result.get('message', 'Unknown error')}")
                    
                except Exception as e:
                    print(f"Error processing pending barcode {barcode}: {e}")
                    import traceback
                    traceback.print_exc()
            
            # Clear pending barcodes file after processing
            shared_data.clear_pending_barcodes()
            
        except Exception as e:
            print(f"Error processing pending barcodes: {e}")
            import traceback
            traceback.print_exc()
    
    def _update_shared_data_if_needed(self):
        """Update shared data files periodically"""
        current_time = time.time()
        if current_time - self.last_cache_update >= self.cache_update_interval:
            self._update_shared_data()
            self.last_cache_update = current_time
    
    def _update_shared_data(self):
        """Update all shared data files for Flask to read"""
        try:
            # Update catalog cache
            catalog_data = self._load_catalog_from_csv()
            shared_data.update_catalog_cache(catalog_data)
            
            # Update queue status
            queue_data = self._get_all_queue_items()
            shared_data.update_queue_status(queue_data)
            
            # Update worker stats
            stats = self.get_status()
            shared_data.update_worker_stats(stats)
            
            # Update no cover art cache
            no_coverart_data = self._load_no_coverart_from_csv()
            shared_data.update_no_coverart_cache(no_coverart_data)
            
        except Exception as e:
            print(f"Error updating shared data: {e}")
    
    def _load_catalog_from_csv(self):
        """Load catalog data from CSV file"""
        catalog_data = []
        if os.path.exists(self.catalog_file):
            try:
                import csv
                with open(self.catalog_file, 'r', encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    catalog_data = list(reader)
            except Exception as e:
                print(f"Error loading catalog from CSV: {e}")
        return catalog_data
    
    def _get_all_queue_items(self):
        """Get all items from database queue"""
        try:
            with self.queue_manager._get_connection() as conn:
                rows = conn.execute('SELECT * FROM barcode_queue ORDER BY created_at ASC').fetchall()
                return [dict(row) for row in rows]
        except Exception as e:
            print(f"Error getting all queue items: {e}")
            return []
    
    def _load_no_coverart_from_csv(self):
        """Load no cover art data from CSV file"""
        no_coverart_data = []
        if os.path.exists(self.no_coverart_file):
            try:
                import csv
                with open(self.no_coverart_file, 'r', encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    no_coverart_data = list(reader)
            except Exception as e:
                print(f"Error loading no cover art from CSV: {e}")
        return no_coverart_data
    
    def _get_canonical_barcode_from_catalog(self, mbid: str) -> str:
        """Get the canonical barcode from the catalog using the MBID"""
        try:
            catalog_data = self._load_catalog_from_csv()
            for item in catalog_data:
                if item.get('MusicBrainz ID') == mbid:
                    return item.get('Barcode')
            return None
        except Exception as e:
            print(f"Error getting canonical barcode: {e}")
            return None
    
    def _process_barcode_item(self, item: dict):
        """Process a single barcode item from the queue"""
        barcode = item['barcode']
        retry_count = item['retry_count']
        
        print(f"Processing barcode: {barcode} (attempt {retry_count + 1})")
        
        try:
            # Mark as processing
            self.queue_manager.update_status(barcode, 'processing')
            
            # Step 1: Get metadata if not already complete
            if not item.get('metadata_complete', False):
                result = self._lookup_metadata(barcode)
                if result is None:
                    self.queue_manager.update_status(barcode, 'failed', 'No album found for barcode')
                    return
                
                # Write to catalog CSV
                existing_barcodes = self._load_existing_barcodes()
                write_release_to_csv(result, self.catalog_file, existing_barcodes, self.config_file)
                
                # Extract and store metadata
                metadata = extract_metadata_from_result(result)
                self.queue_manager.mark_processing_step_complete(barcode, 'metadata', metadata)
                
                print(f"Metadata lookup complete for {barcode}: {metadata.get('artist')} - {metadata.get('album')}")
            
            # Always reload item to get latest metadata from database
            item = self.queue_manager.get_barcode_status(barcode)
            if not item:
                return
            
            # Step 2: Download cover art if not already complete
            if not item.get('coverart_complete', False):
                print(f"[WORKER] Processing cover art step for {barcode}")
                coverart_failed = False
                if item.get('mbid'):
                    mbid = item.get('mbid')
                    print(f"[WORKER] Starting cover art download for {barcode}, mbid: {mbid}")
                    try:
                        # Use canonical barcode from catalog for consistent filename
                        # First try to get it from the CSV, otherwise fall back to original barcode
                        canonical_barcode = self._get_canonical_barcode_from_catalog(mbid) or barcode
                        print(f"[WORKER] Using canonical barcode '{canonical_barcode}' for filename (original: '{barcode}')")
                        
                        # Check if cover art file already exists before attempting download
                        import os
                        expected_path = os.path.join(self.coverart_folder, f"{canonical_barcode}.jpg")
                        file_already_exists = False
                        if os.path.exists(expected_path):
                            file_size = os.path.getsize(expected_path)
                            print(f"[WORKER] Cover art already exists: {expected_path} (size: {file_size} bytes)")
                            if file_size > 0:
                                print(f"[WORKER] Existing cover art is valid, marking step complete")
                                self.queue_manager.mark_processing_step_complete(barcode, 'coverart')
                                print(f"[WORKER] Cover art step completed for {barcode} (existing file)")
                                file_already_exists = True
                            else:
                                print(f"[WORKER] Existing cover art file is empty, will re-download")
                        
                        success = True  # Default to success if file already exists
                        if not file_already_exists:
                            print(f"[WORKER] Calling download_cover_art for {canonical_barcode}")
                            success = self.mb_client.download_cover_art(mbid, canonical_barcode, self.coverart_folder)
                            print(f"[WORKER] Download result for {barcode}: {success}")
                        
                        if success and not file_already_exists:
                            # Verify the file actually exists and has content (only for new downloads)
                            if os.path.exists(expected_path):
                                final_size = os.path.getsize(expected_path)
                                print(f"[WORKER] Verification: cover art file exists with size {final_size} bytes")
                                if final_size > 0:
                                    self.queue_manager.mark_processing_step_complete(barcode, 'coverart')
                                    print(f"[WORKER SUCCESS] Cover art download complete for {barcode}")
                                else:
                                    print(f"[WORKER ERROR] Cover art file is empty after download: {expected_path}")
                                    coverart_failed = True
                            else:
                                print(f"[WORKER ERROR] Cover art file does not exist after successful download: {expected_path}")
                                coverart_failed = True
                        elif not success:
                            print(f"[WORKER] No cover art available for {barcode}")
                            coverart_failed = True
                        
                        # Mark step complete regardless of success to prevent getting stuck (only if not already marked)
                        if not item.get('coverart_complete', False) and not file_already_exists:
                            self.queue_manager.mark_processing_step_complete(barcode, 'coverart')
                            print(f"[WORKER] Cover art step marked complete for {barcode}")
                            
                    except Exception as e:
                        print(f"[WORKER ERROR] Exception downloading cover art for {barcode}: {e}")
                        import traceback
                        traceback.print_exc()
                        coverart_failed = True
                        # Mark as complete even on error to prevent stuck processing
                        self.queue_manager.mark_processing_step_complete(barcode, 'coverart')
                        print(f"[WORKER] Cover art step marked complete after error for {barcode}")
                else:
                    print(f"[WORKER] No MBID available for cover art download for {barcode}, marking as complete")
                    coverart_failed = True
                    # Mark as complete even without MBID to prevent getting stuck
                    self.queue_manager.mark_processing_step_complete(barcode, 'coverart')
                
                # If cover art failed, append to no_coverart.csv
                if coverart_failed:
                    artist = item.get('artist', 'Unknown Artist')
                    album = item.get('album', 'Unknown Album')
                    print(f"[WORKER] Adding {barcode} to no_coverart.csv: {artist} - {album}")
                    self._append_to_no_coverart_csv(barcode, artist, album)
            else:
                print(f"[WORKER] Skipping cover art for {barcode}: already complete")
            
            # Reload item again to ensure we have the latest state after cover art processing
            item = self.queue_manager.get_barcode_status(barcode)
            if not item:
                return
            
            # Step 3: Get track listing if not already complete
            if not item.get('tracks_complete', False):
                if item.get('mbid'):
                    tracks = self._get_and_cache_tracks(barcode, item['mbid'])
                    if tracks:
                        print(f"Track listing complete for {barcode}: {len(tracks)} tracks")
                    else:
                        print(f"No tracks available for {barcode}")
                else:
                    print(f"No MBID available for track listing for {barcode}")
                
                # Always mark tracks step as complete regardless of whether tracks were found
                self.queue_manager.mark_processing_step_complete(barcode, 'tracks')
            
            # Mark as complete
            self.queue_manager.update_status(barcode, 'complete')
            print(f"Successfully completed processing for {barcode}")
            
        except ServiceUnavailableError as e:
            # 503 error - increase retry count and possibly retry
            self.queue_manager.increment_retry_count(barcode)
            
            if retry_count + 1 >= self.max_retries:
                self.queue_manager.update_status(barcode, 'failed', f"Max retries exceeded: {e}")
                print(f"Max retries exceeded for {barcode}: {e}")
            else:
                self.queue_manager.update_status(barcode, 'pending')
                print(f"503 error for {barcode}, will retry (attempt {retry_count + 1})")
                
                # Additional delay for retries
                time.sleep(self.retry_delay * (retry_count + 1))
        
        except MusicBrainzError as e:
            # Other MusicBrainz API errors
            self.queue_manager.increment_retry_count(barcode)
            
            if retry_count + 1 >= self.max_retries:
                self.queue_manager.update_status(barcode, 'failed', str(e))
                print(f"MusicBrainz error for {barcode} (max retries exceeded): {e}")
            else:
                self.queue_manager.update_status(barcode, 'pending')
                print(f"MusicBrainz error for {barcode}, will retry: {e}")
                time.sleep(self.retry_delay)
        
        except Exception as e:
            # Unexpected errors
            error_msg = f"Unexpected error: {e}"
            self.queue_manager.update_status(barcode, 'failed', error_msg)
            print(f"Unexpected error processing {barcode}: {e}")
            traceback.print_exc()
    
    def _lookup_metadata(self, barcode: str):
        """Lookup metadata for a barcode"""
        return self.mb_client.lookup_by_barcode(barcode)
    
    def _get_and_cache_tracks(self, barcode: str, mbid: str):
        """Get track listing and cache it"""
        # Load existing cache
        tracks_cache = self._load_tracks_cache()
        
        # Check if already cached
        if barcode in tracks_cache:
            return tracks_cache[barcode]
        
        # Fetch from MusicBrainz
        tracks = self.mb_client.get_track_names(mbid)
        
        if tracks:
            # Cache the result
            tracks_cache[barcode] = tracks
            self._save_tracks_cache(tracks_cache)
        
        return tracks or []
    
    def _load_tracks_cache(self) -> dict:
        """Load track listings cache from disk"""
        if os.path.exists(self.tracks_cache_file):
            try:
                with open(self.tracks_cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                return {}
        return {}
    
    def _save_tracks_cache(self, cache: dict):
        """Save track listings cache to disk"""
        try:
            with open(self.tracks_cache_file, 'w', encoding='utf-8') as f:
                json.dump(cache, f, indent=2, ensure_ascii=False)
        except IOError as e:
            print(f"Error saving tracks cache: {e}")
    
    def _append_to_no_coverart_csv(self, barcode: str, artist: str, album: str):
        """Append album without cover art to no_coverart.csv"""
        try:
            print(f"[NO COVER ART] Attempting to add {barcode} to {self.no_coverart_file}")
            print(f"[NO COVER ART] Album: {artist} - {album}")
            
            # Check if already in the file to avoid duplicates
            existing_barcodes = set()
            if os.path.exists(self.no_coverart_file):
                try:
                    with open(self.no_coverart_file, 'r', encoding='utf-8') as f:
                        reader = csv.DictReader(f)
                        for row in reader:
                            if row.get('Barcode'):
                                existing_barcodes.add(row['Barcode'])
                    print(f"[NO COVER ART] Found {len(existing_barcodes)} existing entries")
                except Exception as e:
                    print(f"[NO COVER ART] Error reading existing file: {e}")
            
            if barcode in existing_barcodes:
                print(f"[NO COVER ART] {barcode} already exists in no_coverart.csv, skipping")
                return
            
            file_exists = os.path.exists(self.no_coverart_file)
            
            with open(self.no_coverart_file, 'a', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                
                # Write header if file is new
                if not file_exists:
                    writer.writerow(['Barcode', 'Artist', 'Album'])
                    print(f"[NO COVER ART] Created new file with header: {self.no_coverart_file}")
                
                # Write the album data
                writer.writerow([barcode, artist, album])
                print(f"[NO COVER ART SUCCESS] Added {barcode} to no_coverart.csv: {artist} - {album}")
                
        except IOError as e:
            print(f"[NO COVER ART ERROR] IO error writing to no_coverart.csv: {e}")
            import traceback
            traceback.print_exc()
        except Exception as e:
            print(f"[NO COVER ART ERROR] Unexpected error writing to no_coverart.csv: {e}")
            import traceback
            traceback.print_exc()
    
    def _load_existing_barcodes(self) -> set:
        """Load existing barcodes from catalog to prevent duplicates"""
        existing_barcodes = set()
        if os.path.exists(self.catalog_file):
            try:
                import csv
                with open(self.catalog_file, newline='', encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        barcode = row.get("Barcode")
                        if barcode:
                            existing_barcodes.add(barcode)
            except Exception as e:
                print(f"Error loading existing barcodes: {e}")
        return existing_barcodes
    
    def get_status(self) -> dict:
        """Get worker status information including queue statistics"""
        try:
            queue_stats = self.queue_manager.get_queue_stats()
            rate_stats = self.rate_limiter.get_stats()
            
            return {
                'is_running': self.is_running,
                'worker_status': {
                    'is_running': self.is_running
                },
                'queue': queue_stats.get('queue', {}),
                'processing': queue_stats.get('processing', {}),
                'rate_limiter_stats': rate_stats
            }
        except Exception as e:
            print(f"Error getting worker status: {e}")
            return {
                'is_running': self.is_running,
                'worker_status': {
                    'is_running': self.is_running
                },
                'queue': {},
                'processing': {},
                'rate_limiter_stats': {}
            }


# Global worker instance
_worker_instance: Optional[BackgroundWorker] = None

def get_worker() -> BackgroundWorker:
    """Get the global worker instance (lazy initialization)"""
    global _worker_instance
    if _worker_instance is None:
        try:
            _worker_instance = BackgroundWorker()
        except Exception as e:
            print(f"Failed to initialize background worker: {e}")
            raise
    return _worker_instance

def start_worker():
    """Start the global worker"""
    worker = get_worker()
    worker.start()

def stop_worker():
    """Stop the global worker"""
    global _worker_instance
    if _worker_instance:
        _worker_instance.stop()
        _worker_instance = None