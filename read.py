import osmium

class ChunkReader(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.pois = []
        self.roads = []

    def node(self, n):
        # markers: keep only tagged points (POIs)
        if n.tags and ('amenity' in n.tags or 'shop' in n.tags
                       or 'railway' in n.tags):
            self.pois.append({
                "id": n.id,
                "lat": n.location.lat,
                "lon": n.location.lon,
                "tags": dict(n.tags),          # copy — see note below
            })

    def way(self, w):
        if "highway" in w.tags:
            # (lon, lat) per node — requires locations=True below
            coords = [(nd.lon, nd.lat) for nd in w.nodes if nd.location.valid()]
            self.roads.append({
                "id": w.id,
                "tags": dict(w.tags),
                "coords": coords,
            })

h = ChunkReader()
h.apply_file("chunks/13_6861_3507.osm.pbf", locations=True, idx="flex_mem")

print(len(h.pois), "POIs;", len(h.roads), "roads")
print(h.roads[0:5])