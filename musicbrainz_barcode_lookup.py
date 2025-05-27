import musicbrainzngs
import json
import csv
import os
import argparse
import yaml
import requests
from collections import defaultdict
from version import VERSION

# Create a user agent from the repo and version.
REPO_NAME = "musicbrainz-barcode-lookup"
CONTACT = "vance@axxe.co.uk"
USER_AGENT = f"{REPO_NAME}/{VERSION} ({CONTACT})"

musicbrainzngs.set_useragent(REPO_NAME, VERSION, CONTACT)

class MusicBrainzBarcodeLookup:
    def __init__(self):
        pass
    def lookup_by_barcode(self, barcode):
        """
        Look up a release by barcode using the MusicBrainz API.

        :param barcode: The barcode to search for.
        :return: A dictionary with both the initial release and the full release info, or None if not found.
        """
        try:
            result = musicbrainzngs.search_releases(barcode=barcode)
            if result.get('release-list'):
                release = result['release-list'][0]
                mbid = release['id']
                full_release = musicbrainzngs.get_release_by_id(mbid, includes=['release-groups'])
                return {
                    'release': release,
                    'full_release': full_release['release']
                }
            else:
                return None
        except musicbrainzngs.WebServiceError as e:
            print(f"MusicBrainz API error: {e}")
            return None

    def print_release_info(self, result):
        """
        Print release information in a human-readable way.
        Prioritizes album/release name, artist, and original release year.
        """
        if not result:
            print("No release found.")
            return

        release = result['release']
        full_release = result['full_release']

        title = release.get('title', 'Unknown Title')

        # Always extract artist from release info
        artist = "Unknown Artist"
        artist_credit = release.get('artist-credit')
        if artist_credit and isinstance(artist_credit, list):
            for credit in artist_credit:
                if isinstance(credit, dict) and 'artist' in credit:
                    artist = credit['artist'].get('name', artist)
                    break

        # Try to get the first release date from 'release-group' in full_release
        first_release = "Unknown Date"
        release_group = full_release.get('release-group')
        if release_group:
            first_release = release_group.get('first-release-date', 'Unknown Date')
        else:
            first_release = full_release.get('date', 'Unknown Date')

        print(f"Album/Release: {title}")
        print(f"Artist: {artist}")
        print(f"First Release: {first_release}")


def extract_json_path(data, path):
    """Extract value from nested dict/list using dot-separated path."""
    keys = path.split('.')
    for key in keys:
        if isinstance(data, dict):
            data = data.get(key)
        elif isinstance(data, list):
            try:
                idx = int(key)
                data = data[idx]
            except (ValueError, IndexError):
                return None
        else:
            return None
        if data is None:
            return None
    return data

def write_release_to_csv(result, csv_file, existing_barcodes=None, config_file="csv_fields.json", incomplete_file="incomplete.csv"):
    """
    Append release info to a CSV file using field definitions from a config file.
    If required fields (artist or album) are missing, write to incomplete_file instead.
    Deduplicates by barcode if existing_barcodes is provided.
    """
    if not result:
        print("No release data to write.")
        return

    # Load config
    with open(config_file, "r") as f:
        fields = json.load(f)

    # Prepare row and check for missing artist/album
    row = []
    artist = None
    album = None
    barcode = None
    for field in fields:
        value = extract_json_path(result, field["path"])
        row.append(value if value is not None else "")
        if field["header"].lower() in ["artist"]:
            artist = value
        if field["header"].lower() in ["album/release", "album", "release"]:
            album = value
        if field["header"].lower() == "barcode":
            barcode = value

    # Deduplication: skip if barcode already exists
    if existing_barcodes is not None and barcode:
        if barcode in existing_barcodes:
            print(f"Barcode {barcode} already exists in catalog. Skipping.")
            return
        existing_barcodes.add(barcode)

    # Decide which file to write to
    target_file = csv_file
    if not artist or not album:
        print("Incomplete data: writing to incomplete.csv")
        target_file = incomplete_file

    # Write header if file does not exist
    write_header = not os.path.exists(target_file)
    with open(target_file, "a", newline='', encoding="utf-8") as f:
        writer = csv.writer(f)
        if write_header:
            writer.writerow([field["header"] for field in fields])
        writer.writerow(row)

