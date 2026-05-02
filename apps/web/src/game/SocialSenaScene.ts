import Phaser from 'phaser'
import { type Position, type Presence, type RoomObjectTemplate, type RoomState, type RoomTemplate } from '@social-sena/shared'
import { avatarTextureEntries, resolveAvatarPreset } from './avatar/avatarSprites'

interface AvatarNode {
  sessionId: string
  container: Phaser.GameObjects.Container
  glow: Phaser.GameObjects.Ellipse
  sprite: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  targetX: number
  targetY: number
  presetId: string
  currentTextureKey: string
}

export class SocialSenaScene extends Phaser.Scene {
  public static readonly KEY = 'social-sena-room'
  private static readonly PLAYER_FOOT_WIDTH = 30
  private static readonly PLAYER_FOOT_HEIGHT = 14
  private static readonly IDLE_FRAME_DURATION_MS = 350
  private static readonly MOVE_FRAME_DURATION_MS = 350

  private avatars = new Map<string, AvatarNode>()
  private objectNodes = new Map<string, Phaser.GameObjects.Container>()
  private activeRoom: RoomState | null = null
  private activeTemplate: RoomTemplate | null = null
  private currentUserId: string | null = null
  private backgroundGraphics?: Phaser.GameObjects.Graphics
  private routeGraphics?: Phaser.GameObjects.Graphics
  private debugGraphics?: Phaser.GameObjects.Graphics
  private cameraAnchor?: Phaser.GameObjects.Zone
  private initialized = false
  private debugEnabled = false
  private navigateHandler: ((target: Position) => void) | null = null

  constructor() {
    super(SocialSenaScene.KEY)
  }

  preload() {
    avatarTextureEntries.forEach((textureEntry) => {
      if (!this.textures.exists(textureEntry.key)) {
        this.load.image(textureEntry.key, textureEntry.url)
      }
    })
  }

  create() {
    this.backgroundGraphics = this.add.graphics()
    this.backgroundGraphics.setDepth(0)
    this.routeGraphics = this.add.graphics()
    this.routeGraphics.setDepth(60)
    this.debugGraphics = this.add.graphics()
    this.debugGraphics.setDepth(10000)
    this.cameraAnchor = this.add.zone(0, 0, 1, 1)
    this.cameras.main.startFollow(this.cameraAnchor, false, 1, 1)
    this.input.setDefaultCursor('pointer')
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.navigateHandler) {
        return
      }

      const worldWidth = this.activeTemplate?.world.width ?? 5000
      const worldHeight = this.activeTemplate?.world.height ?? 5000
      this.navigateHandler({
        x: Phaser.Math.Clamp(pointer.worldX, 32, worldWidth - 32),
        y: Phaser.Math.Clamp(pointer.worldY, 24, worldHeight - 20),
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
      avatar.container.setDepth(100 + avatar.container.y)

      const player = this.activeRoom?.players.find((currentPlayer) => currentPlayer.sessionId === avatar.sessionId)
      if (player) {
        this.styleAvatar(avatar, player)
      }
    })

    this.drawDebugOverlay()
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

  public setDebugEnabled(enabled: boolean) {
    this.debugEnabled = enabled
    this.drawDebugOverlay()
  }

  private applyTemplate(template: RoomTemplate) {
    this.cameras.main.setBackgroundColor(template.world.backgroundColor)
    this.cameras.main.setBounds(0, 0, template.world.width, template.world.height)
    this.routeGraphics?.clear()
    this.debugGraphics?.clear()
    this.cameraAnchor?.setPosition(template.world.spawn.x, template.world.spawn.y)
    this.clearRoomObjects()
    this.drawTemplate(template)
  }

  private drawTemplate(template: RoomTemplate) {
    if (!this.backgroundGraphics) {
      return
    }

    this.backgroundGraphics.clear()
    this.backgroundGraphics.fillStyle(template.world.backgroundColor, 1)
    this.backgroundGraphics.fillRect(0, 0, template.world.width, template.world.height)

    if (template.id === 'Room_1909') {
      this.drawPlazaSurface(template)
    } else {
      this.drawDefaultGrid(template)
    }

    template.objects.forEach((objectTemplate) => {
      const objectNode = this.createTemplateObject(objectTemplate)
      this.objectNodes.set(objectTemplate.id, objectNode)
    })

    this.drawDebugOverlay()
  }

