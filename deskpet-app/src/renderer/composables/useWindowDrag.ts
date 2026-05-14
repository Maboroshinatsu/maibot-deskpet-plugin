export function useWindowDrag() {
  function onNavMouseDown(e: MouseEvent) {
    let lastX = e.screenX
    let lastY = e.screenY
    let moved = false

    const onMove = (ev: MouseEvent) => {
      const dx = ev.screenX - lastX
      const dy = ev.screenY - lastY
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      moved = true
      window.electronAPI?.dragWindow(dx, dy)
      lastX = ev.screenX
      lastY = ev.screenY
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return { onNavMouseDown }
}
