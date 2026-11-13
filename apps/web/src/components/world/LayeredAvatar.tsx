import { useAvatarAnimationFrame } from '../../game/avatar/useAvatarAnimationFrame'
import shadowUrl from '../../assets/characters/Chap/sk_0_0_f_chap_sombra.svg'
import {
  AVATAR_PARTS,
  idleBackLayerOrder,
  type AvatarView,
  type AvatarAnimation,
  type AvatarAnimationName,
  type AvatarEquipment,
} from '../../game/avatar/layeredAvatar'

interface LayeredAvatarProps {
  equipment: AvatarEquipment
  animation: AvatarAnimation
  animationName: AvatarAnimationName
  displayName: string
  view: AvatarView
  flipX: boolean
}

export function LayeredAvatar({ equipment, animation, animationName, displayName, flipX, view }: LayeredAvatarProps) {
  const frameIndex = useAvatarAnimationFrame(animation)

  const frame = animation.frames[frameIndex] ?? animation.frames[0]
  const layerOrder = view === 'b' && animationName === 'idle' ? idleBackLayerOrder : undefined
  const shadow = frame.layers.sombra
  return (
    <div className="react-world-layered-avatar" role="img" aria-label={displayName} data-animation={animationName} data-view={view} data-frame={frameIndex}
      style={{ transform: `translateX(-50%) scaleX(${flipX ? -1 : 1})` }}
    >
      <img
        className="react-world-avatar-shadow-layer"
        data-layer="sombra"
        src={shadowUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        style={{ zIndex: layerOrder?.sombra ?? shadow.order, transform: `translate(${shadow.x}px, ${shadow.y}px) rotate(${shadow.rotation}deg)` }}
      />
      {AVATAR_PARTS.map((part) => {
        const asset = equipment[part]
        if (!asset) return null
        const pose = frame.layers[part]
        if (pose.visible === false) return null
        return (
          <img
            key={part}
            className="react-world-avatar-layer"
            data-layer={part}
            src={asset.url}
            alt=""
            aria-hidden="true"
            draggable={false}
            style={{ zIndex: layerOrder?.[part] ?? pose.order, transform: `translate(${pose.x}px, ${pose.y}px) rotate(${pose.rotation}deg)` }}
          />
        )
      })}
    </div>
  )
}