  private drawDefaultGrid(template: RoomTemplate) {
    if (!this.backgroundGraphics) {
      return
    }

    this.backgroundGraphics.lineStyle(2, template.world.gridColor, 0.12)

    for (let x = 0; x <= template.world.width; x += 250) {
      this.backgroundGraphics.lineBetween(x, 0, x, template.world.height)
    }

    for (let y = 0; y <= template.world.height; y += 250) {
      this.backgroundGraphics.lineBetween(0, y, template.world.width, y)
    }
  }

  private drawPlazaSurface(template: RoomTemplate) {
    if (!this.backgroundGraphics) {
      return
    }

    const centerX = template.world.width / 2
    const centerY = template.world.height / 2

    this.backgroundGraphics.fillStyle(0xcfd9bf, 1)
    this.backgroundGraphics.fillRect(0, 0, template.world.width, template.world.height)

    this.backgroundGraphics.fillStyle(0xe9dfc6, 1)
    this.backgroundGraphics.fillRoundedRect(centerX - 1180, centerY - 1180, 2360, 2360, 160)
    this.backgroundGraphics.fillStyle(0xd8ccb0, 0.82)
    this.backgroundGraphics.fillRoundedRect(centerX - 810, centerY - 810, 1620, 1620, 120)
    this.backgroundGraphics.fillStyle(0xe8e2d4, 0.95)
    this.backgroundGraphics.fillRoundedRect(centerX - 118, 0, 236, template.world.height, 90)
    this.backgroundGraphics.fillRoundedRect(0, centerY - 118, template.world.width, 236, 90)

    this.backgroundGraphics.lineStyle(3, 0xffffff, 0.3)
    for (let radius = 320; radius <= 980; radius += 160) {
      this.backgroundGraphics.strokeCircle(centerX, centerY, radius)
    }

    this.backgroundGraphics.lineStyle(1, 0xffffff, 0.14)
    for (let x = 0; x <= template.world.width; x += 180) {
      this.backgroundGraphics.lineBetween(x, 0, x, template.world.height)
    }

    for (let y = 0; y <= template.world.height; y += 180) {
      this.backgroundGraphics.lineBetween(0, y, template.world.width, y)
    }

    this.backgroundGraphics.fillStyle(0xf5efdd, 0.9)
    this.backgroundGraphics.fillEllipse(centerX, template.world.height - 1240, 760, 220)
  }

  private createTemplateObject(objectTemplate: RoomObjectTemplate): Phaser.GameObjects.Container {
    const fillColor = objectTemplate.fillColor ?? this.resolveObjectFill(objectTemplate.kind)
    const strokeColor = objectTemplate.strokeColor ?? 0xffffff
    const opacity = objectTemplate.opacity ?? (objectTemplate.blocksMovement ? 0.9 : 0.72)
    const sortY = this.getObjectSortY(objectTemplate)

    const children: Phaser.GameObjects.GameObject[] = []
    if (opacity > 0.02 || objectTemplate.label) {
      const shadow = this.add.ellipse(0, sortY - objectTemplate.y + 6, Math.max(56, objectTemplate.width * 0.65), 18, 0x0c1620, 0.14)
      children.push(shadow)

      const shape = this.createObjectShape(objectTemplate, fillColor, strokeColor, opacity)
      children.push(shape)

      if (objectTemplate.label) {
        const label = this.add.text(0, -objectTemplate.height / 2 - 26, objectTemplate.label, {
          fontFamily: 'IBM Plex Sans, sans-serif',
          fontSize: '18px',
          color: '#f8fbff',
          align: 'center',
          backgroundColor: 'rgba(10, 20, 32, 0.45)',
          padding: { left: 10, right: 10, top: 6, bottom: 6 },
        })
        label.setOrigin(0.5)
        children.push(label)
      }
    }

    const container = this.add.container(objectTemplate.x, objectTemplate.y, children)
    container.setDepth(80 + sortY)
    return container
  }

