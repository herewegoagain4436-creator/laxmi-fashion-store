import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { X } from 'lucide-react'

type Props = {
  open: boolean
  onClose: () => void
  onDetect: (code: string) => void
}

export function CameraBarcodeScanner({ open, onClose, onDetect }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState('')
  const controlsRef = useRef<IScannerControls | null>(null)
  const lastRef = useRef({ code: '', at: 0 })
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setErr('')
    const reader = new BrowserMultiFormatReader()

    async function start() {
      try {
        if (!videoRef.current) return
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result, _error, controls) => {
            controlsRef.current = controls
            if (!result || cancelled) return
            const text = result.getText()?.trim()
            if (!text) return
            const now = Date.now()
            if (text === lastRef.current.code && now - lastRef.current.at < 1500) return
            lastRef.current = { code: text, at: now }
            onDetectRef.current(text)
          },
        )
        if (!cancelled) controlsRef.current = controls
      } catch (e) {
        if (!cancelled) {
          setErr(
            e instanceof Error
              ? e.message
              : 'Camera unavailable. Allow camera permission or use a USB scanner.',
          )
        }
      }
    }

    void start()
    return () => {
      cancelled = true
      try {
        controlsRef.current?.stop()
      } catch {
        /* ignore */
      }
      controlsRef.current = null
    }
  }, [open])

  if (!open) return null

  return (
    <div className="lf-modal-backdrop z-[80]">
      <div className="lf-modal max-w-lg overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-brand-100 px-4 py-3">
          <h2 className="text-lg font-bold text-brand-800">Scan barcode</h2>
          <button type="button" className="lf-btn-ghost min-h-[44px] min-w-[44px] p-2" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="relative aspect-[3/4] max-h-[70vh] bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-[70%] rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        </div>
        {err ? (
          <p className="px-4 py-3 text-sm text-red-600">{err}</p>
        ) : (
          <p className="px-4 py-3 text-sm text-slate-600">
            Point the camera at the tag barcode (Code128 / EAN / QR).
          </p>
        )}
        <div className="p-4 pt-0">
          <button type="button" className="lf-btn-secondary min-h-[48px] w-full" onClick={onClose}>
            Close scanner
          </button>
        </div>
      </div>
    </div>
  )
}
