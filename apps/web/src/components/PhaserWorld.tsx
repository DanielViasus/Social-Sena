import { useEffect, useRef, useState } from 'react'
import type { Position, RoomState, RoomTemplate } from '@social-sena/shared'
import type Phaser from 'phaser'
import type { SocialSenaScene } from '../game/SocialSenaScene'

interface PhaserWorldProps {
  room: RoomState | null
  currentUserId: string
  template: RoomTemplate
  onNavigate: (target: Position) => void
}

function PhaserWorld({ room, currentUserId, template, onNavigate }: PhaserWorldProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<SocialSenaScene | null>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!mountRef.current) {
      return
    }

    let cancelled = false
    let destroyGame: (() => void) | null = null

    void import('../game/createSocialSenaGame').then(({ createSocialSenaGame }) => {
      if (!mountRef.current || cancelled) {
        return
      }

      const { game, scene } = createSocialSenaGame(mountRef.current)
      gameRef.current = game
      sceneRef.current = scene
      setLoading(false)
      destroyGame = () => game.destroy(true)
    })

    return () => {
      cancelled = true
      sceneRef.current = null
      gameRef.current = null
      destroyGame?.()
    }
  }, [])

  useEffect(() => {
    if (!mountRef.current) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry || !gameRef.current) {
        return
      }

      const width = Math.max(320, Math.floor(entry.contentRect.width))
      const height = Math.max(320, Math.floor(entry.contentRect.height))
      gameRef.current.scale.resize(width, height)
    })

    observer.observe(mountRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    sceneRef.current?.syncRoom(room, currentUserId, template)
  }, [currentUserId, room, template])

  useEffect(() => {
    sceneRef.current?.setNavigateHandler(onNavigate)
  }, [onNavigate])

  return (
    <div className="phaser-frame">
      {loading ? <div className="phaser-loading">Cargando escena Phaser...</div> : null}
      <div ref={mountRef} className="phaser-mount" aria-label="Escena Phaser de Social Sena" />
    </div>
  )
}

export default PhaserWorld