  private createObjectShape(
    objectTemplate: RoomObjectTemplate,
    fillColor: number,
    strokeColor: number,
    opacity: number,
  ): Phaser.GameObjects.GameObject {
    if (objectTemplate.kind === 'portal') {
      const portal = this.add.ellipse(0, 0, objectTemplate.width, objectTemplate.height, fillColor, opacity)
      portal.setStrokeStyle(4, strokeColor, 0.95)
      return portal
    }

    if (objectTemplate.id === 'fountain-core') {
      const graphics = this.add.graphics()
      graphics.fillStyle(fillColor, opacity)
      graphics.fillEllipse(0, 6, objectTemplate.width, objectTemplate.height)
      graphics.lineStyle(4, strokeColor, 0.95)
      graphics.strokeEllipse(0, 6, objectTemplate.width, objectTemplate.height)
      graphics.fillStyle(0xbbe7ff, 0.75)
      graphics.fillEllipse(0, -8, objectTemplate.width * 0.62, objectTemplate.height * 0.44)
      return graphics
    }

    const body = this.add.rectangle(0, 0, objectTemplate.width, objectTemplate.height, fillColor, opacity)
    body.setStrokeStyle(2, strokeColor, 0.55)
    return body
  }

  private resolveObjectFill(kind: RoomObjectTemplate['kind']) {
    if (kind === 'door') return 0xf6c26c
    if (kind === 'portal') return 0x7b3a9b
    if (kind === 'zone') return 0x916240
    if (kind === 'landmark') return 0x355f4d
    return 0x17304a
  }

  private getObjectSortY(objectTemplate: RoomObjectTemplate) {
    if (typeof objectTemplate.depthOffsetY === 'number') {
      return objectTemplate.y + objectTemplate.depthOffsetY
    }

    if (objectTemplate.collider) {
      return objectTemplate.y + objectTemplate.collider.offsetY + objectTemplate.collider.height / 2
    }

    return objectTemplate.y + objectTemplate.height / 2
  }

  private renderRoom() {
    if (!this.activeRoom) {
      this.clearAvatars()
      this.routeGraphics?.clear()
      return
    }

    this.routeGraphics?.clear()
    const worldWidth = this.activeTemplate?.world.width ?? 5000
    const worldHeight = this.activeTemplate?.world.height ?? 5000
    const activeSessionIds = new Set(this.activeRoom.players.map((player) => player.sessionId))

    this.avatars.forEach((avatar, sessionId) => {
      if (!activeSessionIds.has(sessionId)) {
        avatar.container.destroy(true)
        this.avatars.delete(sessionId)
      }
    })

    this.activeRoom.players.forEach((player) => {
      const nextX = Phaser.Math.Clamp(player.position.x, 32, worldWidth - 32)
      const nextY = Phaser.Math.Clamp(player.position.y, 24, worldHeight - 20)
      const nextPresetId = resolveAvatarPreset(player.skinId).id
      const avatar = this.avatars.get(player.sessionId)

      if (!avatar || avatar.presetId !== nextPresetId) {
        avatar?.container.destroy(true)
        this.avatars.set(player.sessionId, this.createAvatar(player, nextX, nextY))
      } else {
        avatar.targetX = nextX
        avatar.targetY = nextY
        avatar.container.setDepth(100 + nextY)
        this.styleAvatar(avatar, player)
      }

      this.drawRoute(player)
    })

    this.drawDebugOverlay()
  }

  private clearAvatars() {
    this.avatars.forEach((avatar) => avatar.container.destroy(true))
    this.avatars.clear()
  }

  private clearRoomObjects() {
    this.objectNodes.forEach((objectNode) => objectNode.destroy(true))
    this.objectNodes.clear()
  }

