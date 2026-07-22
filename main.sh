# cat ./openstreetmap-carto-master/style/*.mss > style.mss
# cat ./osm-bright-main/*.mss > style.mss
# cat ./OpenRailwayMap-CartoCSS-master/*.mss > style.mss
# cat ./osmfr-cartocss-master/*.mss > style.mss

# config
python config.py

# extract
osmium extract -c config.json -s simple input.osm.pbf

# prepare styles
cat ./osm-bright-main/*.mss > style.mss
node compile-carto.js style.mss > style.json

# make tiles
python render_area.py --lat-min 24.8 --lon-min 121.27 --lat-max 25.3 --lon-max 122.004 --base-zoom 13 --zoom 13
python render_area.py --lat-min 24.8 --lon-min 121.27 --lat-max 25.3 --lon-max 122.004 --base-zoom 13 --zoom 14
python render_area.py --lat-min 24.8 --lon-min 121.27 --lat-max 25.3 --lon-max 122.004 --base-zoom 13 --zoom 15
python render_area.py --lat-min 24.8 --lon-min 121.27 --lat-max 25.3 --lon-max 122.004 --base-zoom 13 --zoom 16

# compress tiles
node compress-image.js --dir tiles
