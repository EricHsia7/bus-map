#! /bin/bash
./make_mapnik.sh
mkdir -p test
for Z in `seq 20 -1 5`
do
  echo "zoom $Z"
  time nik4 -z $Z -c 2.35 48.85 -x 1600 900 osmfr.mapnik test/test-z$Z.png
done
