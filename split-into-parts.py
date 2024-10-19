import ijson
import json
from decimal import Decimal

# Path to the large GeoJSON file
geojson_file = 'data.geojson'

# Set how many features each output file should contain
features_per_file = 4096

# Set the output dir
outdir = './dist'

# Helper function to convert Decimal to float recursively
def convert_decimals(obj):
    if isinstance(obj, list):
        return [convert_decimals(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: convert_decimals(v) for k, v in obj.items()}
    elif isinstance(obj, Decimal):
        return float(obj)
    else:
        return obj

# Initialize file counter and feature buffer
file_counter = 1
feature_buffer = []
feature_type_buffer = []
style = {
    "version": 8,
    "sources": {},
    "layers": []
    }

# Open the large GeoJSON file
with open(geojson_file, 'r', encoding='utf-8') as file:
    # Use ijson to incrementally parse the 'features' array
    for feature in ijson.items(file, 'features.item'):
        feature_type = feature['geometry']['type']
        if feature_type in ['Point']:
            continue
        # Convert any Decimal values to float
        feature = convert_decimals(feature)
        # Remove unnecessary properties
        if 'properties' in feature:
            del feature['properties']
        # Add the feature to this part
        feature_buffer.append(feature)
        # Register feature type for this part
        if feature_type not in feature_type_buffer:
            feature_type_buffer.append(feature_type)     

        # Once the buffer reaches the desired size, write to a new GeoJSON file
        if len(feature_buffer) >= features_per_file:
            output_filename = f'{outdir}/parts/{file_counter}.geojson'
            style_key = f'p-{file_counter}'
            url = f'https://erichsia7.github.io/bus-map/dist/parts/{file_counter}.geojson'
            with open(output_filename, 'w', encoding='utf-8') as output_file:
                # Write the GeoJSON structure with the buffered features
                json.dump({
                    "type": "FeatureCollection",
                    "features": feature_buffer
                }, output_file, ensure_ascii=False)
                style['sources'][style_key] = {
                    "type": "geojson",
                    "data": url
                }
                for feature_type in feature_type_buffer:
                    graphy_type = ''
                    geometry_type = ''
                    paint = {}
                    if feature_type in ['Point', 'MultiPoint']:
                        graphy_type = 'circle'
                        geometry_type = 'Point'
                        paint = {
                            "circle-radius": 4,
                            "circle-color": "#329CFF",
                            "circle-opacity": [
                                "interpolate", 
                                ["linear"], 
                                ["zoom"],
                                12, 0,
                                15, 1
                            ]
                            # Completely transparent at zoom 12
                            # Fully opaque at zoom 15
                        }
                    if feature_type in ['LineString', 'MultiLineString']:
                        graphy_type = 'line'
                        geometry_type = 'LineString'
                        paint = {
                            "line-color": "#888888",
                            "line-width": 2
                        }
                    if feature_type in ['Polygon', 'MultiPolygon']:
                        graphy_type = 'fill'
                        geometry_type = 'Polygon'
                        paint = {
                            "fill-color": "#888888",
                            "fill-opacity": [
                                "interpolate", 
                                ["linear"], 
                                ["zoom"],
                                10, 0,
                                12, 0.3
                            ]
                        }
                    style['layers'].append({
                        "id": f'{style_key}-{geometry_type}',
                        "type": graphy_type,
                        "source": style_key,
                        "filter": ["==", "$type", geometry_type],
                        "paint": paint
                    })

            print(f'Created {output_filename} with {len(feature_buffer)} features.')

            # Clear the buffer and increment the file counter
            feature_buffer = []
            feature_type_buffer = []
            file_counter += 1

    # Write any remaining features to the final file
    if feature_buffer:
        output_filename = f'{outdir}/parts/{file_counter}.geojson'
        with open(output_filename, 'w', encoding='utf-8') as output_file:
            json.dump({
                "type": "FeatureCollection",
                "features": feature_buffer
            }, output_file, ensure_ascii=False)
    # Save style
    style_filename = f'{outdir}/style.json'
    with open(style_filename, 'w', encoding='utf-8') as style_file:
        json.dump(style, style_file, ensure_ascii=False)
    