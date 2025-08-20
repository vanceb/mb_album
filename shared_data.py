"""
Shared data structures for single-process database architecture.
Only the background worker touches the database - Flask reads from these files.
"""

import json
import os
import threading
from typing import Dict, List, Any, Optional
from datetime import datetime

class SharedDataManager:
    """Manages shared data files that allow Flask to avoid database access"""
    
    def __init__(self, data_dir='shared_data'):
        self.data_dir = data_dir
        self.lock = threading.Lock()
        
        # Ensure data directory exists
        os.makedirs(data_dir, exist_ok=True)
        
        # File paths
        self.pending_file = os.path.join(data_dir, 'pending_barcodes.txt')
        self.catalog_cache_file = os.path.join(data_dir, 'catalog_cache.json')
        self.queue_status_file = os.path.join(data_dir, 'queue_status.json')
        self.worker_stats_file = os.path.join(data_dir, 'worker_stats.json')
        self.no_coverart_cache_file = os.path.join(data_dir, 'no_coverart_cache.json')
    
    def add_pending_barcode(self, barcode: str) -> bool:
        """Add a barcode to the pending queue (Flask -> Worker communication)"""
        try:
            with self.lock:
                with open(self.pending_file, 'a', encoding='utf-8') as f:
                    f.write(f"{barcode}\n")
            return True
        except Exception as e:
            print(f"Error adding pending barcode {barcode}: {e}")
            return False
    
    def get_pending_barcodes(self) -> List[str]:
        """Get all pending barcodes (Worker reads this)"""
        try:
            if not os.path.exists(self.pending_file):
                return []
            
            with self.lock:
                with open(self.pending_file, 'r', encoding='utf-8') as f:
                    barcodes = [line.strip() for line in f if line.strip()]
                return barcodes
        except Exception as e:
            print(f"Error reading pending barcodes: {e}")
            return []
    
    def clear_pending_barcodes(self):
        """Clear pending barcodes file after processing (Worker only)"""
        try:
            with self.lock:
                if os.path.exists(self.pending_file):
                    os.remove(self.pending_file)
        except Exception as e:
            print(f"Error clearing pending barcodes: {e}")
    
    def update_catalog_cache(self, catalog_data: List[Dict[str, Any]]):
        """Update catalog cache (Worker only)"""
        try:
            cache_data = {
                'last_updated': datetime.now().isoformat(),
                'catalog': catalog_data
            }
            self._write_json_file(self.catalog_cache_file, cache_data)
        except Exception as e:
            print(f"Error updating catalog cache: {e}")
    
    def get_catalog_cache(self) -> List[Dict[str, Any]]:
        """Get catalog data (Flask reads this)"""
        try:
            data = self._read_json_file(self.catalog_cache_file)
            return data.get('catalog', []) if data else []
        except Exception as e:
            print(f"Error reading catalog cache: {e}")
            return []
    
    def update_queue_status(self, queue_data: List[Dict[str, Any]]):
        """Update queue status cache (Worker only)"""
        try:
            # Convert to dict with barcode as key for fast lookups
            queue_dict = {item['barcode']: item for item in queue_data}
            cache_data = {
                'last_updated': datetime.now().isoformat(),
                'queue': queue_dict
            }
            self._write_json_file(self.queue_status_file, cache_data)
        except Exception as e:
            print(f"Error updating queue status: {e}")
    
    def get_queue_status(self, barcode: str = None) -> Optional[Dict[str, Any]]:
        """Get queue status for specific barcode or all (Flask reads this)"""
        try:
            data = self._read_json_file(self.queue_status_file)
            if not data:
                return None
                
            queue_data = data.get('queue', {})
            
            if barcode:
                return queue_data.get(barcode)
            else:
                return queue_data
        except Exception as e:
            print(f"Error reading queue status: {e}")
            return None
    
    def update_worker_stats(self, stats: Dict[str, Any]):
        """Update worker statistics with heartbeat (Worker only)"""
        try:
            now = datetime.now()
            stats['last_updated'] = now.isoformat()
            stats['last_heartbeat'] = now.isoformat()
            stats['worker_pid'] = os.getpid()
            self._write_json_file(self.worker_stats_file, stats)
        except Exception as e:
            print(f"Error updating worker stats: {e}")
    
    def get_worker_stats(self) -> Dict[str, Any]:
        """Get worker statistics with health check (Flask reads this)"""
        try:
            stats = self._read_json_file(self.worker_stats_file) or {}
            
            # Read separate heartbeat file for more frequent updates
            heartbeat_file = self.worker_stats_file.replace('.json', '_heartbeat.json')
            heartbeat_data = self._read_json_file(heartbeat_file) or {}
            
            # Merge heartbeat data into stats
            if heartbeat_data:
                stats.update(heartbeat_data)
            
            # Add health check based on last heartbeat
            if stats.get('last_heartbeat'):
                try:
                    last_heartbeat = datetime.fromisoformat(stats['last_heartbeat'])
                    time_since_heartbeat = (datetime.now() - last_heartbeat).total_seconds()
                    
                    # Consider worker dead if no heartbeat for more than 10 seconds
                    stats['worker_healthy'] = time_since_heartbeat < 10
                    stats['seconds_since_heartbeat'] = time_since_heartbeat
                    
                    # Override is_running based on health check
                    if not stats['worker_healthy']:
                        stats['is_running'] = False
                        if 'worker_status' in stats:
                            stats['worker_status']['is_running'] = False
                            
                except (ValueError, TypeError):
                    stats['worker_healthy'] = False
                    stats['is_running'] = False
            else:
                stats['worker_healthy'] = False
                stats['is_running'] = False
            
            return stats
        except Exception as e:
            print(f"Error reading worker stats: {e}")
            return {'worker_healthy': False, 'is_running': False}
    
    def update_no_coverart_cache(self, no_coverart_data: List[Dict[str, str]]):
        """Update no cover art cache (Worker only)"""
        try:
            cache_data = {
                'last_updated': datetime.now().isoformat(),
                'albums': no_coverart_data
            }
            self._write_json_file(self.no_coverart_cache_file, cache_data)
        except Exception as e:
            print(f"Error updating no cover art cache: {e}")
    
    def get_no_coverart_cache(self) -> List[Dict[str, str]]:
        """Get no cover art data (Flask reads this)"""
        try:
            data = self._read_json_file(self.no_coverart_cache_file)
            return data.get('albums', []) if data else []
        except Exception as e:
            print(f"Error reading no cover art cache: {e}")
            return []
    
    def is_barcode_in_catalog(self, barcode: str) -> bool:
        """Fast check if barcode exists in catalog (Flask uses this)"""
        catalog = self.get_catalog_cache()
        return any(item.get('Barcode') == barcode for item in catalog)
    
    def get_catalog_item(self, barcode: str) -> Optional[Dict[str, Any]]:
        """Get specific catalog item by barcode (Flask uses this)"""
        catalog = self.get_catalog_cache()
        for item in catalog:
            if item.get('Barcode') == barcode:
                return item
        return None
    
    def _read_json_file(self, filepath: str) -> Optional[Dict[str, Any]]:
        """Safely read a JSON file"""
        if not os.path.exists(filepath):
            return None
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return None
    
    def _write_json_file(self, filepath: str, data: Dict[str, Any]):
        """Safely write a JSON file"""
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except IOError as e:
            print(f"Error writing {filepath}: {e}")

# Global instance
shared_data = SharedDataManager()