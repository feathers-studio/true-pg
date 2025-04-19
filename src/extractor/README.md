# pg-extract

The basis for this part of the package is the [`pg-extract`](https://github.com/feathers-studio/pg-extract) package.

`pg-extract` was a short-lived package that was forked from the upstream `extract-pg-types` package to be used with `true-pg`, but since it only existed for this one purpose, we've simplified it to exactly what we needed and internalised it here, deprecating `pg-extract`.

Though large parts of it have been rewritten, since we adapted from `extract-pg-types`, the LICENSE of the original package is included [here](./LICENSE).
