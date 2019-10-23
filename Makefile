WEBPACK = ./node_modules/.bin/webpack-cli

all: webpack

webpack: node_modules
	$(WEBPACK)

watch: node_modules
	$(WEBPACK) --watch

node_modules:
	npm install

clean:
	$(RM) dist/pgress.js

distclean: clean
	$(RM) -r node_modules
