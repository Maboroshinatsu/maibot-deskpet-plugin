export function useModelDrag() {
  let dragOffsetX = 0
  let dragOffsetY = 0
  let dragActive = false
  let dragStartX = 0
  let dragStartY = 0
  let dragMoved = false

  function onModelMouseDown(e: MouseEvent) {
    dragStartX = e.clientX
    dragStartY = e.clientY
    dragMoved = false
    dragActive = true

    const onMove = (ev: MouseEvent) => {
      if (!dragActive) return
      const dx = ev.clientX - dragStartX
      const dy = ev.clientY - dragStartY
      if (!dragMoved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      dragMoved = true
      dragOffsetX += dx
      dragOffsetY += dy
      dragStartX = ev.clientX
      dragStartY = ev.clientY
    }

    const onUp = () => {
      dragActive = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function consumeDragOffsets(): { x: number; y: number } | null {
    if (dragOffsetX === 0 && dragOffsetY === 0) return null
    const offsets = { x: dragOffsetX, y: dragOffsetY }
    dragOffsetX = 0
    dragOffsetY = 0
    return offsets
  }

  return { onModelMouseDown, consumeDragOffsets }
}
