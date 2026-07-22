# OpenStreetMap "FR" Carto

Une adaptation "french-style" de la ré-implémentation CartoCSS du style Mapnik d'OpenStreetMap

Le résultat est visible sur: http://tile.openstreetmap.fr/

A project to re-implement the standard OpenStreetMap mapnik style, in CartoCSS... with "french-style" modifications.


# Bugs ?

Open issues here on github !


# Changements par rapport au setup d'origine

Le nom de la base est 'osm', utilisateur 'fr'.
Les requêtes SQL utilisent les hstore pour récupérer certaines données, pensez à les inclure dans votre import osm2pgsql.
C'est Mapnik 3.x qui est utilisé avec postgresql 12 minimum et postgis 3.


# Notes suite aux optimisations de l'été 2021

## cache-features !!

Par défaut, mapnik ré-exécute les requêtes postgresql pour chaque sous-style d'un même layer (les '::substyle' dans le cartocss).
Ceci provoque une charge inutile lors du rendu, et pour l'éviter on peut conserver le résultat d'une requête pour tous les sous-style d'un même layer.
Ceci se définit avec:

```
properties:
  cache-features: true
```
On peut même le mettre partout, le code de mapnik vérifiant si il y a un seul style ou plusieurs.

## requêtes asynchrones

Mapnik peut exécuter plusieurs requêtes postgresql en paralèlle, pour prendre de l'avance sur les couches suivantes à rendre.

```
    asynchronous_request: true
    max_async_connection: 4
```
Mais attention, il faut aussi augmenter le nombre maximum de connexion que mapnik fera vers postgresql !

```
    max_size: 200
```
Remarques:
- max_async_connection doit être au moins égal à 2 pour que l'asynchronisme fonctionne
- max_size devra être au moins égal au nombre de threads de renderd x max_async_connection

Ces paramètres sont à renseigner dans les paramètres de datasource postgis.


## curseurs postgresql

Le rendu des premiers niveaux de zoom peut provoquer des saturations mémoire de renderd.
Ceci semble lié au volume important des résultats des requêtes postgresql.
On peut utiliser des curseurs, pour éviter de saturer la RAM.

```
    cursor_size: 5000
```

Remarque:
- les requêtes asynchrones doivent être activées pour que les curseurs soient utilisés par mapnik.


## Index gist ou spgist

Avec postgresql 13 et postgis 3.1, les index sp-gist peuvent être utilisés sur tous les type de géométries.

Il sont typiquement 3 fois plus petits sur les index GIST, ce qui permet d'avoir une proportion plus importante d'index en cache et donc de réduire les I/O.

osm2pgsql crée par défaut des index GIST, une ré-indexation est donc bénéfique après l'import initial.

## Index conditionnels

Certains index conditionnels font référence à des objets très similaires, par exemple l'index sur boundary et celui sur admin_level. Une condition "OR" permet d'avoir un seul index, à peine plus gros que l'un des deux et qui sera utilisé dès que le WHERE aura un test sur l'un ou l'autre des conditions.

Exemple:
- CREATE INDEX... WHERE boundary IS NOT NULL OR admin_level IS NOT NULL;
- SELECT ... WHERE boundary = 'administrative';

## Limiter le nombre d'objets retournés par postgresql à mapnik

Il vaut mieux ajouter des conditions dans les requêtes postgres pour réduire le nombre d'objets sélectionnés que faire la sélection en aval dans mapnik.

Pour éviter d'écrire une requête pour chaque niveau de zoom, on peut tester !scale_denominator! ou !pixel_width! pour déterminer le niveau de zoom.

Pour objets linéaires ou surfaciques, on peut fixer une longueur ou surface minimale en dessous de laquelle leur rendu sera inutile.

# pré-rendu landcover

Un rendu seul de 4 gros PNG en zoom 8 est fait à l'aide de nik4 en sélectionnant les layers utiles.
Ils sont ensuite combinés en un TIF avec overview, et utilisés par les zoom 0 à 7.


---

Le reste du readme ci-dessous est inchangé par rapport au projet https://github.com/gravitystorm/openstreetmap-carto


# Setup

You need OpenStreetMap data loaded into a PostGIS database (see below for [dependencies](https://github.com/gravitystorm/openstreetmap-carto#dependencies)). These stylesheets currently work only with the osm2pgsql defaults (i.e. database name is 'gis', table names are 'planet_osm_point' etc).

It's probably easiest to grab an PBF of OSM data from [metro.teczno.com](http://metro.teczno.com/) or [geofabrik](http://download.geofabrik.de/). Once you've set up your PostGIS database, import with osm2pgsql:

```
osm2pgsql -d gis ~/path/to/data.osm.pbf
```

You also need to run the additions.sql file to create some extra tables in the database.


Additionally you need some shapefiles.


## Scripted download

To download the shapefiles you can run the following script from this directory. No further steps should be needed as the data has been processed and placed in the requisite directories.
The second script is also needed by the style.

```
sh get-shapefiles.sh
sh get-layers.sh
```


## Dependencies

* This is a Kosmtik project designed for mapnik 3.x

---

* [osm2pgsql 0.92](http://wiki.openstreetmap.org/wiki/Osm2pgsql) to import you data into a PostGIS database
* [PostgreSQL 10](http://www.postgresql.org/)
* [PostGIS 2.4](http://postgis.refractions.net/)
* [ogr2ogr 2.1](http://www.gdal.org/) command line GDAL utility for processing vector data. here we use it to work around a encoding bug in the Nautral Earth data.

# Notes on conversion

* Always specify zoom levels as either >= or < . Don't use = or =< or >
* Open curly braces on the same line, and close on an empty line.
* One space before and after =  etc
* Two space indents. No tabs.
* space after : but no before
* If there is a `&minscale_zoom18;`, ignore it. These really mess up any attempts to run the style at z19
* Dashes, not underscores, in layer names
* Avoid restating defaults, e.g. don't add `point-allow-overlap = false`