def csv_to_artist_hierarchy(csv_file, yaml_file):
    """
    Reads the CSV file and creates a hierarchical data structure:
    {artist: [{album, first_release, musicbrainz_id, ...}, ...]}
    Then exports the structure to a YAML file, with releases sorted by first_release.
    """
    if not os.path.exists(csv_file):
        print(f"File {csv_file} does not exist.")
        return

    with open(csv_file, newline='', encoding="utf-8") as f:
        reader = csv.DictReader(f)
        artist_dict = defaultdict(list)
        for row in reader:
            artist = row.get("Artist", "Unknown Artist")
            album = row.get("Album/Release", "Unknown Album")
            first_release = row.get("First Release", "")
            mbid = row.get("MusicBrainz ID", "")
            # Collect all fields for flexibility
            release_info = dict(row)
            artist_dict[artist].append(release_info)

    # Sort releases for each artist by first_release (if possible)
    for releases in artist_dict.values():
        releases.sort(key=lambda x: x.get("First Release", "") or "")

    # Export to YAML
    with open(yaml_file, "w", encoding="utf-8") as f:
        yaml.dump(dict(artist_dict), f, allow_unicode=True, sort_keys=True)

    print(f"YAML hierarchy written to {yaml_file}")

def csv_to_year_artist_hierarchy(csv_file, yaml_file):
    """
    Reads the CSV file and creates a hierarchical data structure:
    {year: [{artist, album, ...}, ...]}
    Then exports the structure to a YAML file, with artists/releases sorted by release date.
    """
    if not os.path.exists(csv_file):
        print(f"File {csv_file} does not exist.")
        return

    with open(csv_file, newline='', encoding="utf-8") as f:
        reader = csv.DictReader(f)
        year_dict = defaultdict(list)
        for row in reader:
            # Extract year from "First Release"
            first_release = row.get("First Release", "")
            year = ""
            if first_release and len(first_release) >= 4 and first_release[:4].isdigit():
                year = first_release[:4]
            else:
                year = "Unknown Year"
            artist = row.get("Artist", "Unknown Artist")
            album = row.get("Album/Release", "Unknown Album")
            # Collect all fields for flexibility
            release_info = dict(row)
            release_info["Artist"] = artist
            release_info["Album/Release"] = album
            year_dict[year].append(release_info)

    # Sort releases for each year by artist then by release date
    for releases in year_dict.values():
        releases.sort(key=lambda x: (x.get("Artist", ""), x.get("First Release", "")))

    # Export to YAML
    with open(yaml_file, "w", encoding="utf-8") as f:
        yaml.dump(dict(year_dict), f, allow_unicode=True, sort_keys=True)

    print(f"YAML hierarchy by year written to {yaml_file}")

def download_cover_art(mbid, barcode, folder="coverart"):
    """
    Download the front cover art for a release MBID and save it as <barcode>.jpg in the specified folder.
    """
    url = f"https://coverartarchive.org/release/{mbid}/front"
    os.makedirs(folder, exist_ok=True)
    dest_path = os.path.join(folder, f"{barcode}.jpg")
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            with open(dest_path, "wb") as f:
                f.write(response.content)
            print(f"Downloaded cover art to {dest_path}")
        else:
            print(f"No cover art found for MBID {mbid} (HTTP {response.status_code})")
    except Exception as e:
        print(f"Error downloading cover art for MBID {mbid}: {e}")

def get_track_names(mbid):
    """
    Given a MusicBrainz release MBID, return a list of track names for that release.
    """
    try:
        # Request the release with recordings included
        result = musicbrainzngs.get_release_by_id(mbid, includes=["recordings"])
        tracks = []
        # The tracks are nested in 'medium-list' > 'track-list'
        mediums = result['release'].get('medium-list', [])
        for medium in mediums:
            for track in medium.get('track-list', []):
                title = track.get('recording', {}).get('title')
                if title:
                    tracks.append(title)
        return tracks
    except musicbrainzngs.WebServiceError as e:
        print(f"MusicBrainz API error: {e}")
        return


