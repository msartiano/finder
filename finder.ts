// License: MIT
// Author: Anton Medvedev <anton@medv.io>
// Source: https://github.com/antonmedv/finder

type Knot = {
  name: string
  penalty: number
  level?: number
}

type Path = Knot[]

export type Options = {
  root: Element
  idName: (name: string) => boolean
  className: (name: string) => boolean
  tagName: (name: string) => boolean
  attr: (name: string, value: string) => boolean
  seedMinLength: number
  optimizedMinLength: number
  threshold: number
  maxNumberOfTries: number
}

let finder__config: Options
let finder__rootDocument: Document | Element

function _finder__finder(input: Element, options?: Partial<Options>) {
  if (input.nodeType !== Node.ELEMENT_NODE) {
    throw new Error(`Can't generate CSS selector for non-element node type.`)
  }
  if ('html' === input.tagName.toLowerCase()) {
    return 'html'
  }
  const defaults: Options = {
    root: document.body,
    idName: (name: string) => true,
    className: (name: string) => true,
    tagName: (name: string) => true,
    attr: (name: string, value: string) => false,
    seedMinLength: 1,
    optimizedMinLength: 2,
    threshold: 1000,
    maxNumberOfTries: 10000,
  }

  finder__config = {...defaults, ...options}
  finder__rootDocument = finder__findRootDocument(finder__config.root, defaults)

  let path =
    finder__bottomUpSearch(input, 'all',
      () => finder__bottomUpSearch(input, 'two',
        () => finder__bottomUpSearch(input, 'one',
          () => finder__bottomUpSearch(input, 'none'))))

  if (path) {
    const optimized = finder__sort(finder__optimize(path, input))
    if (optimized.length > 0) {
      path = optimized[0]
    }
    return finder__selector(path)
  } else {
    throw new Error(`Selector was not found.`)
  }
}

function finder__findRootDocument(rootNode: Element | Document, defaults: Options) {
  if (rootNode.nodeType === Node.DOCUMENT_NODE) {
    return rootNode
  }
  if (rootNode === defaults.root) {
    return rootNode.ownerDocument as Document
  }
  return rootNode
}

function finder__bottomUpSearch(
  input: Element,
  limit: 'all' | 'two' | 'one' | 'none',
  fallback?: () => Path | null
): Path | null {
  let path: Path | null = null
  let stack: Knot[][] = []
  let current: Element | null = input
  let i = 0
  while (current) {
    let level: Knot[] = finder__maybe(finder__id(current)) ||
      finder__maybe(...finder__attr(current)) ||
      finder__maybe(...finder__classNames(current)) ||
      finder__maybe(finder__tagName(current)) || [finder__any()]
    const nth = finder__index(current)
    if (limit == 'all') {
      if (nth) {
        level = level.concat(
          level.filter(finder__dispensableNth).map((node) => finder__nthChild(node, nth))
        )
      }
    } else if (limit == 'two') {
      level = level.slice(0, 1)
      if (nth) {
        level = level.concat(
          level.filter(finder__dispensableNth).map((node) => finder__nthChild(node, nth))
        )
      }
    } else if (limit == 'one') {
      const [node] = (level = level.slice(0, 1))
      if (nth && finder__dispensableNth(node)) {
        level = [finder__nthChild(node, nth)]
      }
    } else if (limit == 'none') {
      level = [finder__any()]
      if (nth) {
        level = [finder__nthChild(level[0], nth)]
      }
    }
    for (let node of level) {
      node.level = i
    }
    stack.push(level)
    if (stack.length >= finder__config.seedMinLength) {
      path = finder__findUniquePath(stack, fallback)
      if (path) {
        break
      }
    }
    current = current.parentElement
    i++
  }
  if (!path) {
    path = finder__findUniquePath(stack, fallback)
  }
  if (!path && fallback) {
    return fallback()
  }
  return path
}

function finder__findUniquePath(
  stack: Knot[][],
  fallback?: () => Path | null
): Path | null {
  const paths = finder__sort(finder__combinations(stack))
  if (paths.length > finder__config.threshold) {
    return fallback ? fallback() : null
  }
  for (let candidate of paths) {
    if (finder__unique(candidate)) {
      return candidate
    }
  }
  return null
}

