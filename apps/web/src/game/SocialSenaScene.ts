import Phaser from 'phaser'
import { type Position, type Presence, type RoomObjectTemplate, type RoomState, type RoomTemplate } from '@social-sena/shared'

interface AvatarNode {
  container: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Rectangle
  shadow: Phaser.GameObjects.Ellipse
  label: Phaser.GameObjects.Text
  glow: Phaser.GameObjects.Ellipse
  targetX: number
  targetY: number
}

export class SocialSenaScene extends Phaser.Scene {
  public static readonly KEY = 'social-sena-room'

  private avatars = new Map<string, AvatarNode>()
  private activeRoom: RoomState | null = null
  private activeTemplate: RoomTemplate | null = null
  private currentUserId: string | null = null
  private staticLayer?: Phaser.GameObjects.Container
  private worldLayer?: Phaser.GameObjects.Container
  private routeGraphics?: Phaser.GameObjects.Graphics
  private cameraAnchor?: Phaser.GameObjects.Zone
  private initialized = false
  private navigateHandler: ((target: Position) => void) | null = null

  constructor() {
    super(SocialSenaScene.KEY)
  }

  create() {
    this.staticLayer = this.add.container(0, 0)
    this.routeGraphics = this.add.graphics()
    this.routeGraphics.setDepth(3)
    this.worldLayer = this.add.container(0, 0)
    this.cameraAnchor = this.add.zone(0, 0, 1, 1)
    this.cameras.main.startFollow(this.cameraAnchor, false, 1, 1)
    this.input.setDefaultCursor('pointer')
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.navigateHandler) {
        return
      }

