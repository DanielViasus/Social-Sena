import { useCallback, useSyncExternalStore } from 'react'
import shadowUrl from '../../assets/characters/Chap/sk_0_0_f_chap_sombra.svg'
import {
  getAnimationElapsedMs,
  getAnimationFrameIndex,
  subscribeAnimationClock,
} from '../../game/avatar/animationClock'
import type { AnimationSkeleton } from '../../game/avatar/animationSkeleton'
import type { AnimationEquipment, AvatarView } from '../../game/avatar/layeredAvatar'

interface EditorLayeredAvatarProps {
  document: AnimationSkeleton
  equipment: AnimationEquipment
  displayName: string
  view: AvatarView
  flipX: boolean
  flipY: boolean
  stateId: string
}

// Plays a published animation skeleton. Every layer draws the equipped skin's image for its part;
// a part the skin does not have is skipped.
export function EditorLayeredAvatar({ document, equipment, displayName, view, flipX, flipY, stateId }: EditorLayeredAvatarProps) {
  const getFrameIndex = useCallback(
    () => getAnimationFrameIndex(document, getAnimationElapsedMs()),
    [document],
  )
  const frameIndex = useSyncExternalStore(subscribeAnimationClock, getFrameIndex, () => 0)
  const frame = document.frames[frameIndex] ?? document.frames[0]

  return (
    <div className="react-world-layered-avatar" role="img" aria-label={displayName} data-animation={stateId} data-view={view} data-frame={frameIndex} data-source="editor">
      {!frame.layers.some((layer) => layer.part === 'sombra') && <img
        className="react-world-avatar-shadow-layer"
        data-layer="sombra"
        src={shadowUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        style={{ zIndex: 0 }}
      />}
      <div
        className="animation-editor-skin-preview"
        style={{ transform: `translate(-50%, -50%) scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` }}
      >
        {frame.layers.map((layer, index) => {
          if (!layer.visible) return null
          const source = equipment[layer.part]?.url
          if (!source) return null
          return (
            <div
              key={layer.id}
              className="animation-editor-preview-layer"
              style={{
                zIndex: frame.layers.length - index,
                transformOrigin: `calc(50% + ${layer.pivotX}px) calc(50% + ${layer.pivotY}px)`,
                transform: `translate(${layer.x}px, ${layer.y}px) rotate(${layer.rotationX}deg) rotateY(${layer.rotationY}deg) rotate(${layer.rotation}deg)`,
              }}
            >
              <img src={source} alt="" draggable={false} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
