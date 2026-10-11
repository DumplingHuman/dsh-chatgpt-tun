/**
 * Cross-version icon resolver for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * DSH 0.1.x named icons by glyph + drawn size (`IconCodeOutline16`), while DSH
 * 0.2.x moved the size into a `size` prop and renamed the suffix into a weight
 * variant (`IconCodeOutlineRegular`, `...Medium`, plus a bare alias). Importing
 * a name the running host does not export yields `undefined`, which React
 * renders as the invalid-element-type error (#130).
 *
 * Resolving at runtime keeps one build working on both host generations. The
 * declared props are compatible: callers pass `size`/`className` either way.
 */
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentType } from 'react'

export interface CompatIconProps {
  size?: number | undefined
  className?: string | undefined
}

type IconComponent = ComponentType<CompatIconProps>

const exports_ = primitives as unknown as Record<string, unknown>

function resolveIcon(...names: readonly string[]): IconComponent {
  for (const name of names) {
    const candidate = exports_[name]
    if (typeof candidate === 'function' || (typeof candidate === 'object' && candidate !== null)) {
      return candidate as IconComponent
    }
  }
  // Never let a missing glyph crash the whole panel.
  return (() => null) as unknown as IconComponent
}

/** Newest name first, legacy fallback last. */
export const IconChevronDown = resolveIcon('IconChevronDownOutlineRegular', 'IconChevronDownOutline', 'IconChevronDownOutline14')
export const IconChevronRight = resolveIcon('IconChevronRightOutlineRegular', 'IconChevronRightOutline', 'IconChevronRightOutline14')
export const IconChevronUp = resolveIcon('IconChevronUpOutlineRegular', 'IconChevronUpOutline', 'IconChevronUpOutline14')
export const IconCode = resolveIcon('IconCodeOutlineRegular', 'IconCodeOutline', 'IconCodeOutline16')
export const IconWarning = resolveIcon('IconWarningOutlineRegular', 'IconWarningOutline', 'IconWarningOutline16')
