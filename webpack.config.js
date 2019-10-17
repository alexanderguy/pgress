var path = require('path');

module.exports = {
    entry: './src/main.ts',
    mode: 'development',
    devtool: 'inline-source-map',
    resolve: {
	extensions: [ '.ts', '.js' ],
    },
    output: {
	path: path.resolve(__dirname, 'dist'),
	filename: 'pgress.js',
	library: 'pgress',
	libraryTarget: 'umd'
    },
    externals: {
	'md5.js': {
	    commonjs: 'md5.js',
	    commonjs2: 'md5.js',
	    amd: 'md5.js',
	}
    }
};
