const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const ROOT = __dirname
const BUILD = path.join(ROOT, '.build')
const DIST = path.join(ROOT, 'dist')
fs.rmSync(BUILD, { recursive: true, force: true })
cp.execFileSync('tsc', ['-p', path.join(ROOT, 'tsconfig.app.json')], { stdio: 'inherit' })

const modules = new Map()
const aliases = new Map()
function locate(spec, parent) {
  if (spec.endsWith('.css')) return null
  if (spec.startsWith('.')) {
    let file = path.resolve(path.dirname(parent), spec)
    for (const candidate of [file, file + '.js', path.join(file, 'index.js')]) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return require.resolve(spec, { paths: [path.dirname(parent), '/mnt/runtime-envs/oai56-py312/node/node_modules'] })
}
function moduleId(file) {
  if (file.startsWith(BUILD)) return 'app/' + path.relative(BUILD, file).replaceAll('\\', '/')
  const marker = '/node_modules/'
  const pos = file.lastIndexOf(marker)
  return pos >= 0 ? 'vendor/' + file.slice(pos + marker.length).replaceAll('\\', '/') : 'vendor/' + path.basename(file)
}
function add(file) {
  const id = moduleId(file)
  if (modules.has(id)) return id
  let source = fs.readFileSync(file, 'utf8')
  modules.set(id, '')
  source = source.replace(/require\((['"])([^'"]+)\1\)/g, (all, quote, spec) => {
    const resolved = locate(spec, file)
    if (!resolved) return '{}'
    const target = add(resolved)
    return `require(${JSON.stringify(target)})`
  })
  modules.set(id, source)
  return id
}
const entry = add(path.join(BUILD, 'main.js'))
const body = [...modules.entries()].map(([id, source]) => `${JSON.stringify(id)}:function(module,exports,require){\n${source}\n}`).join(',\n')
const bundle = `(()=>{var process={env:{NODE_ENV:'production'}};var modules={${body}},cache={};function require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('Module not found: '+id);var module=cache[id]={exports:{}};modules[id](module,module.exports,require);return module.exports}require(${JSON.stringify(entry)});})();`
fs.rmSync(DIST, { recursive: true, force: true })
fs.mkdirSync(DIST, { recursive: true })
fs.writeFileSync(path.join(DIST, 'bundle.js'), bundle)
fs.copyFileSync(path.join(ROOT, 'src', 'styles.css'), path.join(DIST, 'styles.css'))
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
html = html.replace('<script type="module" src="/src/main.tsx"></script>', '<script defer src="/bundle.js"></script>')
html = html.replace('</head>', '  <link rel="stylesheet" href="/styles.css">\n  </head>')
fs.writeFileSync(path.join(DIST, 'index.html'), html)
fs.rmSync(BUILD, { recursive: true, force: true })
console.log(`Built ${modules.size} modules → dist/bundle.js (${Math.round(bundle.length/1024)} KB)`)
