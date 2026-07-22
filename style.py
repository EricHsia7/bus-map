import json, os

class StyleSheet:
    def __init__(self, rules_path):
        with open(rules_path) as f:
            self.rules = json.load(f)

    def style_for(self, tags, env):
        """Compute the paint dict for a feature.
        tags: OSM tag dict. env: contextual vars, e.g. {'zoom':14,'layer':'roads','theme':'day'}."""
        zoom  = env.get("zoom", 0)
        layer = env.get("layer")
        result = {}
        for rule in self.rules:                       # source order = cascade order
            if rule["layer"] and layer and rule["layer"] != layer:
                continue
            z = rule["zoom"]
            if not (z["min"] <= zoom <= z["max"]):
                continue
            if all(self._match(f, tags, env) for f in rule["filters"]):
                result.update(rule["paint"])          # later matches override earlier
        return result

    @staticmethod
    def _match(f, tags, env):
        key, op, expected = f["key"], f["op"], f["value"]
        if key.startswith("env:"):                    # environmental variable
            actual = env.get(key[4:], os.environ.get(key[4:]))
        else:
            actual = tags.get(key)
        if actual is None:
            return op == "!="                         # absent key only satisfies "!="
        try:
            a, e = float(actual), float(expected)     # numeric compare when possible
        except (TypeError, ValueError):
            a, e = str(actual), str(expected)
        return {"=": a == e, "!=": a != e, ">": a > e,
                "<": a < e, ">=": a >= e, "<=": a <= e}[op]