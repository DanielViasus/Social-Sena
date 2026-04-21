import Phaser from 'phaser'
import { SocialSenaScene } from './SocialSenaScene'

export function createSocialSenaGame(parent: HTMLElement) {
  const scene = new SocialSenaScene()

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#d8e7ff',
    width: 1600,
    height: 900,
    render: {
      antialias: true,
      pixelArt: false,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: parent.clientWidth || 1600,
      height: parent.clientHeight || 900,
    },
    scene: [scene],
  })

  return { game, scene }
}
