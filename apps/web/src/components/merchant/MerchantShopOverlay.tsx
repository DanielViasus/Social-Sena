import type { RoomMerchantConfig } from '@social-sena/shared'

interface MerchantShopOverlayProps {
  merchantName: string
  merchant: RoomMerchantConfig
  onClose: () => void
}

export default function MerchantShopOverlay({ merchantName, merchant, onClose }: MerchantShopOverlayProps) {
  return (
    <section
      className="merchant-shop-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Tienda de ${merchantName}`}
      data-merchant-type={merchant.type}
      data-merchant-categories={merchant.categories.join(',')}
    >
      <div className="merchant-shop-backdrop" aria-hidden="true" />
      <div className="merchant-shop-shell">
        <section className="merchant-shop-container" aria-label="Contenido de la tienda" />
        <button
          type="button"
          className="merchant-shop-close-button"
          aria-label="Salir de la tienda"
          title="Salir de la tienda"
          onClick={onClose}
        >
          X
        </button>
      </div>
    </section>
  )
}
