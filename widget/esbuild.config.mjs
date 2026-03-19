import { build, context } from 'esbuild'

const isWatch = process.argv.includes('--watch')

const buildOptions = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: !isWatch,
  format: 'iife',
  target: 'es2020',
  outfile: 'dist/widget.js',
  external: [],
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"'
  },
}

if (isWatch) {
  const ctx = await context(buildOptions)
  await ctx.watch()
  console.log('Watching for changes...')
} else {
  await build(buildOptions)
  console.log('Build complete: dist/widget.js')
}