      const worldWidth = this.activeTemplate?.world.width ?? 4500
      const worldHeight = this.activeTemplate?.world.height ?? 3200
      this.navigateHandler({
        x: Phaser.Math.Clamp(pointer.worldX, 32, worldWidth - 32),
        y: Phaser.Math.Clamp(pointer.worldY, 48, worldHeight - 32),
      })
    })

    this.initialized = true

    if (this.activeTemplate) {
      this.applyTemplate(this.activeTemplate)
    }

    if (this.activeRoom) {
      this.renderRoom()
    }
  }

  update(_time: number, delta: number) {
    this.avatars.forEach((avatar) => {
      avatar.container.x = Phaser.Math.Linear(avatar.container.x, avatar.targetX, 0.28)
      avatar.container.y = Phaser.Math.Linear(avatar.container.y, avatar.targetY, 0.28)
    })

    this.updateCameraAnchor(delta)
  }

  public syncRoom(room: RoomState | null, currentUserId: string, template: RoomTemplate) {
    const templateChanged = this.activeTemplate?.id !== template.id
    this.activeRoom = room
    this.activeTemplate = template
    this.currentUserId = currentUserId

    if (!this.initialized) {
      return
    }

    if (templateChanged) {
      this.applyTemplate(template)
    }

    this.renderRoom()
  }

  public setNavigateHandler(handler: ((target: Position) => void) | null) {
    this.navigateHandler = handler
  }

  private applyTemplate(template: RoomTemplate) {
    this.cameras.main.setBackgroundColor(template.world.backgroundColor)
    this.cameras.main.setBounds(0, 0, template.world.width, template.world.height)
    this.staticLayer?.removeAll(true)
    this.routeGraphics?.clear()
    this.cameraAnchor?.setPosition(template.world.spawn.x, template.world.spawn.y)
    this.drawTemplate(template)
  }

  private drawTemplate(template: RoomTemplate) {
    if (!this.staticLayer) {
      return
    }

    const background = this.add.graphics()
    background.fillStyle(template.world.backgroundColor, 1)
    background.fillRect(0, 0, template.world.width, template.world.height)
    background.lineStyle(2, template.world.gridColor, 0.12)

    for (let x = 0; x <= template.world.width; x += 250) {
      background.lineBetween(x, 0, x, template.world.height)
    }

    for (let y = 0; y <= template.world.height; y += 250) {
      background.lineBetween(0, y, template.world.width, y)
    }

    const titleBar = this.add.rectangle(template.world.width / 2, 110, 420, 52, 0x163456, 0.94)
    titleBar.setStrokeStyle(2, 0xf6c26c, 0.8)

    const titleText = this.add.text(template.world.width / 2, 110, template.name, {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: '28px',
      color: '#fff9f0',
    })
    titleText.setOrigin(0.5)

    this.staticLayer.add(background)
    this.staticLayer.add(titleBar)
    this.staticLayer.add(titleText)

    template.objects.forEach((objectTemplate) => {
      this.staticLayer?.add(this.createTemplateObject(objectTemplate))
    })
  }

  private createTemplateObject(objectTemplate: RoomObjectTemplate): Phaser.GameObjects.Container {
    const fillColor = objectTemplate.fillColor ?? this.resolveObjectFill(objectTemplate.kind)
    const strokeColor = objectTemplate.strokeColor ?? 0xffffff
    const opacity = objectTemplate.opacity ?? (objectTemplate.blocksMovement ? 0.9 : 0.72)
    const base = this.add.rectangle(0, 0, objectTemplate.width, objectTemplate.height, fillColor, opacity)
    base.setStrokeStyle(2, strokeColor, 0.55)

    const nodes: Phaser.GameObjects.GameObject[] = [base]
    if (objectTemplate.label) {
      const label = this.add.text(0, 0, objectTemplate.label, {
        fontFamily: 'IBM Plex Sans, sans-serif',
        fontSize: '18px',
        color: '#f8fbff',
        align: 'center',
      })
      label.setOrigin(0.5)
      nodes.push(label)
    }

    return this.add.container(objectTemplate.x, objectTemplate.y, nodes)
  }

  private resolveObjectFill(kind: RoomObjectTemplate['kind']) {
    if (kind === 'door') return 0xf6c26c
    if (kind === 'portal') return 0x7b3a9b
    if (kind === 'zone') return 0x2c7aa0
    if (kind === 'landmark') return 0xc6682f
    return 0x17304a
  }

  private renderRoom() {
    if (!this.activeRoom || !this.worldLayer) {
      this.clearAvatars()
      this.routeGraphics?.clear()
      return
    }

    this.routeGraphics?.clear()
    const worldWidth = this.activeTemplate?.world.width ?? 4500
    const worldHeight = this.activeTemplate?.world.height ?? 3200
    const activeSessionIds = new Set(this.activeRoom.players.map((player) => player.sessionId))

    this.avatars.forEach((avatar, sessionId) => {
      if (!activeSessionIds.has(sessionId)) {
        avatar.container.destroy(true)
        this.avatars.delete(sessionId)
      }
    })

    this.activeRoom.players.forEach((player) => {
      const nextX = Phaser.Math.Clamp(player.position.x, 48, worldWidth - 48)
      const nextY = Phaser.Math.Clamp(player.position.y, 72, worldHeight - 48)
      const avatar = this.avatars.get(player.sessionId)

      if (!avatar) {
        this.avatars.set(player.sessionId, this.createAvatar(player, nextX, nextY))
      } else {
        avatar.targetX = nextX
        avatar.targetY = nextY
        this.styleAvatar(avatar, player)
      }

      this.drawRoute(player)
    })
  }

  private clearAvatars() {
    this.avatars.forEach((avatar) => avatar.container.destroy(true))
    this.avatars.clear()
  }

  private createAvatar(player: Presence, x: number, y: number): AvatarNode {
    const isSelf = player.userId === this.currentUserId
    const glow = this.add.ellipse(0, 0, 108, 108, isSelf ? 0xffc166 : 0x57a6ff, 0.14)
    const shadow = this.add.ellipse(0, 36, 68, 22, 0x102033, 0.18)
    const body = this.add.rectangle(0, -4, 62, 78, isSelf ? 0xff8d3a : 0x2574ff, 1)
    const visor = this.add.rectangle(0, -18, 36, 14, 0xf4f7fb, 0.95)
    const badge = this.add.rectangle(0, 4, 18, 18, isSelf ? 0x8b3d00 : 0x0e3d8a, 0.88)
    const label = this.add.text(0, 52, player.displayName, {
      fontFamily: 'IBM Plex Sans, sans-serif',
      fontSize: '18px',
      color: '#102033',
      align: 'center',
      backgroundColor: isSelf ? '#fff1dc' : '#eef5ff',
      padding: { left: 12, right: 12, top: 7, bottom: 7 },
    })

    label.setOrigin(0.5, 0.5)
    body.setStrokeStyle(2, 0xffffff, 0.78)
    visor.setStrokeStyle(1, 0xd7e6ff, 0.9)
    badge.setStrokeStyle(1, 0xffffff, 0.65)

    const container = this.add.container(x, y, [glow, shadow, body, visor, badge, label])
    this.worldLayer?.add(container)

    return {
      container,
      body,
      shadow,
      label,
      glow,
      targetX: x,
      targetY: y,
    }
  }

  private styleAvatar(avatar: AvatarNode, player: Presence) {
    const isSelf = player.userId === this.currentUserId
    avatar.body.setFillStyle(isSelf ? 0xff8d3a : 0x2574ff, 1)
    avatar.glow.setFillStyle(isSelf ? 0xffc166 : 0x57a6ff, 0.14)
    avatar.label.setText(player.displayName)
    avatar.label.setBackgroundColor(isSelf ? '#fff1dc' : '#eef5ff')

    if (player.moving) {
      const bob = Math.sin(this.time.now / 90) * 2.4
      avatar.body.y = -4 + bob
      avatar.shadow.scaleX = 0.95
    } else {
      avatar.body.y = -4
      avatar.shadow.scaleX = 1
    }
  }

  private updateCameraAnchor(delta: number) {
    if (!this.cameraAnchor || !this.currentUserId || !this.activeTemplate) {
      return
    }

    const currentPlayer = this.activeRoom?.players.find((player) => player.userId === this.currentUserId)
    if (!currentPlayer) {
      return
    }

    const avatar = this.avatars.get(currentPlayer.sessionId)
    const targetX = (avatar?.container.x ?? currentPlayer.position.x) + this.activeTemplate.camera.offsetX
    const targetY = (avatar?.container.y ?? currentPlayer.position.y) + this.activeTemplate.camera.offsetY
    const delayFactor = 1 - Math.exp(-delta / this.activeTemplate.camera.delayMs)

    this.cameraAnchor.x = Phaser.Math.Linear(this.cameraAnchor.x, targetX, delayFactor)
    this.cameraAnchor.y = Phaser.Math.Linear(this.cameraAnchor.y, targetY, delayFactor)
  }

  private drawRoute(player: Presence) {
    if (!this.routeGraphics || !player.route || player.route.waypoints.length < 2) {
      return
    }

    const isSelf = player.userId === this.currentUserId
    const routeColor = isSelf ? 0xff8d3a : 0x2574ff
    const [start, target] = player.route.waypoints

    this.routeGraphics.lineStyle(isSelf ? 4 : 2, routeColor, isSelf ? 0.85 : 0.45)
    this.routeGraphics.beginPath()
    this.routeGraphics.moveTo(start.x, start.y)
    this.routeGraphics.lineTo(target.x, target.y)
    this.routeGraphics.strokePath()
    this.routeGraphics.fillStyle(routeColor, isSelf ? 0.22 : 0.12)
    this.routeGraphics.fillCircle(target.x, target.y, isSelf ? 12 : 8)
  }
}
