## Create a calalogue of your albums

Scan the barcodes (or type them in).  The code will perform a MusicBrainz lookup using the barcode.  This data is then stored in a csv file for further processing as required.

The current code allows the output of the catalogue in yaml format grouped either by artist or by original release year.

### Example usage

Allow the input of barcodes, written by default to `catalog.csv`

~~~ sh
python musicbrainz_barcode_lookup.py scan
~~~

Specify a different output file:

~~~sh
python musicbrainz_barcode_lookup.py scan --output barcodes.csv
~~~

Convert the existing catalog into yaml grouped by artist:

~~~sh
python musicbrainz_barcode_lookup.py byartist
~~~

Specify the catalog file and the output file

~~~sh
python musicbrainz_barcode_lookup.py byartist --input barcodes.csv --output artist-album.yaml
~~~

Grouped by original release year

~~~sh
python musicbrainz_barcode_lookup.py byyear
~~~
