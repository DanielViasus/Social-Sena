import type { RoomColliderTemplate, RoomObjectTemplate, RoomZIndexReferenceTemplate } from '@social-sena/shared'

interface ObjectDecorationProps {
  objectTemplate: RoomObjectTemplate
  spriteSrc?: string
  debugEnabled: boolean
}

const PATH_COLLIDER_MARGIN = 2


function colorToCss(value: number | undefined, fallback: string) {
  if (typeof value !== 'number') {
    return fallback
  }

  return `#${value.toString(16).padStart(6, '0')}`
}

function getObjectColliders(objectTemplate: RoomObjectTemplate): RoomColliderTemplate[] {
  const sourceColliders = objectTemplate.colliders?.length
    ? objectTemplate.colliders.slice(0, 4)
    : objectTemplate.collider
      ? [objectTemplate.collider]
      : []

  return sourceColliders.filter((collider) => collider.width > 0 && collider.height > 0)
}

function getObjectZIndexRef(objectTemplate: RoomObjectTemplate, collider?: RoomColliderTemplate): RoomZIndexReferenceTemplate {
  return (
    objectTemplate.zIndexRef ?? {
      offsetX: collider?.offsetX ?? 0,
      offsetY: collider ? collider.offsetY + collider.height / 2 - 8 : objectTemplate.height / 2 - 8,
      width: Math.max(48, collider ? collider.width * 0.45 : objectTemplate.width * 0.35),
      thickness: 2,
    }
  )
}


export function getObjectColliderBoundsList(objectTemplate: RoomObjectTemplate) {
  return getObjectColliders(objectTemplate).map((collider) => ({
    left: objectTemplate.x + collider.offsetX - collider.width / 2,
    right: objectTemplate.x + collider.offsetX + collider.width / 2,
    top: objectTemplate.y + collider.offsetY - collider.height / 2,
    bottom: objectTemplate.y + collider.offsetY + collider.height / 2,
  }))
}

export function getObjectNavigationBoundsList(objectTemplate: RoomObjectTemplate) {
  return getObjectColliderBoundsList(objectTemplate).map((bounds) => ({
    left: bounds.left - PATH_COLLIDER_MARGIN,
    right: bounds.right + PATH_COLLIDER_MARGIN,
    top: bounds.top - PATH_COLLIDER_MARGIN,
    bottom: bounds.bottom + PATH_COLLIDER_MARGIN,
  }))
}

export function getObjectPerspectiveY(objectTemplate: RoomObjectTemplate) {
  const collider = getObjectColliders(objectTemplate)[0]
  const zIndexRef = getObjectZIndexRef(objectTemplate, collider)
  return objectTemplate.y + zIndexRef.offsetY
}

export function ObjectDecoration({ objectTemplate, spriteSrc, debugEnabled }: ObjectDecorationProps) {
  const colliders = getObjectColliders(objectTemplate)
  const referenceCollider = colliders[0]
  const zIndexRef = getObjectZIndexRef(objectTemplate, referenceCollider)
  const hasVisual = Boolean(spriteSrc) || (objectTemplate.opacity ?? 0.72) > 0.02 || objectTemplate.label

  return (
    <div className="world-decoration" style={{ left: `${objectTemplate.x}px`, top: `${objectTemplate.y}px` }}>
      {hasVisual ? (
        <>
          {!spriteSrc ? (
            <div
              className="react-world-object-shadow"
              style={{
                left: '0px',
                top: `${objectTemplate.height / 2 + 6}px`,
                width: `${Math.max(56, objectTemplate.width * 0.65)}px`,
              }}
            />
          ) : null}

          {spriteSrc ? (
            <img
              src={spriteSrc}
              alt={objectTemplate.label ?? objectTemplate.id}
              draggable={false}
              className="react-world-object-sprite"
              style={{
                width: `${objectTemplate.width}px`,
                height: `${objectTemplate.height}px`,
                opacity: objectTemplate.opacity ?? 1,
              }}
            />
          ) : (
            <div
              className={`react-world-object react-world-object-${objectTemplate.kind}`}
              style={{
                width: `${objectTemplate.width}px`,
                height: `${objectTemplate.height}px`,
                background: colorToCss(objectTemplate.fillColor, '#17304a'),
                borderColor: colorToCss(objectTemplate.strokeColor, '#ffffff'),
                opacity: objectTemplate.opacity ?? 0.72,
              }}
            />
          )}

          {objectTemplate.label ? (
            <div className="react-world-object-label" style={{ top: `${-objectTemplate.height / 2 - 26}px` }}>
              {objectTemplate.label}
            </div>
          ) : null}
        </>
      ) : null}

      {debugEnabled ? (
        <>
          <div
            className="debug-object-total"
            style={{
              width: `${objectTemplate.width}px`,
              height: `${objectTemplate.height}px`,
            }}
          />
          <div
            className="debug-object-axis debug-object-axis-horizontal"
            style={{
              width: `${objectTemplate.width}px`,
            }}
          />
          <div
            className="debug-object-axis debug-object-axis-vertical"
            style={{
              height: `${objectTemplate.height}px`,
            }}
          />
          {colliders.map((collider, colliderIndex) => (
            <div
              key={`${objectTemplate.id}-debug-collider-${colliderIndex}`}
              className="debug-object-collider"
              style={{
                left: `${collider.offsetX}px`,
                top: `${collider.offsetY}px`,
                width: `${collider.width}px`,
                height: `${collider.height}px`,
              }}
            />
          ))}
          <div
            className="debug-object-zref"
            style={{
              left: `${zIndexRef.offsetX}px`,
              top: `${zIndexRef.offsetY}px`,
              width: `${zIndexRef.width}px`,
              height: `${zIndexRef.thickness ?? 2}px`,
            }}
          />
        </>
      ) : null}
    </div>
  )
}
