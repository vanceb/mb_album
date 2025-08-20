import time
import threading
import sqlite3
from datetime import datetime, timedelta
from typing import Optional
from contextlib import contextmanager

class AdaptiveRateLimiter:
    """
    Adaptive rate limiter that respects MusicBrainz API limits:
    - 1 request per second base limit
    - Adaptive backoff on 503 errors
    - Gradual recovery when requests succeed
    """
    
    def __init__(self, db_path='barcode_queue.db'):
        self.db_path = db_path
        self.lock = threading.Lock()
        
        # Rate limiting configuration
        self.min_delay = 1.1        # Just above 1 req/sec (MusicBrainz limit)
        self.max_delay = 60.0       # Maximum 1-minute delay
        self.backoff_multiplier = 1.5  # Increase delay factor on 503
        self.recovery_factor = 0.95    # Decrease delay factor on success
        self.max_consecutive_failures = 5  # Max failures before extended backoff
        
        # State tracking
        self.consecutive_failures = 0
        self.last_request_time = 0
        
        # Load persistent state from database
        self._load_state()
    
    @contextmanager
    def _get_connection(self):
        """Get database connection"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()
    
    def _load_state(self):
        """Load persistent state from database"""
        try:
            with self._get_connection() as conn:
                row = conn.execute(
                    'SELECT * FROM processing_stats WHERE id = 1'
                ).fetchone()
                
                if row:
                    self.current_delay = max(row['current_backoff_seconds'], self.min_delay)
                    self.last_request_time = time.time() - 2  # Allow immediate first request
                else:
                    self.current_delay = self.min_delay
                    self.last_request_time = time.time() - 2
        except Exception:
            # If database doesn't exist yet, use defaults
            self.current_delay = self.min_delay
            self.last_request_time = time.time() - 2
    
    def _save_state(self):
        """Save current state to database"""
        try:
            with self._get_connection() as conn:
                conn.execute('''
                    UPDATE processing_stats 
                    SET current_backoff_seconds = ?, 
                        last_request_time = CURRENT_TIMESTAMP
                    WHERE id = 1
                ''', (self.current_delay,))
                conn.commit()
        except Exception as e:
            print(f"Warning: Could not save rate limiter state: {e}")
    
    def wait_if_needed(self):
        """Wait if necessary to respect rate limits"""
        with self.lock:
            current_time = time.time()
            time_since_last = current_time - self.last_request_time
            
            if time_since_last < self.current_delay:
                sleep_time = self.current_delay - time_since_last
                time.sleep(sleep_time)
            
            self.last_request_time = time.time()
    
    def on_request_success(self):
        """Called when a request succeeds - gradually reduce backoff"""
        with self.lock:
            self.consecutive_failures = 0
            
            # Gradually reduce delay towards minimum
            if self.current_delay > self.min_delay:
                self.current_delay = max(
                    self.current_delay * self.recovery_factor,
                    self.min_delay
                )
            
            self._update_stats(success=True)
            self._save_state()
    
    def on_503_error(self):
        """Called when receiving 503 Service Unavailable - increase backoff"""
        with self.lock:
            self.consecutive_failures += 1
            
            # Increase delay with backoff multiplier
            self.current_delay = min(
                self.current_delay * self.backoff_multiplier,
                self.max_delay
            )
            
            # Extended backoff after many consecutive failures
            if self.consecutive_failures >= self.max_consecutive_failures:
                self.current_delay = min(self.current_delay * 2.0, self.max_delay)
            
            self._update_stats(success=False, is_503=True)
            self._save_state()
            
            print(f"503 error received. Increased backoff to {self.current_delay:.1f}s "
                  f"(consecutive failures: {self.consecutive_failures})")
    
    def on_other_error(self):
        """Called when receiving other errors (not 503)"""
        with self.lock:
            # Don't change backoff for non-503 errors, but track stats
            self._update_stats(success=False, is_503=False)
    
    def _update_stats(self, success: bool, is_503: bool = False):
        """Update request statistics in database"""
        try:
            with self._get_connection() as conn:
                if success:
                    conn.execute('''
                        UPDATE processing_stats 
                        SET total_requests = total_requests + 1
                        WHERE id = 1
                    ''')
                else:
                    if is_503:
                        conn.execute('''
                            UPDATE processing_stats 
                            SET total_requests = total_requests + 1,
                                failed_requests = failed_requests + 1,
                                last_503_time = CURRENT_TIMESTAMP
                            WHERE id = 1
                        ''')
                    else:
                        conn.execute('''
                            UPDATE processing_stats 
                            SET total_requests = total_requests + 1,
                                failed_requests = failed_requests + 1
                            WHERE id = 1
                        ''')
                conn.commit()
        except Exception as e:
            print(f"Warning: Could not update stats: {e}")
    
    def get_current_delay(self) -> float:
        """Get the current delay between requests"""
        with self.lock:
            return self.current_delay
    
    def get_stats(self) -> dict:
        """Get current rate limiter statistics"""
        with self.lock:
            try:
                with self._get_connection() as conn:
                    row = conn.execute(
                        'SELECT * FROM processing_stats WHERE id = 1'
                    ).fetchone()
                    
                    if row:
                        stats = dict(row)
                        stats['current_delay'] = self.current_delay
                        stats['consecutive_failures'] = self.consecutive_failures
                        return stats
                    else:
                        return {
                            'current_delay': self.current_delay,
                            'consecutive_failures': self.consecutive_failures,
                            'total_requests': 0,
                            'failed_requests': 0
                        }
            except Exception:
                return {
                    'current_delay': self.current_delay,
                    'consecutive_failures': self.consecutive_failures,
                    'total_requests': 0,
                    'failed_requests': 0
                }
    
    def reset_backoff(self):
        """Manually reset backoff to minimum (for admin use)"""
        with self.lock:
            self.current_delay = self.min_delay
            self.consecutive_failures = 0
            self._save_state()
            print("Rate limiter backoff reset to minimum delay")
    
    def time_until_next_request(self) -> float:
        """Get time in seconds until next request can be made"""
        with self.lock:
            current_time = time.time()
            time_since_last = current_time - self.last_request_time
            
            if time_since_last >= self.current_delay:
                return 0.0
            else:
                return self.current_delay - time_since_last