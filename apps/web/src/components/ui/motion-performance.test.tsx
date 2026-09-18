import { isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { Button } from './button'
import { SheetContent, SheetOverlay } from './sheet'

type ClassProps = { className?: string; children?: unknown; 'data-slot'?: string }

it('keeps button transitions on compositor-friendly visual properties', () => {
  const html = renderToStaticMarkup(<Button>Connect Google</Button>)
  expect(html).not.toContain('transition-all')
  expect(html).toContain('transition-[color,background-color,border-color,box-shadow,transform,opacity]')
})

it('avoids full-screen backdrop filtering in the composed sheet overlay', () => {
  const overlay = SheetOverlay({})
  expect(overlay.props.className).not.toContain('backdrop-blur')
  expect(overlay.props.className).toContain('transition-opacity')
})

it('limits the composed sheet panel motion to transform and opacity', () => {
  const portal = SheetContent({ children: 'Calendars' })
  const children: unknown[] = Array.isArray(portal.props.children) ? portal.props.children : [portal.props.children]
  const panel = children.find((child): child is ReactElement<ClassProps> =>
    isValidElement<ClassProps>(child) && child.props['data-slot'] === 'sheet-content')
  expect(panel?.props.className).not.toContain(' transition ')
  expect(panel?.props.className).not.toContain('transition-all')
  expect(panel?.props.className).toContain('transition-[transform,opacity]')
  expect(panel?.props.className).toContain('will-change-[transform,opacity]')
  expect(panel?.props.className).toContain('overflow-y-auto')
})
