interface InventoryOverlayProps {
  onClose: () => void
}

export default function InventoryOverlay({ onClose }: InventoryOverlayProps) {
  return (
    <section
      className="inventory-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Inventario"
    >
      <button
        type="button"
        className="inventory-overlay-backdrop"
        aria-label="Cerrar inventario"
        onClick={onClose}
      />
      <div className="inventory-overlay-shell">
        <section className="inventory-overlay-panel" aria-label="Contenido del inventario" />
        <button
          type="button"
          className="inventory-overlay-close"
          aria-label="Cerrar inventario"
          title="Cerrar inventario"
          onClick={onClose}
          autoFocus
        >
          X
        </button>
      </div>
    </section>
  )
}
