import { useCallback, useSyncExternalStore } from 'react'
import type { AvatarAnimation } from './layeredAvatar'
import {
  getAnimationElapsedMs,
  getAnimationFrameIndex,
  subscribeAnimationClock,
} from './animationClock'

const getServerFrameIndex = () => 0

export function useAvatarAnimationFrame(animation: AvatarAnimation) {
  const getFrameIndex = useCallback(
    () => getAnimationFrameIndex(animation, getAnimationElapsedMs()),
    [animation],
  )
  return useSyncExternalStore(subscribeAnimationClock, getFrameIndex, getServerFrameIndex)
}