function finder__selector(path: Path): string {
  let node = path[0]
  let query = node.name
  for (let i = 1; i < path.length; i++) {
    const level = path[i].level || 0
    if (node.level === level - 1) {
      query = `${path[i].name} > ${query}`
    } else {
      query = `${path[i].name} ${query}`
    }
    node = path[i]
  }
  return query
}

function finder__penalty(path: Path): number {
  return path.map((node) => node.penalty).reduce((acc, i) => acc + i, 0)
}

function finder__unique(path: Path) {
  const css = finder__selector(path)
  switch (finder__rootDocument.querySelectorAll(css).length) {
    case 0:
      throw new Error(
        `Can't select any node with this selector: ${css}`
      )
    case 1:
      return true
    default:
      return false
  }
}

function finder__id(input: Element): Knot | null {
  const elementId = input.getAttribute('id')
  if (elementId && finder__config.idName(elementId)) {
    return {
      name: '#' + CSS.escape(elementId),
      penalty: 0,
    }
  }
  return null
}

function finder__attr(input: Element): Knot[] {
  const attrs = Array.from(input.attributes).filter((attr) =>
    finder__config.attr(attr.name, attr.value)
  )
  return attrs.map(
    (attr): Knot => ({
      name: `[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`,
      penalty: 0.5,
    })
  )
}

function finder__classNames(input: Element): Knot[] {
  const names = Array.from(input.classList).filter(finder__config.className)
  return names.map(
    (name): Knot => ({
      name: '.' + CSS.escape(name),
      penalty: 1,
    })
  )
}

function finder__tagName(input: Element): Knot | null {
  const name = input.tagName.toLowerCase()
  if (finder__config.tagName(name)) {
    return {
      name,
      penalty: 2,
    }
  }
  return null
}

function finder__any(): Knot {
  return {
    name: '*',
    penalty: 3,
  }
}

function finder__index(input: Element): number | null {
  const parent = input.parentNode
  if (!parent) {
    return null
  }
  let child = parent.firstChild
  if (!child) {
    return null
  }
  let i = 0
  while (child) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      i++
    }
    if (child === input) {
      break
    }
    child = child.nextSibling
  }
  return i
}

function finder__nthChild(node: Knot, i: number): Knot {
  return {
    name: node.name + `:nth-child(${i})`,
    penalty: node.penalty + 1,
  }
}

function finder__dispensableNth(node: Knot) {
  return node.name !== 'html' && !node.name.startsWith('#')
}

function finder__maybe(...level: (Knot | null)[]): Knot[] | null {
  const list = level.filter(finder__notEmpty)
  if (list.length > 0) {
    return list
  }
  return null
}

function finder__notEmpty<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

function* finder__combinations(stack: Knot[][], path: Knot[] = []): Generator<Knot[]> {
  if (stack.length > 0) {
    for (let node of stack[0]) {
      yield* finder__combinations(stack.slice(1, stack.length), path.concat(node))
    }
  } else {
    yield path
  }
}

function finder__sort(paths: Iterable<Path>): Path[] {
  return [...paths].sort((a, b) => finder__penalty(a) - finder__penalty(b))
}

type Scope = {
  counter: number
  visited: Map<string, boolean>
}

function* finder__optimize(
  path: Path,
  input: Element,
  scope: Scope = {
    counter: 0,
    visited: new Map<string, boolean>(),
  }
): Generator<Knot[]> {
  if (path.length > 2 && path.length > finder__config.optimizedMinLength) {
    for (let i = 1; i < path.length - 1; i++) {
      if (scope.counter > finder__config.maxNumberOfTries) {
        return // Okay At least I tried!
      }
      scope.counter += 1
      const newPath = [...path]
      newPath.splice(i, 1)
      const newPathKey = finder__selector(newPath)
      if (scope.visited.has(newPathKey)) {
        return
      }
      if (finder__unique(newPath) && finder__same(newPath, input)) {
        yield newPath
        scope.visited.set(newPathKey, true)
        yield* finder__optimize(newPath, input, scope)
      }
    }
  }
}

function finder__same(path: Path, input: Element) {
  return finder__rootDocument.querySelector(finder__selector(path)) === input
}
