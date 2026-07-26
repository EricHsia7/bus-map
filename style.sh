# prepare styles
cat ./style/*.mss > style.mss
# node compile-carto.js style.mss --dark > style.json
node compile-carto.js style.mss > style.json