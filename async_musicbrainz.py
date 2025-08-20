import musicbrainzngs
import requests
import os
from typing import Optional, Dict, Any, List
from rate_limiter import AdaptiveRateLimiter
from version import VERSION

# User agent configuration
REPO_NAME = "musicbrainz-barcode-lookup"
CONTACT = "vance@axxe.co.uk"

class RateLimitedMusicBrainz:
    """
    Rate-limited wrapper around MusicBrainz API that respects their limits
    and implements adaptive backoff on 503 errors.
    """
    
    def __init__(self, rate_limiter: AdaptiveRateLimiter):
        self.rate_limiter = rate_limiter
        
        # Initialize MusicBrainz client
        musicbrainzngs.set_useragent(REPO_NAME, VERSION, CONTACT)
        
    def lookup_by_barcode(self, barcode: str) -> Optional[Dict[str, Any]]:
        """
        Look up a release by barcode with rate limiting and error handling.
        Returns the same format as MusicBrainzBarcodeLookup.lookup_by_barcode()
        """
        self.rate_limiter.wait_if_needed()
        
        try:
            # Search for releases by barcode
            result = musicbrainzngs.search_releases(barcode=barcode)
            
            if result.get('release-list'):
                release = result['release-list'][0]
                mbid = release['id']
                
                # Get full release info with release groups
                full_release = musicbrainzngs.get_release_by_id(mbid, includes=['release-groups'])
                
                self.rate_limiter.on_request_success()
                
                return {
                    'release': release,
                    'full_release': full_release['release']
                }
            else:
                self.rate_limiter.on_request_success()
                return None
                
        except musicbrainzngs.WebServiceError as e:
            if hasattr(e, 'code') and e.code == 503:
                self.rate_limiter.on_503_error()
                raise ServiceUnavailableError(f"MusicBrainz service unavailable: {e}")
            else:
                self.rate_limiter.on_other_error()
                raise MusicBrainzError(f"MusicBrainz API error: {e}")
        except Exception as e:
            self.rate_limiter.on_other_error()
            raise MusicBrainzError(f"Unexpected error: {e}")
    
    def get_track_names(self, mbid: str) -> Optional[List[str]]:
        """
        Get track names for a release MBID with rate limiting.
        """
        self.rate_limiter.wait_if_needed()
        
        try:
            # Request the release with recordings included
            result = musicbrainzngs.get_release_by_id(mbid, includes=["recordings"])
            tracks = []
            
            # Extract track names from medium list
            mediums = result['release'].get('medium-list', [])
            for medium in mediums:
                for track in medium.get('track-list', []):
                    title = track.get('recording', {}).get('title')
                    if title:
                        tracks.append(title)
            
            self.rate_limiter.on_request_success()
            return tracks
            
        except musicbrainzngs.WebServiceError as e:
            if hasattr(e, 'code') and e.code == 503:
                self.rate_limiter.on_503_error()
                raise ServiceUnavailableError(f"MusicBrainz service unavailable: {e}")
            else:
                self.rate_limiter.on_other_error()
                raise MusicBrainzError(f"MusicBrainz API error: {e}")
        except Exception as e:
            self.rate_limiter.on_other_error()
            raise MusicBrainzError(f"Unexpected error: {e}")
    
    def download_cover_art(self, mbid: str, barcode: str, folder: str = "coverart") -> bool:
        """
        Download cover art for a release MBID with rate limiting.
        Returns True if successful, False if no cover art available.
        """
        import traceback
        
        print(f"[COVER ART] Starting download for barcode={barcode}, mbid={mbid}")
        
        # Cover Art Archive doesn't count against MusicBrainz rate limits,
        # but we still apply a small delay to be respectful
        try:
            self.rate_limiter.wait_if_needed()
            print(f"[COVER ART] Rate limiter passed for {barcode}")
        except Exception as e:
            print(f"[COVER ART ERROR] Rate limiter failed for {barcode}: {e}")
            return False
        
        url = f"https://coverartarchive.org/release/{mbid}/front"
        print(f"[COVER ART] URL: {url}")
        
        try:
            os.makedirs(folder, exist_ok=True)
            print(f"[COVER ART] Folder ensured: {folder}")
        except Exception as e:
            print(f"[COVER ART ERROR] Failed to create folder {folder}: {e}")
            traceback.print_exc()
            return False
        
        dest_path = os.path.join(folder, f"{barcode}.jpg")
        print(f"[COVER ART] Destination path: {dest_path}")
        
        # Check if file already exists
        if os.path.exists(dest_path):
            file_size = os.path.getsize(dest_path)
            print(f"[COVER ART] File already exists: {dest_path} (size: {file_size} bytes)")
            if file_size > 0:
                print(f"[COVER ART] Existing file is valid, skipping download")
                return True
            else:
                print(f"[COVER ART] Existing file is empty, will re-download")
        
        try:
            print(f"[COVER ART] Making HTTP request to {url}")
            response = requests.get(url, timeout=30, allow_redirects=True)
            print(f"[COVER ART] HTTP response: {response.status_code}")
            print(f"[COVER ART] Response headers: {dict(response.headers)}")
            print(f"[COVER ART] Content length: {len(response.content)} bytes")
            
            if response.status_code == 200:
                if len(response.content) == 0:
                    print(f"[COVER ART ERROR] Response has no content for {barcode}")
                    return False
                
                try:
                    with open(dest_path, "wb") as f:
                        f.write(response.content)
                    print(f"[COVER ART] File written to {dest_path}")
                    
                    # Verify file was written correctly
                    if os.path.exists(dest_path):
                        actual_size = os.path.getsize(dest_path)
                        print(f"[COVER ART] File verification: exists={os.path.exists(dest_path)}, size={actual_size}")
                        if actual_size > 0:
                            print(f"[COVER ART SUCCESS] Downloaded cover art to {dest_path} ({actual_size} bytes)")
                            return True
                        else:
                            print(f"[COVER ART ERROR] File was created but is empty: {dest_path}")
                            return False
                    else:
                        print(f"[COVER ART ERROR] File does not exist after write attempt: {dest_path}")
                        return False
                        
                except IOError as e:
                    print(f"[COVER ART ERROR] File write failed for {dest_path}: {e}")
                    traceback.print_exc()
                    return False
                    
            elif response.status_code == 404:
                print(f"[COVER ART] No cover art available for MBID {mbid} (404 Not Found)")
                return False
            elif response.status_code == 503:
                print(f"[COVER ART ERROR] Cover Art Archive temporarily unavailable for MBID {mbid} (503 Service Unavailable)")
                return False
            else:
                print(f"[COVER ART ERROR] Cover art download failed for MBID {mbid} (HTTP {response.status_code})")
                print(f"[COVER ART ERROR] Response text: {response.text[:200]}...")
                return False
                
        except requests.exceptions.Timeout as e:
            print(f"[COVER ART ERROR] Timeout downloading cover art for MBID {mbid}: {e}")
            traceback.print_exc()
            return False
        except requests.exceptions.ConnectionError as e:
            print(f"[COVER ART ERROR] Connection error downloading cover art for MBID {mbid}: {e}")
            traceback.print_exc()
            return False
        except requests.exceptions.RequestException as e:
            print(f"[COVER ART ERROR] Request exception downloading cover art for MBID {mbid}: {e}")
            traceback.print_exc()
            return False
        except Exception as e:
            print(f"[COVER ART ERROR] Unexpected error downloading cover art for MBID {mbid}: {e}")
            traceback.print_exc()
            return False


class MusicBrainzError(Exception):
    """Base exception for MusicBrainz API errors"""
    pass


class ServiceUnavailableError(MusicBrainzError):
    """Exception for 503 Service Unavailable errors"""
    pass


def extract_metadata_from_result(result: Dict[str, Any]) -> Dict[str, str]:
    """
    Extract key metadata from MusicBrainz result for database storage.
    """
    if not result:
        return {}
    
    release = result.get('release', {})
    full_release = result.get('full_release', {})
    
    # Extract artist name
    artist = "Unknown Artist"
    artist_credit = release.get('artist-credit')
    if artist_credit and isinstance(artist_credit, list):
        for credit in artist_credit:
            if isinstance(credit, dict) and 'artist' in credit:
                artist = credit['artist'].get('name', artist)
                break
    
    # Extract album title
    album = release.get('title', 'Unknown Album')
    
    # Extract first release date
    release_date = "Unknown"
    release_group = full_release.get('release-group')
    if release_group:
        release_date = release_group.get('first-release-date', 'Unknown')
    else:
        release_date = full_release.get('date', 'Unknown')
    
    # Extract MBID
    mbid = release.get('id', '')
    
    return {
        'artist': artist,
        'album': album,
        'release_date': release_date,
        'mbid': mbid
    }