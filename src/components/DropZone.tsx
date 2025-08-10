import React, { useEffect, useRef } from 'react'

type Props = {
  onFile: React.ChangeEventHandler<HTMLInputElement>
  asWordmark?: boolean
  children?: React.ReactNode
  hasMedia?: boolean
}

export default function DropZone({ onFile, asWordmark, children, hasMedia }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const block = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (!f || !inputRef.current) return
    const dt = new DataTransfer()
    dt.items.add(f)
    inputRef.current.files = dt.files
    const ev = { target: inputRef.current } as any
    onFile(ev)
  }
  const onDrag: React.DragEventHandler<HTMLDivElement> = (e) => e.preventDefault()

  if (asWordmark) {
    return (
      <div onDrop={onDrop} onDragOver={onDrag} className="rounded-lg border-2 border-dashed border-slate-500/[0.375] bg-transparent px-4 py-1.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">{children}</div>
          <label className={`cursor-pointer select-none text-sm font-medium tracking-wide`}>
            <span className="text-slate-500">[</span>
            <span className={`${hasMedia ? 'text-white' : 'animate-rainbow-text-fast bg-clip-text text-transparent bg-gradient-to-r from-red-400 via-yellow-300 to-blue-400'}`}> Browse </span>
            <span className="text-slate-500">]</span>
            <input ref={inputRef} type="file" accept="audio/*" onChange={onFile} className="hidden" />
          </label>
        </div>
      </div>
    )
  }

  return (
    <div onDrop={onDrop} onDragOver={onDrag} className="mt-3 rounded-lg border-2 border-dashed border-slate-500/[0.375] bg-transparent py-[3px] px-2 text-xs text-slate-300/90">
      <div className="flex items-center justify-between">
        <div>Drop an audio file here to load</div>
        <label className={`cursor-pointer select-none text-xs`}>
          <span className="text-slate-400">[</span>
          <span className={`${hasMedia ? 'text-white' : 'animate-rainbow-text-fast bg-clip-text text-transparent bg-gradient-to-r from-red-400 via-yellow-300 to-blue-400'}`}> Browse </span>
          <span className="text-slate-400">]</span>
          <input ref={inputRef} type="file" accept="audio/*" onChange={onFile} className="hidden" />
        </label>
      </div>
    </div>
  )
}


