import sqlite3
import threading
import time
from datetime import datetime
from contextlib import contextmanager
from typing import Optional, List, Dict, Any

class QueueManager:
    def __init__(self, db_path='barcode_queue.db'):
        self.db_path = db_path
        self.lock = threading.Lock()
        self._init_database()
    
    def _init_database(self):
        """Initialize the SQLite database with required tables"""
        with self._get_connection() as conn:
            # Create barcode queue table
            conn.execute('''
                CREATE TABLE IF NOT EXISTS barcode_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    barcode TEXT UNIQUE NOT NULL,
                    status TEXT DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_attempt TIMESTAMP,
                    retry_count INTEGER DEFAULT 0,
                    error_message TEXT,
                    
                    -- Processing steps completion
                    metadata_complete BOOLEAN DEFAULT FALSE,
                    coverart_complete BOOLEAN DEFAULT FALSE,
                    tracks_complete BOOLEAN DEFAULT FALSE,
                    
                    -- Metadata cache
                    artist TEXT,
                    album TEXT,
                    release_date TEXT,
                    mbid TEXT
                )
            ''')
            
            # Create processing stats table
            conn.execute('''
                CREATE TABLE IF NOT EXISTS processing_stats (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    current_backoff_seconds REAL DEFAULT 1.1,
                    total_requests INTEGER DEFAULT 0,
                    failed_requests INTEGER DEFAULT 0,
                    last_request_time TIMESTAMP,
                    last_503_time TIMESTAMP
                )
            ''')
            
            # Initialize stats record if it doesn't exist
            conn.execute('''
                INSERT OR IGNORE INTO processing_stats (id) VALUES (1)
            ''')
            
    
    @contextmanager
    def _get_connection(self):
        """Thread-safe database connection context manager"""
        with self.lock:
            conn = sqlite3.connect(
                self.db_path, 
                timeout=30.0,  # Increased timeout
                isolation_level=None  # Autocommit mode
            )
            conn.row_factory = sqlite3.Row  # Enable dict-like access
            # Enable WAL mode for better concurrency
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA synchronous=NORMAL')
            conn.execute('PRAGMA cache_size=1000')
            conn.execute('PRAGMA temp_store=memory')
            try:
                yield conn
            finally:
                conn.close()
    
    def add_barcode(self, barcode: str) -> Dict[str, Any]:
        """Add a barcode to the processing queue"""
        try:
            with self._get_connection() as conn:
                try:
                    cursor = conn.execute(
                        'INSERT INTO barcode_queue (barcode) VALUES (?)',
                        (barcode,)
                    )
                            
                    # Get queue position using the existing connection
                    try:
                        pos_row = conn.execute('''
                            SELECT COUNT(*) as position FROM barcode_queue 
                            WHERE status = 'pending' AND created_at <= (
                                SELECT created_at FROM barcode_queue WHERE barcode = ?
                            )
                        ''', (barcode,)).fetchone()
                        position = pos_row['position'] if pos_row['position'] > 0 else 1
                    except Exception:
                        position = 1  # Default position
                    
                    return {
                        'success': True,
                        'id': cursor.lastrowid,
                        'status': 'pending',
                        'position': position
                    }
                except sqlite3.IntegrityError:
                    # Barcode already exists, return current status
                    row = conn.execute(
                        'SELECT id, status, retry_count FROM barcode_queue WHERE barcode = ?',
                        (barcode,)
                    ).fetchone()
                    position = self.get_queue_position(barcode) if row['status'] == 'pending' else None
                    return {
                        'success': False,
                        'message': 'Barcode already in queue',
                        'id': row['id'],
                        'status': row['status'],
                        'retry_count': row['retry_count'],
                        'position': position
                    }
        except Exception as e:
            print(f"Error adding barcode {barcode}: {e}")
            raise
    
    def get_next_pending(self) -> Optional[Dict[str, Any]]:
        """Get the next pending barcode for processing"""
        with self._get_connection() as conn:
            row = conn.execute('''
                SELECT * FROM barcode_queue 
                WHERE status = 'pending' 
                ORDER BY created_at ASC 
                LIMIT 1
            ''').fetchone()
            
            if row:
                return dict(row)
            return None
    
    def update_status(self, barcode: str, status: str, error_message: str = None):
        """Update the status of a barcode in the queue"""
        with self._get_connection() as conn:
            conn.execute('''
                UPDATE barcode_queue 
                SET status = ?, last_attempt = CURRENT_TIMESTAMP, error_message = ?
                WHERE barcode = ?
            ''', (status, error_message, barcode))
    
    def mark_processing_step_complete(self, barcode: str, step: str, metadata: Dict[str, str] = None):
        """Mark a processing step as complete (metadata, coverart, tracks)"""
        valid_steps = ['metadata', 'coverart', 'tracks']
        if step not in valid_steps:
            raise ValueError(f"Invalid step: {step}. Must be one of {valid_steps}")
        
        with self._get_connection() as conn:
            # Build update query
            updates = [f"{step}_complete = TRUE"]
            params = []
            
            # Add metadata fields if provided
            if metadata:
                for field in ['artist', 'album', 'release_date', 'mbid']:
                    if field in metadata:
                        updates.append(f"{field} = ?")
                        params.append(metadata[field])
            
            params.append(barcode)
            
            query = f'''
                UPDATE barcode_queue 
                SET {', '.join(updates)}, last_attempt = CURRENT_TIMESTAMP
                WHERE barcode = ?
            '''
            
            conn.execute(query, params)
    
    def increment_retry_count(self, barcode: str):
        """Increment the retry count for a barcode"""
        with self._get_connection() as conn:
            conn.execute('''
                UPDATE barcode_queue 
                SET retry_count = retry_count + 1, last_attempt = CURRENT_TIMESTAMP
                WHERE barcode = ?
            ''', (barcode,))
    
    def get_queue_position(self, barcode: str) -> Optional[int]:
        """Get the position of a barcode in the pending queue"""
        with self._get_connection() as conn:
            row = conn.execute('''
                SELECT COUNT(*) as position FROM barcode_queue 
                WHERE status = 'pending' AND created_at <= (
                    SELECT created_at FROM barcode_queue WHERE barcode = ?
                )
            ''', (barcode,)).fetchone()
            
            return row['position'] if row['position'] > 0 else None
    
    def get_barcode_status(self, barcode: str) -> Optional[Dict[str, Any]]:
        """Get the current status of a barcode"""
        with self._get_connection() as conn:
            row = conn.execute(
                'SELECT * FROM barcode_queue WHERE barcode = ?',
                (barcode,)
            ).fetchone()
            
            if row:
                result = dict(row)
                if result['status'] == 'pending':
                    result['position'] = self.get_queue_position(barcode)
                return result
            return None
    
    def get_queue_stats(self) -> Dict[str, Any]:
        """Get overall queue statistics"""
        with self._get_connection() as conn:
            stats = conn.execute('''
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                    SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
                FROM barcode_queue
            ''').fetchone()
            
            processing_stats = conn.execute(
                'SELECT * FROM processing_stats WHERE id = 1'
            ).fetchone()
            
            return {
                'queue': dict(stats),
                'processing': dict(processing_stats) if processing_stats else {}
            }
    
    def get_failed_barcodes(self) -> List[Dict[str, Any]]:
        """Get all failed barcodes for retry"""
        with self._get_connection() as conn:
            rows = conn.execute('''
                SELECT * FROM barcode_queue 
                WHERE status = 'failed' 
                ORDER BY last_attempt DESC
            ''').fetchall()
            
            return [dict(row) for row in rows]
    
    def reset_failed_barcode(self, barcode: str):
        """Reset a failed barcode back to pending status"""
        with self._get_connection() as conn:
            conn.execute('''
                UPDATE barcode_queue 
                SET status = 'pending', error_message = NULL, retry_count = 0
                WHERE barcode = ? AND status = 'failed'
            ''', (barcode,))
            conn.commit()