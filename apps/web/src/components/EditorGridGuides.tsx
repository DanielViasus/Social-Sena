import type { Ref } from 'react'

interface EditorGridGuidesProps {
  columns: number
  rows: number
  zoom: number
  columnRef?: Ref<HTMLDivElement>
  rowRef?: Ref<HTMLDivElement>
}

export default function EditorGridGuides({ columns, rows, zoom, columnRef, rowRef }: EditorGridGuidesProps) {
  return (
    <>
      <div ref={columnRef} className="edit-room-column-guides" style={{ gridTemplateColumns: `repeat(${columns}, ${128 * zoom}px)` }} aria-hidden="true">
        {Array.from({ length: columns }, (_, index) => <span key={index}>{index + 1}</span>)}
      </div>
      <div ref={rowRef} className="edit-room-row-guides" style={{ gridTemplateRows: `repeat(${rows}, ${128 * zoom}px)` }} aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => <span key={index}>{index + 1}</span>)}
      </div>
    </>
  )
}