  private drawDebugOverlay() {
    if (!this.debugGraphics) {
      return
    }

    this.debugGraphics.clear()

    if (!this.debugEnabled) {
      return
    }

    this.activeTemplate?.objects.forEach((objectTemplate) => {
      const collider = objectTemplate.collider ?? {
        offsetX: 0,
        offsetY: 0,
        width: objectTemplate.width,
        height: objectTemplate.height,
      }

      const centerX = objectTemplate.x + collider.offsetX
      const centerY = objectTemplate.y + collider.offsetY
      const color = objectTemplate.blocksMovement ? 0xff5d5d : 0x37d99a

      this.debugGraphics?.lineStyle(3, color, 1)
      this.debugGraphics?.strokeRect(
        centerX - collider.width / 2,
        centerY - collider.height / 2,
        collider.width,
        collider.height,
      )
      this.debugGraphics?.fillStyle(color, 1)
      this.debugGraphics?.fillCircle(centerX, centerY, 4)
    })

    this.activeRoom?.players.forEach((player) => {
      const isSelf = player.userId === this.currentUserId
      const color = isSelf ? 0xffd166 : 0x3ab7ff
      const footLeft = player.position.x - SocialSenaScene.PLAYER_FOOT_WIDTH / 2
      const footTop = player.position.y - SocialSenaScene.PLAYER_FOOT_HEIGHT

      this.debugGraphics?.lineStyle(3, color, 1)
      this.debugGraphics?.strokeRect(
        footLeft,
        footTop,
        SocialSenaScene.PLAYER_FOOT_WIDTH,
        SocialSenaScene.PLAYER_FOOT_HEIGHT,
      )
      this.debugGraphics?.fillStyle(color, 1)
      this.debugGraphics?.fillCircle(player.position.x, player.position.y, 4)
      this.debugGraphics?.lineStyle(2, color, 0.8)
      this.debugGraphics?.lineBetween(player.position.x, player.position.y - 56, player.position.x, player.position.y)
    })
  }

  private createAvatar(player: Presence, x: number, y: number): AvatarNode {
    const preset = resolveAvatarPreset(player.skinId)
    const isSelf = player.userId === this.currentUserId
    const initialTexture = preset.idleFrames[0]
    const glow = this.add.ellipse(0, -66, 120, 128, isSelf ? 0xffd26f : 0x57a6ff, 0.14)
    const sprite = this.add.image(0, 0, initialTexture.key)
    sprite.setOrigin(0.5, 1)
    sprite.setScale(preset.scale)

    const label = this.add.text(0, -154, player.displayName, {
      fontFamily: 'IBM Plex Sans, sans-serif',
      fontSize: '18px',
      color: '#102033',
      align: 'center',
      backgroundColor: isSelf ? '#fff1dc' : '#eef5ff',
      padding: { left: 12, right: 12, top: 7, bottom: 7 },
    })

    label.setOrigin(0.5)

    const children: Phaser.GameObjects.GameObject[] = []
    for (const child of [glow, sprite, label]) {
      if (child) {
        children.push(child)
      }
    }

    const container = this.add.container(x, y, children)
    container.setDepth(100 + y)

    const avatarNode: AvatarNode = {
      sessionId: player.sessionId,
      container,
      glow,
      sprite,
      label,
      targetX: x,
      targetY: y,
      presetId: preset.id,
      currentTextureKey: initialTexture.key,
    }

    this.styleAvatar(avatarNode, player)
    return avatarNode
  }

  private styleAvatar(avatar: AvatarNode, player: Presence) {
    const isSelf = player.userId === this.currentUserId
    const preset = resolveAvatarPreset(player.skinId)
    const frameSet = player.moving ? preset.walkFrames : preset.idleFrames
    const frameDuration = player.moving
      ? SocialSenaScene.MOVE_FRAME_DURATION_MS
      : SocialSenaScene.IDLE_FRAME_DURATION_MS
    const frameIndex = Math.floor(this.time.now / frameDuration) % frameSet.length
    const nextTexture = frameSet[frameIndex]

    avatar.glow.setFillStyle(isSelf ? 0xffd26f : 0x57a6ff, 0.12)
    avatar.glow.y = player.moving && frameIndex % 2 === 1 ? -64 : -66

    if (avatar.currentTextureKey !== nextTexture.key) {
      avatar.sprite.setTexture(nextTexture.key)
      avatar.currentTextureKey = nextTexture.key
    }

    avatar.label.setText(player.displayName)
    avatar.label.setBackgroundColor(isSelf ? '#fff1dc' : '#eef5ff')
    avatar.label.x = 0
    avatar.label.y = player.moving && frameIndex % 2 === 1 ? -150 : -154
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
