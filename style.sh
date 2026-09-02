# prepare styles
cat ./style/*.less > style.less
# node compile-carto.js style.less --dark > style.json
node compile-carto.js style.less > style.json