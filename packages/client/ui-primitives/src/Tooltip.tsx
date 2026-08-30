// Cloning the anchor preserves its layout context. Fixed positioning lets the
// bubble escape ancestor overflow clipping without a portal.
//
// Trigger model: hover arms the delay timer on the pointer MOVE that enters
// the anchor, never on mouseenter alone — an element that appears under a
// parked cursor (a panel toggling open/closed at fixed coordinates) receives
// a synthetic mouseenter with no movement and must not pop its own bubble. A
// genuine hover's crossing move targets the anchor in the same event batch as
// the enter, so it arms within the same frame. A press cancels any pending
// hover show: a real hand always moves before clicking, so the timer is often
// armed and would otherwise fire mid-press, popping the label exactly when the
// user acts; the next real move re-arms. Focus shows immediately only when it
// is not press-originated: Chromium reports detail === 0 on every focus event
// (mouse clicks included), so a press is detected from the anchor's own
// pointerdown arriving in the same gesture — a click must not flash its own
// label for the duration of the press, while keyboard Tab focus stays
// immediate.

import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEventHandler, MouseEventHandler, MutableRefObject, PointerEventHandler, ReactElement, Ref } from 'react'
import css from './Tooltip.module.css'

/** Bubble placement relative to the anchor. */
export type TooltipSide = 'right' | 'bottom' | 'top'

/** Props Tooltip injects into its anchor child; the child's own handlers are chained ahead of the tooltip's. */
interface AnchorProps {
  ref?: Ref<HTMLElement> | undefined
  onPointerDown?: PointerEventHandler | undefined
  onMouseEnter?: MouseEventHandler | undefined
  onMouseMove?: MouseEventHandler | undefined
  onMouseLeave?: MouseEventHandler | undefined
  onFocus?: FocusEventHandler | undefined
  onBlur?: FocusEventHandler | undefined
}

type TooltipLabel = string | (() => string)

/** A focus landing this long after a pointerdown on the anchor is the press's own focus; anything later is keyboard or programmatic. */
const PRESS_FOCUS_WINDOW_MS = 300

/**
 * Attach a hover/focus tooltip to an anchor element.
 * @param props.label - bubble text, or a resolver evaluated only while the bubble is visible.
 * @param props.side - placement relative to the anchor (default 'right').
 * @param props.delayMs - hover delay in milliseconds, counted from the entering
 * pointer move; non-press focus (keyboard Tab) remains immediate.
 * @param props.disabled - suppress the bubble while true; the anchor renders identically so
 * toggling never remounts it (which would cut its CSS transitions).
 * @param props.maxWidth - bubble width cap in pixels, for labels long enough that the default
 * half-viewport cap would render a slab wider than the surface the anchor sits on.
 * @param props.children - a single anchor element; its own ref (callback or object) is forwarded alongside the tooltip's.
 * @returns the cloned anchor plus a fixed-position bubble while hovered/focused.
 */
