import { useDeskpetStore } from '@/stores/deskpet'
import { resizeModel } from '@/services/live2d/loader'

export function useModelZoom(
  store: ReturnType<typeof useDeskpetStore>,
  getMousePos: () => { x: number; y: number },
  getWindowBounds: () => { width: number; height: number },
  onZoomChanged: (zoom: number) => void,
) {
  let lastWheelTime = 0

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    if (!store.live2dModel) return
    const now = performance.now()
    if (now - lastWheelTime < 50) return
    lastWheelTime = now
    const factor = e.deltaY > 0 ? 0.92 : 1.08
    const newZoom = Math.max(0.15, Math.min(20.0, store.modelZoom * factor))
    const pos = getMousePos()
    const { width, height } = getWindowBounds()
    resizeModel(store.live2dModel, width, height, newZoom, pos.x, pos.y)
    store.modelZoom = newZoom
    store.setModelOffset(store.live2dModel.position.x - width / 2, store.live2dModel.position.y - height / 2)
    onZoomChanged(newZoom)
  }

  return { onWheel }
}
