import { useState } from 'react'
import type { PlayerInventory } from '@social-sena/shared'
import { LayeredAvatar } from '../world/LayeredAvatar'
import { avatarAnimations, chapFrontEquipment, type AnimationPart } from '../../game/avatar/layeredAvatar'

interface InventoryOverlayProps {
  inventory: PlayerInventory
  coinItemId: string
  displayName: string
  onClose: () => void
}

type InventoryTab = 'inventory' | 'equipment'

const TABS: { id: InventoryTab; label: string }[] = [
  { id: 'inventory', label: 'Inventario' },
  { id: 'equipment', label: 'Equipamiento' },
]

const INVENTORY_COLUMNS = 10
const INVENTORY_ROWS = 4
const INVENTORY_SLOT_COUNT = INVENTORY_COLUMNS * INVENTORY_ROWS

// Equipment slots. `part` ties a slot to the skin part it will customize once equipment is wired.
interface EquipmentSlot {
  id: string
  label: string
  part?: AnimationPart
}

const LEFT_SLOTS: EquipmentSlot[] = [
  { id: 'head', label: 'Cabeza', part: 'cabeza' },
  { id: 'body', label: 'Cuerpo', part: 'cuerpo' },
  { id: 'left-hand', label: 'Mano izq.', part: 'manoIzquierda' },
  { id: 'left-leg', label: 'Pierna izq.', part: 'piernaIzquierda' },
]

const RIGHT_SLOTS: EquipmentSlot[] = [
  { id: 'accessory', label: 'Accesorio', part: 'accesorios' },
  { id: 'weapon', label: 'Arma' },
  { id: 'right-hand', label: 'Mano der.', part: 'manoDerecha' },
  { id: 'right-leg', label: 'Pierna der.', part: 'piernaDerecha' },
]

function EquipmentSlotButton({ slot }: { slot: EquipmentSlot }) {
  return (
    <button
      type="button"
      className="inventory-slot inventory-equipment-slot"
      data-part={slot.part}
      aria-label={`${slot.label}: vacío`}
      title={slot.label}
    >
      <span className="inventory-slot-label">{slot.label}</span>
    </button>
  )
}

export default function InventoryOverlay({ inventory, coinItemId, displayName, onClose }: InventoryOverlayProps) {
  const [tab, setTab] = useState<InventoryTab>('inventory')
  const coins = inventory[coinItemId]?.quantity ?? 0
  // Items fill the grid in order; the coin item is shown in the equipment tab instead.
  const items = Object.entries(inventory)
    .filter(([itemId, state]) => itemId !== coinItemId && state.quantity > 0)
    .slice(0, INVENTORY_SLOT_COUNT)

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
        <section className="inventory-overlay-panel inventory-overlay-layout" aria-label="Contenido del inventario">
          <div className="inventory-tabs" role="tablist" aria-label="Secciones">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`inventory-tab-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls={`inventory-panel-${item.id}`}
                className={`inventory-tab ${tab === item.id ? 'is-active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="inventory-tab-content" role="tabpanel" id={`inventory-panel-${tab}`} aria-labelledby={`inventory-tab-${tab}`}>
            {tab === 'inventory' ? (
              <div className="inventory-grid" style={{ gridTemplateColumns: `repeat(${INVENTORY_COLUMNS}, minmax(0, 1fr))` }}>
                {Array.from({ length: INVENTORY_SLOT_COUNT }, (_, index) => {
                  const entry = items[index]
                  return entry ? (
                    <button key={entry[0]} type="button" className="inventory-slot is-filled" title={entry[0]}>
                      <span className="inventory-slot-label">{entry[0]}</span>
                      <span className="inventory-slot-quantity">{entry[1].quantity}</span>
                    </button>
                  ) : (
                    <div key={`empty-${index}`} className="inventory-slot" aria-hidden="true" />
                  )
                })}
              </div>
            ) : (
              <div className="inventory-equipment">
                <div className="inventory-equipment-column">
                  {LEFT_SLOTS.map((slot) => <EquipmentSlotButton key={slot.id} slot={slot} />)}
                </div>
                <div className="inventory-equipment-preview">
                  <div className="inventory-equipment-avatar" aria-hidden="true">
                    <LayeredAvatar
                      view="f"
                      flipX={false}
                      equipment={chapFrontEquipment}
                      animationName="idle"
                      animation={avatarAnimations.idle}
                      displayName={displayName}
                    />
                  </div>
                  <output className="inventory-equipment-coins" aria-label="Monedas">{coins.toLocaleString('es-CO')} monedas</output>
                </div>
                <div className="inventory-equipment-column">
                  {RIGHT_SLOTS.map((slot) => <EquipmentSlotButton key={slot.id} slot={slot} />)}
                </div>
              </div>
            )}
          </div>
        </section>
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
