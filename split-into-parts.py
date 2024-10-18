import ijson
import json
from decimal import Decimal

# Path to the large GeoJSON file
geojson_file = 'data.geojson'

# Set how many features each output file should contain
features_per_file = 2048

# Set the output dir
outdir = './parts'

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

# Open the large GeoJSON file
with open(geojson_file, 'r', encoding='utf-8') as file:
    # Use ijson to incrementally parse the 'features' array
    for feature in ijson.items(file, 'features.item'):
        # Convert any Decimal values to float
        feature = convert_decimals(feature)
        feature_buffer.append(feature)

        # Once the buffer reaches the desired size, write to a new GeoJSON file
        if len(feature_buffer) >= features_per_file:
            output_filename = f'{outdir}/{file_counter}.geojson'
            with open(output_filename, 'w', encoding='utf-8') as output_file:
                # Write the GeoJSON structure with the buffered features
                json.dump({
                    "type": "FeatureCollection",
                    "features": feature_buffer
                }, output_file, ensure_ascii=False)

            print(f'Created {output_filename} with {len(feature_buffer)} features.')

            # Clear the buffer and increment the file counter
            feature_buffer = []
            file_counter += 1

    # Write any remaining features to the final file
    if feature_buffer:
        output_filename = f'{outdir}/{file_counter}.geojson'
        with open(output_filename, 'w', encoding='utf-8') as output_file:
            json.dump({
                "type": "FeatureCollection",
                "features": feature_buffer
            }, output_file, ensure_ascii=False)