def scan_barcodes(input_file, output_file, coverart_folder):
    # Load existing barcodes from the input file
    existing_barcodes = set()
    if os.path.exists(input_file):
        with open(input_file, newline='', encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                barcode = row.get("Barcode")
                if barcode:
                    existing_barcodes.add(barcode)
    lookup = MusicBrainzBarcodeLookup()
    print("Enter barcodes (Ctrl+C to exit):")
    try:
        while True:
            barcode = input("> ").strip()
            if not barcode:
                continue
            if barcode in existing_barcodes:
                print(f"Barcode {barcode} already exists in catalog. Skipping.")
                continue
            release = lookup.lookup_by_barcode(barcode)
            lookup.print_release_info(release)
            write_release_to_csv(release, output_file, existing_barcodes)
            # Download cover art if possible
            if release and "release" in release:
                mbid = release["release"].get("id")
                if mbid:
                    download_cover_art(mbid, barcode, folder=coverart_folder)
            # Add to set to prevent duplicates in this session
            existing_barcodes.add(barcode)
            print("-" * 40)
    except KeyboardInterrupt:
        print("\nExiting.")

def main():
    parser = argparse.ArgumentParser(description="MusicBrainz Barcode Lookup Utility")
    parser.add_argument(
        "mode",
        choices=["scan", "byartist", "byyear", "tracks"],
        help="Mode: scan barcodes, export YAML by artist, export YAML by year, or list tracks for a release"
    )
    parser.add_argument(
        "--input",
        help="Input CSV file (used as catalog for scan mode, required for byartist, byyear modes; default: catalog.csv)",
        default="catalog.csv"
    )
    parser.add_argument(
        "--output",
        help="Output file (optional, defaults to byartist.yaml or byyear.yaml depending on mode)"
    )
    parser.add_argument(
        "--coverart",
        help="Folder to save downloaded cover art (default: coverart)",
        default="coverart"
    )
    parser.add_argument(
        "--mbid",
        help="MusicBrainz release MBID (required for tracks mode)"
    )
    args = parser.parse_args()

    # Set default output filenames based on mode
    default_outputs = {
        "byartist": "byartist.yaml",
        "byyear": "byyear.yaml"
    }

    if args.mode == "scan":
        output_file = args.output if args.output else args.input  # default to catalog.csv
        scan_barcodes(args.input, output_file, args.coverart)
    elif args.mode == "tracks":
        if not args.mbid:
            print("You must provide --mbid for tracks mode.")
            return
        try:
            # Fetch release info to get artist and album
            release_info = musicbrainzngs.get_release_by_id(args.mbid, includes=["artists"])
            release = release_info["release"]
            album = release.get("title", "Unknown Album")
            # Extract artist name(s)
            artist = "Unknown Artist"
            artist_credit = release.get("artist-credit")
            if artist_credit and isinstance(artist_credit, list):
                names = []
                for credit in artist_credit:
                    if isinstance(credit, dict) and "artist" in credit:
                        names.append(credit["artist"].get("name", ""))
                    elif isinstance(credit, str):
                        names.append(credit)
                artist = " & ".join([n for n in names if n])
            print(f"{artist} - {album}")
        except Exception as e:
            print(f"Error fetching release info: {e}")
        tracks = get_track_names(args.mbid)
        if tracks:
            print("Track list:")
            for idx, track in enumerate(tracks, 1):
                print(f"{idx}. {track}")
        else:
            print("No tracks found or error retrieving tracks.")
    else:
        # For all other modes, input is required (default is catalog.csv)
        output_file = args.output if args.output else default_outputs[args.mode]
        if args.mode == "byartist":
            csv_to_artist_hierarchy(args.input, output_file)
        elif args.mode == "byyear":
            csv_to_year_artist_hierarchy(args.input, output_file)

if __name__ == "__main__":
    main()