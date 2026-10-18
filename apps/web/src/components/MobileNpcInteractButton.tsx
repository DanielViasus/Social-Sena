interface MobileNpcInteractButtonProps {
  onInteract: () => void
}

export default function MobileNpcInteractButton({ onInteract }: MobileNpcInteractButtonProps) {
  return (
    <button
      type="button"
      className="mobile-npc-interact-button"
      onClick={onInteract}
      aria-label="Interactuar"
    >
      <span aria-hidden="true">E</span>
    </button>
  )
}
