import type { PdxAssignment, PdxAtom, PdxBlock } from '../types'

interface Token {
  kind: 'word' | 'string' | 'lbrace' | 'rbrace' | 'equals'
  value: string
  start: number
  end: number
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '#') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (char === '"') {
      const start = index
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2
          continue
        }
        if (source[index] === '"') {
          index += 1
          break
        }
        index += 1
      }
      tokens.push({ kind: 'string', value: source.slice(start + 1, index - 1), start, end: index })
      continue
    }
    const symbols: Record<string, Token['kind']> = { '{': 'lbrace', '}': 'rbrace', '=': 'equals' }
    if (symbols[char]) {
      tokens.push({ kind: symbols[char], value: char, start: index, end: index + 1 })
      index += 1
      continue
    }
    const start = index
    while (index < source.length && !/[\s{}=#"]/u.test(source[index])) index += 1
    tokens.push({ kind: 'word', value: source.slice(start, index), start, end: index })
  }
  return tokens
}

export function parsePdx(source: string): PdxBlock {
  const tokens = tokenize(source)
  let cursor = 0

  const parseBlock = (isRoot = false): PdxBlock => {
    const open = isRoot ? { start: 0, end: 0 } : tokens[cursor - 1]
    const items: PdxBlock['items'] = []
    let closeStart = source.length
    while (cursor < tokens.length) {
      const token = tokens[cursor]
      if (token.kind === 'rbrace') {
        closeStart = token.start
        cursor += 1
        break
      }
      const next = tokens[cursor + 1]
      if ((token.kind === 'word' || token.kind === 'string') && next?.kind === 'equals') {
        const keyToken = token
        cursor += 2
        const valueToken = tokens[cursor]
        if (!valueToken) break
        let value: PdxAtom | PdxBlock
        if (valueToken.kind === 'lbrace') {
          cursor += 1
          value = parseBlock(false)
        } else {
          cursor += 1
          value = { kind: 'atom', value: valueToken.value, start: valueToken.start, end: valueToken.end }
        }
        items.push({
          kind: 'assignment',
          key: keyToken.value,
          keyStart: keyToken.start,
          start: keyToken.start,
          end: value.end,
          value,
        })
        continue
      }
      if (token.kind === 'lbrace') {
        cursor += 1
        items.push(parseBlock(false) as unknown as PdxAtom)
        continue
      }
      if (token.kind === 'word' || token.kind === 'string') {
        items.push({ kind: 'atom', value: token.value, start: token.start, end: token.end })
      }
      cursor += 1
    }
    return {
      kind: 'block',
      start: open.start,
      end: isRoot ? source.length : (tokens[cursor - 1]?.end ?? source.length),
      openStart: open.start,
      closeStart,
      items,
    }
  }

  return parseBlock(true)
}

export function assignments(block: PdxBlock, key?: string): PdxAssignment[] {
  return block.items.filter((item): item is PdxAssignment =>
    item.kind === 'assignment' && (key === undefined || item.key === key),
  )
}

export function firstAssignment(block: PdxBlock, key: string): PdxAssignment | undefined {
  return assignments(block, key)[0]
}

export function atomValue(block: PdxBlock, key: string): string | undefined {
  const item = firstAssignment(block, key)
  return item?.value.kind === 'atom' ? item.value.value : undefined
}

export function blockValue(block: PdxBlock, key: string): PdxBlock | undefined {
  const item = firstAssignment(block, key)
  return item?.value.kind === 'block' ? item.value : undefined
}

export function blockAtoms(block?: PdxBlock): string[] {
  if (!block) return []
  return block.items.filter((item): item is PdxAtom => item.kind === 'atom').map((item) => item.value)
}

export interface Replacement {
  start: number
  end: number
  text: string
}

export function applyReplacements(source: string, replacements: Replacement[]): string {
  const sorted = replacements.toSorted((a, b) => b.start - a.start)
  let result = source
  let previousStart = source.length + 1
  for (const replacement of sorted) {
    if (replacement.end > previousStart) throw new Error('Overlapping source replacements')
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end)
    previousStart = replacement.start
  }
  return result
}

export function replaceAssignmentValue(
  assignment: PdxAssignment | undefined,
  value: string,
): Replacement | undefined {
  if (!assignment) return undefined
  return { start: assignment.value.start, end: assignment.value.end, text: value }
}

export function renderNumericBlock(values: Iterable<number>, indent = '\t'): string {
  const list = [...values]
  const lines: string[] = []
  for (let index = 0; index < list.length; index += 16) {
    lines.push(`${indent}${list.slice(index, index + 16).join(' ')}`)
  }
  return `{\n${lines.join('\n')}\n${indent.slice(0, Math.max(0, indent.length - 1))}}`
}