export function Tooltip({ label, side = 'right', delayMs = 0, disabled = false, maxWidth, children }: { label: TooltipLabel; side?: TooltipSide; delayMs?: number; disabled?: boolean; maxWidth?: number; children: ReactElement<AnchorProps> }) {
  const anchor = useRef<HTMLElement | null>(null)
  // React 18 keeps the element's ref outside props; forward it so wrapping an
  // anchor in Tooltip never silently severs the owner's ref.
  const childRef = (children as ReactElement<AnchorProps> & { ref?: Ref<HTMLElement> }).ref
  const mergedRef = useCallback((el: HTMLElement | null) => {
    anchor.current = el
    if (typeof childRef === 'function') childRef(el)
    else if (childRef != null) (childRef as MutableRefObject<HTMLElement | null>).current = el
  }, [childRef])
  // The anchor's edges rather than final coordinates: a vertical flip has to
  // re-derive the bubble's own top from the opposite edge.
  const [pos, setPos] = useState<{ x: number; top: number; bottom: number } | null>(null)
  // Where the bubble actually sits, which is the requested side until the
  // viewport refuses it.
  const [placement, setPlacement] = useState<TooltipSide>(side)
  const bubble = useRef<HTMLSpanElement | null>(null)
  const resolvedLabel = pos === null
    ? null
    : typeof label === 'function' ? label() : label
  const y = pos === null
    ? 0
    : placement === 'right'
      ? pos.top + (pos.bottom - pos.top) / 2
      : placement === 'top' ? pos.top - 8 : pos.bottom + 8
  const EDGE_MARGIN = 12
  // Viewport fit: fixed positioning knows nothing about edges, so a centered
  // bubble near the right edge would clip and a long label under an anchor low
  // on the page would run off the bottom. Horizontally the bubble slides back
  // inside; vertically it flips to the opposite side, which is the only move
  // that does not cover the anchor being read. Each measurement resets the base
  // position first, so a shorter label or a larger viewport releases a previous
  // adjustment without another render.
  useLayoutEffect(() => {
    if (pos === null) return
    const fit = () => {
      const el = bubble.current
      /* v8 ignore next -- pos is set only while the bubble is mounted. */
      if (el === null) return
      el.style.left = `${pos.x}px`
      const r = el.getBoundingClientRect()
      let dx = 0
      if (r.right > window.innerWidth - EDGE_MARGIN) dx = window.innerWidth - EDGE_MARGIN - r.right
      if (r.left + dx < EDGE_MARGIN) dx = EDGE_MARGIN - r.left
      el.style.left = `${pos.x + dx}px`
      if (side === 'right') return
      // Flip only into a side that genuinely fits, so an anchor with room on
      // neither side keeps the requested placement instead of oscillating.
      const fitsBelow = pos.bottom + 8 + r.height <= window.innerHeight - EDGE_MARGIN
      const fitsAbove = pos.top - 8 - r.height >= EDGE_MARGIN
      if (placement === 'bottom' && !fitsBelow && fitsAbove) setPlacement('top')
      if (placement === 'top' && !fitsAbove && fitsBelow) setPlacement('bottom')
    }
    fit()
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit) }
  }, [placement, pos, resolvedLabel, side])
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Hover and focus are independent triggers: the bubble hides only after
  // BOTH clear (hovering away from a focused anchor must not drop it).
  const triggers = useRef({ hover: false, focus: false })
  // Arms once per stay: the first move inside starts the delay timer; later
  // moves leave it running.
  const armed = useRef(false)
  // Chromium reports detail === 0 even for mouse-click focus, so the anchor's
  // own pointerdown timestamp is the only reliable press signal.
  const lastPressAt = useRef(0)

  // Disabling mid-hover (e.g. clicking a rail control expands the sidebar)
  // must drop an already-visible bubble: no mouseleave fires.
  const cancelShow = useCallback(() => {
    if (showTimer.current === null) return
    clearTimeout(showTimer.current)
    showTimer.current = null
  }, [])
  useEffect(() => {
    if (disabled) {
      cancelShow()
      triggers.current = { hover: false, focus: false }
      setPos(null)
    }
    return cancelShow
  }, [cancelShow, disabled])

  const show = () => {
    if (disabled) return
    const el = anchor.current
    /* v8 ignore next -- the ref is attached by event time: events fire on the cloned anchor. */
    if (el === null) return
    const r = el.getBoundingClientRect()
    // Every show starts from the requested side; the fit pass flips it only
    // where this anchor's position demands it.
    setPlacement(side)
    setPos({ x: side === 'right' ? r.right + 10 : r.left + r.width / 2, top: r.top, bottom: r.bottom })
  }
  const showAfterHoverDelay = () => {
    cancelShow()
    if (delayMs <= 0) {
      show()
      return
    }
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      show()
    }, delayMs)
  }
  const hide = () => {
    cancelShow()
    if (!triggers.current.hover && !triggers.current.focus) setPos(null)
  }

  return (
    <>
      {cloneElement(children, {
        ref: mergedRef,
        onPointerDown: (e) => {
          children.props.onPointerDown?.(e)
          lastPressAt.current = Date.now()
          // A press is an explicit action; its label popping mid-press or
          // right after release reads as a flash. Cancel the pending show and
          // require a fresh move to re-arm (a bubble already visible from a
          // completed hover stays: the pointer is still on the anchor).
          cancelShow()
          armed.current = false
        },
        onMouseEnter: (e) => { children.props.onMouseEnter?.(e); triggers.current.hover = true; armed.current = false },
        onMouseMove: (e) => {
          children.props.onMouseMove?.(e)
          if (!triggers.current.hover || armed.current) return
          armed.current = true
          showAfterHoverDelay()
        },
        onMouseLeave: (e) => { children.props.onMouseLeave?.(e); triggers.current.hover = false; cancelShow(); setPos(null) },
        onFocus: (e) => {
          children.props.onFocus?.(e)
          // A press-originated focus (pointerdown on this anchor in the same
          // gesture) must not flash the bubble for the duration of the click.
          if (Date.now() - lastPressAt.current <= PRESS_FOCUS_WINDOW_MS) return
          triggers.current.focus = true
          cancelShow()
          show()
        },
        onBlur: (e) => { children.props.onBlur?.(e); triggers.current.focus = false; hide() },
      })}
      {pos !== null && (
        <span
          ref={bubble}
          className={css.bubble}
          data-side={placement}
          style={{ left: pos.x, top: y, ...maxWidth === undefined ? {} : { maxWidth } }}
          role="tooltip"
        >
          {resolvedLabel}
        </span>
      )}
    </>
  )
}
