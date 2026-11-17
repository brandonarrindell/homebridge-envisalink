# Vendored NodeAlarmProxy

These files are an unmodified copy of NodeAlarmProxy at
[dustindclark/NodeAlarmProxy@0abdfe6](https://github.com/dustindclark/NodeAlarmProxy/tree/0abdfe688451cc57b0bbd64cf54e38e54a2d2a67),
the exact commit this plugin previously installed as a GitHub tarball dependency.

They ship inside the plugin because npm 12 refuses to fetch remote (tarball URL)
dependencies of installed packages by default, and the `nodealarmproxy` package
on the npm registry is a different, older implementation.

- `nodealarmproxy.js`: TPI connection and event handling
- `envisalink.js`: command and status code definitions
- `LICENSE.md`: the upstream MIT license, which still applies to these files

The library's only third-party dependency, `winston`, is declared in the
plugin's own `package.json`.
