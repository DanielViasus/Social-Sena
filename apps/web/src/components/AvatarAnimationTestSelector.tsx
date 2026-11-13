import {
  getSelectedRuntimeVariation,
  getRuntimeStatus,
  listRuntimeVariations,
  setSelectedRuntimeVariation,
  useAvatarAnimationRuntimeVersion,
} from '../game/avatar/avatarAnimationRuntime'

// Local-only switch to try a published variation (Fly, Fight...) without changing it for anyone else.
export function AvatarAnimationTestSelector() {
  useAvatarAnimationRuntimeVersion()
  const variations = listRuntimeVariations()
  return (
    <label className="avatar-animation-test-selector">
      <span>Variación de animación</span>
      <small>{getRuntimeStatus()}</small>
      {variations.length > 0 && <select value={getSelectedRuntimeVariation()} onChange={(event) => setSelectedRuntimeVariation(event.target.value)}>
        {variations.map((variation) => (
          <option key={variation.id} value={variation.id}>{variation.name}</option>
        ))}
      </select>}
    </label>
  )
}
