export interface SkinReferenceImage {
  id: string
  name: string
  label: string
  group: string
  url: string
}

// Keep references to the original files; new sk_ images join the catalog on build.
const imageUrls = import.meta.glob<string>([
  '../../assets/**/sk_*.{svg,png,jpg,jpeg,webp,gif,avif}',
  '../../../../../packages/shared/assets/**/sk_*.{svg,png,jpg,jpeg,webp,gif,avif}',
], { eager: true, query: '?url', import: 'default' })

export const skinReferenceImages: SkinReferenceImage[] = Object.entries(imageUrls).map(([path, url]) => {
  const filename = path.split('/').pop() ?? path
  const name = filename.replace(/\.[^.]+$/, '')
  const match = /^sk_\d+_\d+_([fb])_([^_]+)_(.+)$/.exec(name)
  const skin = match?.[2]
  return {
    id: path,
    name,
    label: match?.[3].replace(/([a-z])([A-Z])/g, '$1 $2') ?? name,
    group: skin ? `${skin.charAt(0).toUpperCase()}${skin.slice(1)} · ${match[1] === 'f' ? 'Frente' : 'Back'}` : 'Otras capas',
    url,
  }
}).sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))

export const skinReferenceGroups = [...new Set(skinReferenceImages.map((image) => image.group))]
  .map((name) => ({ name, images: skinReferenceImages.filter((image) => image.group === name) }))
